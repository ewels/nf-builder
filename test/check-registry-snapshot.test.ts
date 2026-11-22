import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { readBudget } from "../scripts/check-bundle-budget.ts";
import {
  checkDeployedSnapshot,
  checkRegistrySnapshot,
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
});
