import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(repoRoot, "test/fixtures/boundaries");
const configFile = join(repoRoot, ".dependency-cruiser.cjs");
const archScript: string = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
).scripts.arch;

type Rule = { name: string; comment?: string };
const rules: Rule[] = createRequire(import.meta.url)(configFile).forbidden;

const workDirs: string[] = [];
afterEach(() => {
  for (const dir of workDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Copies the fixture repo and the real dependency-cruiser config to a temporary directory. */
function makeWorkDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nf-builder-arch-")));
  workDirs.push(dir);
  cpSync(fixture, dir, { recursive: true });
  cpSync(configFile, join(dir, ".dependency-cruiser.cjs"));
  return dir;
}

/** Runs the root `arch` script, exactly as `pnpm check` does, in `cwd`. */
function runArch(cwd: string): { status: number | null; output: string } {
  const result = spawnSync("sh", ["-c", archScript], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH}`,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const collapse = (text: string): string => text.replace(/\s+/g, " ");

describe("ADR-0003 package boundaries", () => {
  it("ADR-0003: imports the table allows pass the arch check", () => {
    const { status, output } = runArch(makeWorkDir());
    expect(output).toContain("no dependency violations found");
    expect(status).toBe(0);
  });

  it.each([
    [
      "a relative path",
      `import { pack } from "../../../packages/lang-2610/src/index";\nexport const v = pack;\n`,
    ],
    [
      "the package name",
      `import { pack } from "@nf-builder/lang-2610";\nexport const v = pack;\n`,
    ],
    [
      "a type-only import",
      `import type { pack } from "@nf-builder/lang-2610";\nexport type V = typeof pack;\n`,
    ],
  ])(
    "F-001 step 2: importing packages/lang-2610 from apps/web by %s fails, naming the rule and the alternative",
    (_how, source) => {
      const dir = makeWorkDir();
      mkdirSync(join(dir, "apps/web/node_modules/@nf-builder"), {
        recursive: true,
      });
      symlinkSync(
        join(dir, "packages/lang-2610"),
        join(dir, "apps/web/node_modules/@nf-builder/lang-2610"),
        "dir",
      );
      writeFileSync(join(dir, "apps/web/src/imports-pack.ts"), source);

      const { status, output } = runArch(dir);
      const rule = rules.find((r) => r.name === "web-not-to-pack");

      expect(status).not.toBe(0);
      expect(output).toContain(
        "error web-not-to-pack: apps/web/src/imports-pack.ts → packages/lang-2610/src/index.ts",
      );
      expect(rule?.comment).toMatch(/packages\/engine/);
      expect(collapse(output)).toContain(collapse(rule?.comment ?? "missing"));
      expect(output).toContain("1 dependency violations");
    },
  );

  it("ADR-0003: engine may import a pack's entry module but not its internals", () => {
    const dir = makeWorkDir();
    const entry = runArch(dir);
    expect(entry.output).toContain("no dependency violations found");
    expect(entry.status).toBe(0);

    writeFileSync(
      join(dir, "packages/engine/src/reaches-in.ts"),
      `import { VERSION } from "../../lang-2610/src/version";\nexport const v = VERSION;\n`,
    );
    const { status, output } = runArch(dir);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "error engine-imports-only-lang-core-and-pack-entries: packages/engine/src/reaches-in.ts → packages/lang-2610/src/version.ts",
    );
  });

  it("ADR-0003: every rule is an error whose comment says where the code should go instead", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.comment, rule.name).toMatch(/ADR 0003/);
      expect(rule.comment, rule.name).toMatch(/(packages|apps|tools)\/[a-z<]/);
    }
  });
});
