import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { readBudget } from "../scripts/check-bundle-budget.ts";
import {
  checkDeployedSnapshot,
  checkRegistrySnapshot,
  DEPLOYED_SAMPLE,
  evenlySpaced,
} from "../scripts/check-registry-snapshot.ts";

const golden = join(
  import.meta.dirname,
  "../tools/registry-snapshot/test/fixtures/expected",
);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copyGolden(): string {
  const dir = mkdtempSync(join(tmpdir(), "nf-registry-check-"));
  dirs.push(dir);
  cpSync(golden, dir, { recursive: true });
  return dir;
}
const readJson = (dir: string, path: string) =>
  JSON.parse(readFileSync(join(dir, path), "utf8"));
const writeJson = (dir: string, path: string, value: unknown) =>
  writeFileSync(join(dir, path), JSON.stringify(value));
const messages = (result: { problems: { message: string }[] }) =>
  result.problems.map((p) => p.message).join("\n");

/** Pads the index with incompressible text until its gzip size is about `bytes` (a binary search on the length). */
function bloated(dir: string, bytes: number): void {
  const index = readJson(dir, "registry/index.json");
  const pool = randomBytes(bytes * 2).toString("base64");
  const sizeAt = (n: number): number => {
    index.modules[0].description = pool.slice(0, n);
    return gzipSync(JSON.stringify(index)).length;
  };
  let low = 0;
  let high = pool.length;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (sizeAt(mid) > bytes) high = mid;
    else low = mid;
  }
  sizeAt(low);
  writeJson(dir, "registry/index.json", index);
}

describe("F-501 registry snapshot check", () => {
  it("F-501 step 2 QA-06: index.json gzip size is checked against budgets.json QA-06, with a warning from 90%", () => {
    const budget = readBudget("QA-06");
    expect(budget.maxBytes).toBe(300000);
    const ok = checkRegistrySnapshot(golden);
    expect(ok.problems).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(ok.indexGzipBytes).toBeGreaterThan(0);
    expect(ok.warnings).toEqual([]);

    const over = copyGolden();
    bloated(over, 301000);
    const failed = checkRegistrySnapshot(over);
    expect(failed.ok).toBe(false);
    expect(messages(failed)).toMatch(/QA-06/);
    expect(messages(failed)).toContain("300.0 kB");

    const near = copyGolden();
    bloated(near, 280000);
    const warned = checkRegistrySnapshot(near);
    expect(warned.ok).toBe(true);
    expect(warned.warnings.map((w) => w.message).join()).toMatch(/QA-06.*90%/);
  });

  it("F-501 IO-31: rejects a wrong format, a module without its bundle or ports, or a plugin without its file", () => {
    const wrong = copyGolden();
    writeJson(wrong, "registry/index.json", {
      ...readJson(wrong, "registry/index.json"),
      format: 2,
    });
    expect(messages(checkRegistrySnapshot(wrong))).toMatch(
      /index\.json.*format/,
    );

    const noBundle = copyGolden();
    rmSync(
      join(noBundle, "registry/modules/nf-core/fastqc/0.0.0-6d1763b.json"),
    );
    expect(messages(checkRegistrySnapshot(noBundle))).toContain(
      "nf-core/fastqc",
    );

    const noPorts = copyGolden();
    const ports = readJson(noPorts, "registry/ports.json");
    delete ports.modules["nf-core/fastqc"];
    writeJson(noPorts, "registry/ports.json", ports);
    expect(messages(checkRegistrySnapshot(noPorts))).toMatch(
      /ports.*nf-core\/fastqc/,
    );

    const noPlugin = copyGolden();
    rmSync(join(noPlugin, "registry/plugins/nf-schema/3.1.0.json"));
    expect(messages(checkRegistrySnapshot(noPlugin))).toContain("nf-schema");

    const noPin = copyGolden();
    rmSync(
      join(noPin, "registry/modules/nf-core/samtools/merge/0.0.0-df69bf6.json"),
    );
    expect(messages(checkRegistrySnapshot(noPin))).toContain(
      "nf-core/samtools/merge",
    );

    const stale = copyGolden();
    writeJson(stale, "registry/ports.json", {
      ...readJson(stale, "registry/ports.json"),
      generatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(messages(checkRegistrySnapshot(stale))).toMatch(/generatedAt/);

    expect(
      messages(checkRegistrySnapshot(join(tmpdir(), "nf-no-such-snapshot"))),
    ).toMatch(/index\.json/);
  });

  it("F-501 IO-31: checkDeployedSnapshot polls until the site serves this snapshot, then checks it", async () => {
    const { generatedAt } = readJson(golden, "registry/index.json");
    let calls = 0;
    const sleeps: number[] = [];
    const site = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === "/registry/index.json" && ++calls < 3)
        return new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      return new Response(readFileSync(join(golden, path)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const result = await checkDeployedSnapshot(
      "https://site.example",
      generatedAt,
      {
        timeoutMs: 60_000,
        intervalMs: 10,
        fetch: site,
        sleep: async (ms) => void sleeps.push(ms),
        log: () => {},
      },
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([10, 10]);

    const never = (async () =>
      new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    let clock = 0;
    const timedOut = await checkDeployedSnapshot(
      "https://site.example",
      generatedAt,
      {
        timeoutMs: 25,
        intervalMs: 10,
        fetch: never,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        log: () => {},
      },
    );
    expect(timedOut.ok).toBe(false);
    expect(messages(timedOut)).toMatch(/did not serve/);
  });

  /** A synthetic site: 50 modules (each requiring the next), 8 plugins, served from memory. */
  function synthetic(overrides: Record<string, string> = {}) {
    const generatedAt = "2026-11-22T00:00:00.000Z";
    const modules = Array.from({ length: 50 }, (_, i) => ({
      name: `nf-core/m${i}`,
      version: "1.0.0",
    }));
    const plugins = Array.from({ length: 8 }, (_, i) => ({
      id: `nf-p${i}`,
      version: "1.0.0",
    }));
    const files: Record<string, string> = {
      "registry/index.json": JSON.stringify({
        format: 1,
        generatedAt,
        modules,
        plugins,
      }),
      "registry/ports.json": JSON.stringify({
        format: 1,
        generatedAt,
        modules: Object.fromEntries(modules.map((m) => [m.name, {}])),
      }),
    };
    for (const [i, m] of modules.entries())
      files[`registry/modules/${m.name}/${m.version}.json`] = JSON.stringify({
        format: 1,
        name: m.name,
        version: m.version,
        requires: i + 1 < modules.length ? [modules[i + 1]] : [],
      });
    for (const p of plugins)
      files[`registry/plugins/${p.id}/${p.version}.json`] = JSON.stringify({
        format: 1,
        id: p.id,
        version: p.version,
      });
    Object.assign(files, overrides);
    const requests: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(`${url.pathname}${url.search}`);
      const body = files[url.pathname.slice(1)];
      return body === undefined
        ? new Response("nope", { status: 404 })
        : new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    }) as typeof fetch;
    return { generatedAt, fetcher, requests, modules, plugins, files };
  }
  const run = (
    site: ReturnType<typeof synthetic>,
    sample?: typeof DEPLOYED_SAMPLE,
  ) =>
    checkDeployedSnapshot("https://site.example", site.generatedAt, {
      sample,
      timeoutMs: 1000,
      intervalMs: 1,
      fetch: site.fetcher,
      sleep: async () => {},
      log: () => {},
    });

  it("F-501 F-011 step 5 ADR-0041: with a sample, checkDeployedSnapshot fetches only the index, ports.json, 20 evenly spaced bundles and 5 plugin files, each with a cache-busting query", async () => {
    const site = synthetic();
    const result = await run(site, DEPLOYED_SAMPLE);
    expect(result.problems).toEqual([]);
    for (const r of site.requests) expect(r).toMatch(/\?ts=\d+$/);
    const paths = [...new Set(site.requests.map((r) => r.split("?")[0]))];
    expect(paths).toHaveLength(2 + 20 + 5);
    expect(paths.slice(0, 2)).toEqual([
      "/registry/index.json",
      "/registry/ports.json",
    ]);
    const bundles = paths.filter((p) => p?.includes("/modules/"));
    expect(bundles).toContain("/registry/modules/nf-core/m0/1.0.0.json");
    expect(bundles).toContain("/registry/modules/nf-core/m49/1.0.0.json");
    expect(paths.filter((p) => p?.includes("/plugins/"))).toHaveLength(5);
    // Without a sample every file is fetched, following requires.
    const full = synthetic();
    expect((await run(full)).problems).toEqual([]);
    expect(new Set(full.requests.map((r) => r.split("?")[0])).size).toBe(
      2 + 50 + 8,
    );
  });

  it("F-501 ADR-0041: a sampled bundle that is missing, not JSON, or holds another version fails naming its path", async () => {
    const path = "registry/modules/nf-core/m0/1.0.0.json";
    const cases: [string, Record<string, string>][] = [
      ["missing", {}],
      ["not JSON", { [path]: "<!doctype html>" }],
      [
        "another version",
        {
          [path]: JSON.stringify({
            format: 1,
            name: "nf-core/m0",
            version: "2.0.0",
          }),
        },
      ],
    ];
    for (const [name, overrides] of cases) {
      const site = synthetic(overrides);
      if (name === "missing") {
        const fetcher = site.fetcher;
        site.fetcher = (async (input: string | URL | Request) =>
          new URL(String(input)).pathname === `/${path}`
            ? new Response("nope", { status: 404 })
            : fetcher(input)) as typeof fetch;
      }
      const result = await run(site, DEPLOYED_SAMPLE);
      expect(result.ok, name).toBe(false);
      expect(messages(result), name).toContain(path);
    }
  });

  it("F-501: evenlySpaced keeps the first and last items and returns all items when n exceeds the length", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const picked = evenlySpaced(items, 4);
    expect(picked).toHaveLength(4);
    expect(picked[0]).toBe(0);
    expect(picked[3]).toBe(9);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(new Set(picked).size).toBe(4);
    expect(evenlySpaced(items, 10)).toEqual(items);
    expect(evenlySpaced(items, 99)).toEqual(items);
    expect(evenlySpaced(items, 1)).toEqual([0]);
    expect(evenlySpaced([], 3)).toEqual([]);
  });

  it("F-501 ADR-0041: check:registry --url samples by default and --all checks every file", async () => {
    const site = synthetic();
    const seen = new Set<string>();
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      seen.add(url.pathname);
      const body = site.files[url.pathname.slice(1)];
      res
        .writeHead(body === undefined ? 404 : 200, {
          "content-type": "application/json",
        })
        .end(body ?? "nope");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const cli = (...extra: string[]) =>
        new Promise<number | null>((resolve) => {
          seen.clear();
          spawn(
            process.execPath,
            [
              join(
                import.meta.dirname,
                "../scripts/check-registry-snapshot.ts",
              ),
              "--url",
              url,
              "--generated-at",
              site.generatedAt,
              ...extra,
            ],
            { stdio: "ignore" },
          ).on("exit", resolve);
        });
      expect(await cli()).toBe(0);
      expect(seen.size).toBe(2 + 20 + 5);
      expect(await cli("--all")).toBe(0);
      expect(seen.size).toBe(2 + 50 + 8);
    } finally {
      server.close();
    }
  });
});
