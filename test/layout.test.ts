import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Packages and their Role, copied verbatim from the table in docs/adr/0003-stack-and-repo-layout.md. */
const PACKAGES: Record<string, string> = {
  "packages/lang-core":
    "Model types, edit commands, the language pack interface",
  "packages/lang-2610": "Nextflow 26.10 pack (ADR 0006)",
  "packages/engine":
    "Parse, model, projection, edits, printing. No DOM; runs in a worker",
  "packages/sources": "GitHub, zip and registry clients",
  "apps/web": "The app",
};

const isDir = (path: string): boolean =>
  existsSync(path) && statSync(path).isDirectory();
const readmeLines = (dir: string): string[] =>
  readFileSync(join(repoRoot, dir, "README.md"), "utf8")
    .trimEnd()
    .split("\n");

describe("F-001 step 3: package layout", () => {
  it.each(Object.entries(PACKAGES))(
    "F-001: %s has src/, test/ and a README of at most 10 lines stating its ADR 0003 role",
    (dir, role) => {
      expect(isDir(join(repoRoot, dir, "src")), `${dir}/src`).toBe(true);
      expect(isDir(join(repoRoot, dir, "test")), `${dir}/test`).toBe(true);
      const lines = readmeLines(dir);
      expect(lines.length).toBeLessThanOrEqual(10);
      expect(lines.join(" ")).toContain(role);
    },
  );

  it("ADR-0003: every directory under packages/ and apps/ is a package from the ADR 0003 table", () => {
    const found = ["packages", "apps"].flatMap((parent) =>
      readdirSync(join(repoRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`),
    );
    expect(found.sort()).toEqual(Object.keys(PACKAGES).sort());
  });
});
