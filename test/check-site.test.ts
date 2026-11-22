import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  assetPathProblems,
  checkDeployedSite,
  checkSiteDir,
  headPolicyProblems,
} from "../scripts/check-site.ts";
import { CONTENT_SECURITY_POLICY } from "../scripts/security-policy.ts";
import { policyMetaHtml } from "../scripts/security-policy-meta.ts";

const BASE = "/nf-builder/";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const attr = (value: string) => value.replaceAll("'", "&#39;");
const CSP = `<meta http-equiv="Content-Security-Policy" content="${attr(CONTENT_SECURITY_POLICY)}">`;
const REFERRER = '<meta name="referrer" content="no-referrer">';
const CHARSET = '<meta charset="utf-8">';
const TAIL =
  '<title>t</title><script type="module" crossorigin src="/nf-builder/assets/index-1.js"></script><link rel="stylesheet" href="/nf-builder/assets/index-1.css">';
const page = (head: string) =>
  `<!doctype html><html><head>${head}</head><body><div id="root"></div></body></html>`;
const GOOD = page(`${policyMetaHtml()}${CHARSET}${TAIL}`);

function makeSite(
  files: Record<string, string>,
  opts: { version?: boolean } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), "nf-builder-site-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const all: Record<string, string> = {
    "index.html": GOOD,
    "assets/index-1.js": "export {};",
    "assets/index-1.css": "body{}",
    ...(opts.version === false
      ? {}
      : { "version.json": '{"commit":"abc","context":"production"}' }),
    ...files,
  };
  for (const [name, content] of Object.entries(all)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

describe("check:site static", () => {
  it("F-011 step 2 QA-30: checkSiteDir passes a build whose every page starts <head> with the CSP then the referrer meta, with assets under the base and a version.json", () => {
    // Vite pretty-prints the tags it injects, so whitespace between them is allowed.
    const vite = page(`\n    ${CSP}\n    ${REFERRER}\n\n    ${CHARSET}${TAIL}`);
    const dir = makeSite({
      "index.html": vite,
      "spike/s4/index.html": page(`${policyMetaHtml()}${CHARSET}`),
    });
    expect(checkSiteDir(dir, BASE)).toEqual({ ok: true, problems: [] });
  });

  const stamped = (rest: string) => page(`${CSP}${REFERRER}${rest}`);
  it.each([
    ["there is no CSP meta", page(`${CHARSET}${TAIL}`)],
    [
      "a script or link comes before the CSP meta",
      page(`<link rel="icon" href="data:,">${CSP}${REFERRER}${CHARSET}`),
    ],
    [
      "the CSP content differs",
      page(
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">${REFERRER}${CHARSET}`,
      ),
    ],
    [
      "frame-ancestors is present",
      page(
        `<meta http-equiv="Content-Security-Policy" content="${attr(`${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`)}">${REFERRER}${CHARSET}`,
      ),
    ],
    ["the referrer meta is missing", page(`${CSP}${CHARSET}${TAIL}`)],
    [
      "the referrer meta is wrong",
      page(`${CSP}<meta name="referrer" content="origin">${CHARSET}`),
    ],
    [
      "an X-Frame-Options meta is present",
      stamped(
        `<meta http-equiv="X-Frame-Options" content="DENY">${CHARSET}${TAIL}`,
      ),
    ],
    [
      "charset comes after byte 1024",
      stamped(`<title>${"x".repeat(1100)}</title>${CHARSET}`),
    ],
  ])(
    "F-011 step 2 QA-30: checkSiteDir names the file when %s",
    (_name, html) => {
      const dir = makeSite({ "spike/p.html": html });
      const result = checkSiteDir(dir, BASE);
      expect(result.ok).toBe(false);
      expect(result.problems.some((p) => p.file?.endsWith("p.html"))).toBe(
        true,
      );
    },
  );

  it("F-011 step 3 ADR-0040: checkSiteDir rejects asset URLs outside the base, ./ URLs and missing files, and ignores data: URLs", () => {
    const html = page(
      `${policyMetaHtml()}${CHARSET}<link rel="icon" href="data:,"><script type="module" src="/assets/a.js"></script><script src="./b.js"></script><script src="/nf-builder/assets/missing.js"></script><link rel="stylesheet" href="/nf-builder/assets/index-1.css?v=1">`,
    );
    const problems = assetPathProblems(html, BASE, (p) =>
      p.startsWith("assets/index-1"),
    );
    const text = problems.join("\n");
    expect(text).toContain("/assets/a.js");
    expect(text).toContain("./b.js");
    expect(text).toContain("assets/missing.js");
    expect(text).not.toContain("data:");
    expect(text).not.toContain("index-1.css");
    expect(problems).toHaveLength(3);
    const dir = makeSite({ "index.html": html });
    const result = checkSiteDir(dir, BASE);
    expect(result.ok).toBe(false);
    expect(result.problems.every((p) => p.file?.endsWith("index.html"))).toBe(
      true,
    );
  });

  it("F-011: checkSiteDir needs version.json with a string commit and context", () => {
    expect(checkSiteDir(makeSite({}, { version: false }), BASE).ok).toBe(false);
    for (const body of ['{"commit":"a"}', '{"commit":1,"context":"x"}', "no"]) {
      const result = checkSiteDir(makeSite({ "version.json": body }), BASE);
      expect(result.ok, body).toBe(false);
      expect(result.problems[0]?.file).toMatch(/version\.json$/);
    }
  });

  it("F-011 QA-30: headPolicyProblems accepts the policy with entity-escaped quotes", () => {
    expect(headPolicyProblems(GOOD)).toEqual([]);
  });
});

type Served = { status?: number; type: string; body: string };
async function serve(
  handler: (path: string, search: string) => Served | undefined,
): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://x");
      requests.push(req.url ?? "");
      const served = handler(url.pathname, url.search);
      if (!served) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res
        .writeHead(served.status ?? 200, { "content-type": served.type })
        .end(served.body);
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}${BASE}`, requests };
}

const fast = { timeoutMs: 2000, intervalMs: 10 };
const siteHandler =
  (opts: {
    commit?: () => string;
    context?: string;
    html?: string;
    js?: Served;
  }) =>
  (path: string): Served | undefined => {
    if (path === `${BASE}version.json`)
      return {
        type: "application/json",
        body: JSON.stringify({
          commit: opts.commit?.() ?? "abc",
          context: opts.context ?? "production",
        }),
      };
    if (path === BASE) return { type: "text/html", body: opts.html ?? GOOD };
    if (path === `${BASE}assets/index-1.js`)
      return opts.js ?? { type: "text/javascript", body: "export {};" };
    return undefined;
  };

describe("check:site deployed", () => {
  it("F-011 step 1: checkDeployedSite polls version.json with a cache-busting query until the commit is live, then checks the served page's policy and entry script", async () => {
    let calls = 0;
    const { url, requests } = await serve(
      siteHandler({ commit: () => (++calls < 3 ? "old" : "abc") }),
    );
    const result = await checkDeployedSite(url, { commit: "abc", ...fast });
    expect(result).toEqual({ ok: true, liveCommit: "abc", problems: [] });
    const versions = requests.filter((r) => r.includes("version.json"));
    expect(versions).toHaveLength(3);
    for (const r of requests.filter((r) => !r.includes("index-1.js")))
      expect(r).toMatch(/\?ts=\d+/);
    expect(requests.some((r) => r.includes("/assets/index-1.js"))).toBe(true);
  });

  it("F-011 step 1: checkDeployedSite times out naming the last commit seen", async () => {
    const { url } = await serve(siteHandler({ commit: () => "old" }));
    const result = await checkDeployedSite(url, {
      commit: "abc",
      timeoutMs: 50,
      intervalMs: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.liveCommit).toBe("old");
    expect(result.problems.join("\n")).toMatch(/abc/);
    expect(result.problems.join("\n")).toMatch(/old/);
  });

  it("F-011 step 2: checkDeployedSite names the URL when the served CSP meta differs", async () => {
    const html = page(
      `<meta http-equiv="Content-Security-Policy" content="default-src *">${REFERRER}${CHARSET}${TAIL}`,
    );
    const { url } = await serve(siteHandler({ html }));
    const result = await checkDeployedSite(url, { commit: "abc", ...fast });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain(url);
  });

  it("F-011: checkDeployedSite fails on a context mismatch, a page without an entry script, or a script not served as JavaScript", async () => {
    const wrongContext = await serve(siteHandler({ context: "local" }));
    const a = await checkDeployedSite(wrongContext.url, {
      commit: "abc",
      context: "production",
      ...fast,
    });
    expect(a.ok).toBe(false);
    expect(a.problems.join("\n")).toMatch(/context/);

    const noScript = await serve(
      siteHandler({ html: page(`${policyMetaHtml()}${CHARSET}`) }),
    );
    const b = await checkDeployedSite(noScript.url, { commit: "abc", ...fast });
    expect(b.ok).toBe(false);
    expect(b.problems.join("\n")).toMatch(/script/);

    const wrongType = await serve(
      siteHandler({ js: { type: "text/html", body: "<html>" } }),
    );
    const c = await checkDeployedSite(wrongType.url, {
      commit: "abc",
      ...fast,
    });
    expect(c.ok).toBe(false);
    expect(c.problems.join("\n")).toMatch(/JavaScript/);
  });
});

describe("check:site CLI", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts/check-site.ts"), ...args],
      {
        encoding: "utf8",
        env: { ...process.env, BASE_PATH: "", ...env },
      },
    );

  it("F-011: node scripts/check-site.ts exits 1 on a problem and 2 without a build or with bad arguments, and reads the base from BASE_PATH", () => {
    const dir = makeSite({});
    expect(run([dir], { BASE_PATH: BASE }).status).toBe(0);
    // Assets sit under /nf-builder/, so a build checked at base / fails.
    const wrongBase = run([dir]);
    expect(wrongBase.status).toBe(1);
    expect(wrongBase.stdout + wrongBase.stderr).toContain("index.html");
    expect(run([join(dir, "missing")], { BASE_PATH: BASE }).status).toBe(2);
    expect(run([dir], { BASE_PATH: "nf-builder" }).status).toBe(2);
    expect(run(["--url", "http://127.0.0.1:1/"]).status).toBe(2);
    expect(run(["--nope"]).status).toBe(2);
  });
});
