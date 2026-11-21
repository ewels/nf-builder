import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cspProblems,
  readNetlifyConfig,
  siteHeaders,
} from "../scripts/netlify-config.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string) =>
  JSON.parse(readFileSync(`${repoRoot}${path}`, "utf8"));
const rootPkg = readJson("package.json");
const webPkg = readJson("apps/web/package.json");
const config = readNetlifyConfig();

/** Checks an exact x.y.z against a ^a.b.c range; throws on any other range form. */
function satisfiesCaret(version: string, range: string): boolean {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!match) throw new Error(`unsupported range ${range}`);
  const v = version.split(".").map(Number);
  const r = match.slice(1).map(Number);
  if (v.length !== 3 || v.some(Number.isNaN))
    throw new Error(`not an exact version: ${version}`);
  const [vMajor = 0, vMinor = 0, vPatch = 0] = v;
  const [rMajor = 0, rMinor = 0, rPatch = 0] = r;
  if (vMajor !== rMajor) return false;
  if (vMinor !== rMinor) return vMinor > rMinor;
  return vPatch >= rPatch;
}

describe("netlify.toml", () => {
  it("F-002 step 2: netlify.toml builds @nf-builder/web and publishes apps/web/dist", () => {
    expect(config.build.command).toBe(`pnpm --filter ${webPkg.name} build`);
    expect(webPkg.scripts.build).toBeTypeOf("string");
    expect(config.build.publish).toBe("apps/web/dist");
  });

  it("F-002 step 2: NODE_VERSION in netlify.toml satisfies engines.node", () => {
    const node = config.build.environment.NODE_VERSION ?? "";
    expect(satisfiesCaret(node, rootPkg.engines.node)).toBe(true);
  });

  it("F-002 step 2: PNPM_VERSION in netlify.toml equals the packageManager version", () => {
    expect(config.build.environment.PNPM_VERSION).toBe(
      rootPkg.packageManager.replace(/^pnpm@/, ""),
    );
  });

  it("F-002 step 2: every route falls back to /index.html with status 200", () => {
    const rule = config.redirects.find((r) => r.from === "/*");
    expect(rule?.to).toBe("/index.html");
    expect(rule?.status).toBe(200);
    expect(rule?.force).not.toBe(true);
  });

  it("F-002 step 2: netlify.toml sets the security headers for every path", () => {
    expect(config.headers.filter((h) => h.for === "/*")).toHaveLength(1);
    expect(Object.keys(siteHeaders(config)).sort()).toEqual(
      [
        "Content-Security-Policy",
        "Cross-Origin-Opener-Policy",
        "Cross-Origin-Resource-Policy",
        "Permissions-Policy",
        "Referrer-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
      ].sort(),
    );
  });

  it("ADR-0002 QA-30: the netlify.toml Content-Security-Policy is one line, allows no inline or eval scripts, and limits connect-src to the ADR 0002 allow-list", () => {
    const csp = siteHeaders(config)["Content-Security-Policy"] ?? "";
    expect(cspProblems(csp)).toEqual([]);
  });

  const base = "default-src 'self'; script-src 'self'; connect-src 'self'";
  it.each([
    [
      "'unsafe-inline'",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    ],
    [
      "'unsafe-eval'",
      "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'",
    ],
    [
      "'unsafe-hashes'",
      "default-src 'self'; script-src 'self' 'unsafe-hashes'; connect-src 'self'",
    ],
    [
      "a sha256 source",
      "default-src 'self'; script-src 'self' 'sha256-abc='; connect-src 'self'",
    ],
    [
      "a nonce source",
      "default-src 'self'; script-src 'self' 'nonce-abc'; connect-src 'self'",
    ],
    ["a missing script-src", "default-src 'self'; connect-src 'self'"],
    ["a missing connect-src", "default-src 'self'; script-src 'self'"],
    [
      "a connect-src with example.com",
      "default-src 'self'; script-src 'self'; connect-src 'self' https://example.com",
    ],
    [
      "a connect-src of *",
      "default-src 'self'; script-src 'self'; connect-src *",
    ],
    ["a newline", `${base};\nimg-src 'self'`],
    ["a comma", `${base}, img-src 'self'`],
  ])("QA-30: cspProblems rejects %s", (_name, policy) => {
    expect(cspProblems(policy).length).toBeGreaterThan(0);
  });

  const withScriptSource = (directive: string, source: string) =>
    directive === "script-src"
      ? `default-src 'self'; script-src 'self' ${source}; connect-src 'self'`
      : `default-src 'self'; script-src 'self'; ${directive} 'self' ${source}; connect-src 'self'`;
  it.each(
    ["data:", "blob:", "*", "https:", "http:"].flatMap((source) =>
      ["default-src", "script-src", "script-src-elem", "script-src-attr"].map(
        (directive) =>
          [`${source} in ${directive}`, directive, source] as const,
      ),
    ),
  )("QA-30: cspProblems rejects %s", (_name, directive, source) => {
    const problems = cspProblems(withScriptSource(directive, source));
    expect(problems).toContain(`${directive} allows ${source}`);
  });
});
