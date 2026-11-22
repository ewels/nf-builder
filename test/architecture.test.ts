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

type Rule = { name: string; severity?: string; comment?: string };
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

  it("ADR-0003 F-501: tools/registry-snapshot may import lang-core and a pack entry, not pack internals or engine; other tools stay standalone", () => {
    const dir = makeWorkDir();
    mkdirSync(join(dir, "tools/corpus/src"), { recursive: true });
    writeFileSync(
      join(dir, "tools/corpus/src/index.ts"),
      `export const c = 1;\n`,
    );
    const entry = runArch(dir);
    expect(entry.output).toContain("no dependency violations found");
    expect(entry.status).toBe(0);

    const rule = "registry-snapshot-imports-only-lang-core-and-pack-entries";
    const tool = "tools/registry-snapshot/src/bad.ts";
    for (const [specifier, target] of [
      [
        "../../../packages/lang-2610/src/version",
        "packages/lang-2610/src/version.ts",
      ],
      ["../../../packages/engine/src/index", "packages/engine/src/index.ts"],
      ["../../corpus/src/index", "tools/corpus/src/index.ts"],
    ] as const) {
      writeFileSync(join(dir, tool), `export * from "${specifier}";\n`);
      const { status, output } = runArch(dir);
      expect(status, specifier).not.toBe(0);
      expect(output).toContain(`error ${rule}: ${tool} → ${target}`);
    }
    rmSync(join(dir, tool));

    writeFileSync(
      join(dir, "tools/corpus/src/index.ts"),
      `export * from "../../registry-snapshot/src/index";\n`,
    );
    const other = runArch(dir);
    expect(other.status).not.toBe(0);
    expect(other.output).toContain(
      "error tools-standalone: tools/corpus/src/index.ts → tools/registry-snapshot/src/index.ts",
    );
  });

  const CORPUS = "tools/corpus/src/index.ts";
  const violations: [string, string, string, string][] = [
    [
      "lang-core-imports-nothing-internal",
      "packages/lang-core/src/bad.ts",
      "../../engine/src/index",
      "packages/engine/src/index.ts",
    ],
    [
      "pack-imports-only-lang-core",
      "packages/lang-2610/src/bad.ts",
      "../../engine/src/index",
      "packages/engine/src/index.ts",
    ],
    [
      "engine-imports-only-lang-core-and-pack-entries",
      "packages/engine/src/bad.ts",
      "../../sources/src/index",
      "packages/sources/src/index.ts",
    ],
    [
      "sources-imports-only-lang-core",
      "packages/sources/src/bad.ts",
      "../../engine/src/index",
      "packages/engine/src/index.ts",
    ],
    [
      "web-not-to-pack",
      "apps/web/src/bad.ts",
      "../../../packages/lang-2610/src/index",
      "packages/lang-2610/src/index.ts",
    ],
    [
      "web-imports-only-listed-packages",
      "apps/web/src/bad.ts",
      "../../../tools/corpus/src/index",
      CORPUS,
    ],
    [
      "tools-standalone",
      CORPUS,
      "../../../packages/lang-core/src/index",
      "packages/lang-core/src/index.ts",
    ],
    [
      "web-src-not-to-build-scripts",
      "apps/web/src/bad.ts",
      "../../../scripts/build",
      "scripts/build.ts",
    ],
    [
      "web-src-not-to-build-scripts",
      "apps/web/src/bad.ts",
      "../../../e2e/helper",
      "e2e/helper.ts",
    ],
    [
      "lang-core-imports-nothing-internal",
      "packages/lang-core/src/bad.ts",
      "../../../scripts/build",
      "scripts/build.ts",
    ],
    [
      "pack-imports-only-lang-core",
      "packages/lang-2610/src/bad.ts",
      "../../../scripts/build",
      "scripts/build.ts",
    ],
    [
      "engine-imports-only-lang-core-and-pack-entries",
      "packages/engine/src/bad.ts",
      "../../../scripts/build",
      "scripts/build.ts",
    ],
    [
      "sources-imports-only-lang-core",
      "packages/sources/src/bad.ts",
      "../../../scripts/build",
      "scripts/build.ts",
    ],
    ["tools-standalone", CORPUS, "../../../scripts/build", "scripts/build.ts"],
  ];

  const BUILD_SCRIPT = "scripts/build.ts";
  it.each(violations)(
    "ADR-0003: rule %s rejects a forbidden import and says where the code should go",
    (name, from, specifier, target) => {
      const dir = makeWorkDir();
      mkdirSync(join(dir, "tools/corpus/src"), { recursive: true });
      mkdirSync(join(dir, "scripts"), { recursive: true });
      mkdirSync(join(dir, "e2e"), { recursive: true });
      writeFileSync(join(dir, BUILD_SCRIPT), `export const build = 1;\n`);
      writeFileSync(join(dir, "e2e/helper.ts"), `export const helper = 1;\n`);
      if (from === CORPUS)
        writeFileSync(join(dir, CORPUS), `export * from "${specifier}";\n`);
      else {
        writeFileSync(join(dir, CORPUS), `export const corpus = 1;\n`);
        writeFileSync(join(dir, from), `export * from "${specifier}";\n`);
      }

      const { status, output } = runArch(dir);
      const rule = rules.find((r) => r.name === name);

      expect(rule, name).toBeDefined();
      expect(status).not.toBe(0);
      expect(output).toContain(`error ${name}: ${from} → ${target}`);
      expect(collapse(output)).toContain(collapse(rule?.comment ?? "missing"));
    },
  );

  it("ADR-0014: apps/web/vite.config.ts and e2e may import the root build-time scripts", () => {
    const dir = makeWorkDir();
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "e2e"), { recursive: true });
    writeFileSync(join(dir, "scripts/build.ts"), `export const build = 1;\n`);
    writeFileSync(
      join(dir, "apps/web/vite.config.ts"),
      `export { build } from "../../scripts/build";\n`,
    );
    writeFileSync(
      join(dir, "e2e/spec.ts"),
      `export { build } from "../scripts/build";\n`,
    );
    const { status, output } = runArch(dir);
    expect(output).toContain("no dependency violations found");
    expect(status).toBe(0);
  });

  it("ADR-0003: the real repository's arch check cruises at least one module", () => {
    const { status, output } = runArch(repoRoot);
    expect(status).toBe(0);
    const count = /\((\d+) modules/.exec(output)?.[1];
    expect(Number(count)).toBeGreaterThan(0);
  });

  it("ADR-0003: every rule is an error whose comment says where the code should go instead", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.severity, rule.name).toBe("error");
      expect(rule.comment, rule.name).toMatch(/ADR 0003/);
      expect(rule.comment, rule.name).toMatch(/(packages|apps|tools)\/[a-z<]/);
    }
  });
});
