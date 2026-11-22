import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string) =>
  JSON.parse(readFileSync(`${repoRoot}${path}`, "utf8"));
const rootPkg = readJson("package.json");
const webPkg = readJson("apps/web/package.json");
const root = parse(readFileSync(`${repoRoot}netlify.toml`, "utf8")) as {
  build: {
    command: string;
    publish: string;
    environment: Record<string, string>;
  };
};

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
    expect(root.build.command).toBe(`pnpm --filter ${webPkg.name} build`);
    expect(webPkg.scripts.build).toBeTypeOf("string");
    expect(root.build.publish).toBe("apps/web/dist");
  });

  it("F-002 step 2: NODE_VERSION in netlify.toml satisfies engines.node", () => {
    const node = root.build.environment.NODE_VERSION ?? "";
    expect(satisfiesCaret(node, rootPkg.engines.node)).toBe(true);
  });

  it("F-002 step 2: PNPM_VERSION in netlify.toml equals the packageManager version", () => {
    expect(root.build.environment.PNPM_VERSION).toBe(
      rootPkg.packageManager.replace(/^pnpm@/, ""),
    );
  });

  it("F-002 step 2 ADR-0040: netlify.toml holds only [build] and [build.environment]: no headers, no redirects", () => {
    expect(Object.keys(root)).toEqual(["build"]);
    expect(Object.keys(root.build).sort()).toEqual([
      "command",
      "environment",
      "publish",
    ]);
  });
});
