import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_HEADER,
  FIXTURES_DIR,
  loadFixtures,
  parseFixtures,
} from "../src/fixtures.ts";
import { REPO_ROOT } from "../src/manifest.ts";

const { fixtures } = loadFixtures();
const read = (file: string) => readFileSync(join(FIXTURES_DIR, file), "utf8");
const find = (file: string) => {
  const fixture = fixtures.find((f) => f.file === file);
  if (!fixture) throw new Error(`${file} is not listed in fixtures.yaml`);
  return fixture;
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function declarationPattern(name: string): RegExp {
  const [kind = "", rest = ""] = name.split(" ", 2);
  const n = escapeRegex(rest);
  switch (kind) {
    case "process":
      return new RegExp(`^process ${n}\\s*\\{`, "m");
    case "workflow":
      return rest === ""
        ? /^workflow\s*\{/m
        : new RegExp(`^workflow ${n}\\s*\\{`, "m");
    case "block":
      return new RegExp(`^${n}\\s*\\{`, "m");
    default:
      return new RegExp(`^${n}\\s*=`, "m");
  }
}

describe("malformed fixtures", () => {
  it("F-009 step 3 ADR-0011: every file in tools/corpus/fixtures is listed once in fixtures.yaml, and every listed file exists", () => {
    const onDisk = readdirSync(FIXTURES_DIR)
      .filter((f) => f !== "fixtures.yaml")
      .sort();
    expect(fixtures.map((f) => f.file).sort()).toEqual(onDisk);
  });

  it("F-009 step 3: each fixture's first line says it is malformed on purpose and matches its breaks entry", () => {
    for (const fixture of fixtures)
      expect(read(fixture.file).split("\n")[0], fixture.file).toBe(
        FIXTURE_HEADER + fixture.breaks,
      );
  });

  it("F-009 step 3: fixtures are not git-ignored, so they are committed; the corpus cache is git-ignored", () => {
    const ignored = (path: string) =>
      spawnSync("git", ["check-ignore", "-q", path], {
        cwd: REPO_ROOT,
        env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
      }).status;
    for (const fixture of fixtures)
      expect(
        ignored(`tools/corpus/fixtures/${fixture.file}`),
        fixture.file,
      ).toBe(1);
    expect(ignored(".cache/corpus/rnaseq/main.nf")).toBe(0);
  });

  it("ADR-0011: the fixtures cover a whole-file failure, a bad declaration among good ones, unbalanced braces, mixed typed and legacy code and an unknown config scope", () => {
    expect(find("unclosed-comment.nf").expect).toEqual({ wholeFile: true });
    for (const file of [
      "bad-declaration.nf",
      "unclosed-brace.nf",
      "unclosed-config-block.config",
      "typed-legacy-mixed.nf",
    ])
      expect(find(file).expect.wholeFile, file).toBe(false);
    const scope = find("unknown-scope.config");
    expect(scope.lint).toBe("ok");
    expect(scope.expect).toMatchObject({ wholeFile: false, unparsed: [] });
    const nonEmpty = (ext: string) =>
      fixtures.some(
        (f) =>
          f.file.endsWith(ext) &&
          !f.expect.wholeFile &&
          f.expect.unparsed.length > 0,
      );
    expect(nonEmpty(".nf")).toBe(true);
    expect(nonEmpty(".config")).toBe(true);
  });

  it("F-009: every declaration named in fixtures.yaml appears in its fixture", () => {
    for (const fixture of fixtures) {
      if (fixture.expect.wholeFile) continue;
      const text = read(fixture.file);
      const { unparsed, modelled } = fixture.expect;
      for (const name of [...unparsed, ...modelled])
        expect(text, `${fixture.file}: ${name}`).toMatch(
          declarationPattern(name),
        );
      for (const name of unparsed)
        expect(modelled, `${fixture.file}: ${name}`).not.toContain(name);
    }
  });
});

const ok = (extra = "") =>
  `fixtures:\n  - file: a.nf\n    breaks: b\n    lint: error\n    expect:\n      wholeFile: true\n${extra}`;

describe("parseFixtures", () => {
  it.each([
    ["unknown lint outcome", ok().replace("lint: error", "lint: warn")],
    [
      "wholeFile with unparsed",
      ok().replace(
        "wholeFile: true",
        "wholeFile: true\n      unparsed: [process A]",
      ),
    ],
    [
      "bad declaration kind",
      ok().replace(
        "wholeFile: true",
        "unparsed: [class Foo]\n      modelled: []",
      ),
    ],
    ["duplicate file", `${ok()}${ok().replace("fixtures:\n", "")}`],
    ["bad file extension", ok().replace("a.nf", "x.groovy")],
  ])("F-009: parseFixtures rejects a bad entry: %s", (_name, text) => {
    const result = parseFixtures(text);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problems.join("\n")).toMatch(/fixtures\[\d+\]/);
  });

  it("F-009: parseFixtures reports one problem when expect has neither wholeFile nor unparsed and modelled", () => {
    const result = parseFixtures(
      ok().replace("wholeFile: true", "wholeFile: false"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(1);
  });

  it("F-009: parseFixtures accepts a minimal valid entry", () => {
    expect(parseFixtures(ok()).ok).toBe(true);
  });
});
