import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  findCycles,
  knownSpecIds,
  validateFeatures,
} from "../scripts/check-features.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "nf-builder-feat-"));
  dirs.push(d);
  return d;
}

type F = Record<string, unknown>;
function feature(id: string, extra: F = {}): F {
  return {
    id,
    milestone: "M0",
    description: "Does a thing.",
    spec: ["QA-01"],
    depends_on: [],
    steps: ["It works."],
    passes: false,
    notes: "",
    ...extra,
  };
}
function file(features: F[]): string {
  return JSON.stringify({ $comment: "c", features }, null, 2);
}

describe("features.json validation", () => {
  it("F-003: features.json validation passes a valid feature list", () => {
    const text = file([
      feature("F-001", { passes: true }),
      feature("F-002", { depends_on: ["F-001"], passes: true }),
      feature("F-003", { depends_on: ["F-001", "F-002"] }),
    ]);
    expect(validateFeatures(text)).toEqual([]);
  });

  const withoutSteps = feature("F-001");
  delete withoutSteps.steps;
  it.each<[string, F]>([
    ["id F-1", feature("F-1")],
    ["id f-001", feature("f-001")],
    ["milestone X1", feature("F-001", { milestone: "X1" })],
    ["a missing steps key", withoutSteps],
    ["an unknown key status", feature("F-001", { status: "x" })],
    ["an empty description", feature("F-001", { description: "" })],
    ["spec QA-1", feature("F-001", { spec: ["QA-1"] })],
    ["spec that is not an array", feature("F-001", { spec: "QA-01" })],
    ["an empty spec", feature("F-001", { spec: [] })],
    ["depends_on that is not an array", feature("F-001", { depends_on: "x" })],
    ["empty steps", feature("F-001", { steps: [] })],
    ["blank steps", feature("F-001", { steps: [""] })],
    ['passes "yes"', feature("F-001", { passes: "yes" })],
    ["null notes", feature("F-001", { notes: null })],
  ])("F-003: features.json validation rejects %s", (_name, f) => {
    const problems = validateFeatures(file([f]));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(String(f.id));
  });

  it("F-003: features.json validation rejects duplicate ids, naming both lines", () => {
    const problems = validateFeatures(
      file([feature("F-001"), feature("F-001")]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/line \d+.*line \d+/);
  });

  it("F-003: features.json validation rejects a dependency on an unknown or the same id", () => {
    const problems = validateFeatures(
      file([
        feature("F-001", { depends_on: ["F-001"] }),
        feature("F-002", { depends_on: ["F-099"] }),
      ]),
    );
    const text = problems.map((p) => p.message).join("\n");
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("F-099");
    expect(text).toContain("itself");
  });

  it("F-003: features.json validation rejects a dependency cycle and prints its path", () => {
    const problems = validateFeatures(
      file([
        feature("F-010", { depends_on: ["F-011"] }),
        feature("F-011", { depends_on: ["F-012"] }),
        feature("F-012", { depends_on: ["F-010"] }),
      ]),
    );
    const cycles = problems.filter((p) => p.message.includes("cycle"));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.message).toContain("F-010 → F-011 → F-012 → F-010");
    expect(
      findCycles([
        { id: "A", depends_on: ["A"] },
        { id: "B", depends_on: [] },
      ]),
    ).toEqual([["A", "A"]]);
  });

  it("F-003: a feature cannot pass while a dependency does not", () => {
    const problems = validateFeatures(
      file([
        feature("F-006", { passes: true, depends_on: ["F-009"] }),
        feature("F-009"),
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("F-006");
    expect(problems[0]?.message).toContain("F-009");
    expect(problems[0]?.message).toContain('Set F-006 "passes" to false');
  });

  it("F-003: features.json validation rejects a spec ID that no docs/spec table or ADR defines", () => {
    const root = tmp();
    const specDir = join(root, "spec");
    const adrDir = join(root, "adr");
    require_mkdir(specDir);
    require_mkdir(adrDir);
    writeFileSync(
      join(specDir, "q.md"),
      "| ID | Text |\n|---|---|\n| QA-01 | x |\n",
    );
    writeFileSync(join(adrDir, "0011-x.md"), "# 0011. X\n");
    const specIds = knownSpecIds(specDir, adrDir);
    const ok = validateFeatures(
      file([feature("F-001", { spec: ["QA-01", "ADR-0011"] })]),
      { specIds },
    );
    expect(ok).toEqual([]);
    const bad = validateFeatures(
      file([feature("F-001", { spec: ["QA-99", "ADR-0099"] })]),
      { specIds },
    );
    expect(bad).toHaveLength(2);
  });

  it("F-003: features.json validation reports invalid JSON with the parser's message", () => {
    const problems = validateFeatures("{ nope");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("not valid JSON");
  });

  it("F-003 step 2: node scripts/check-features.ts --file <broken> exits 1 with the id, line and fix", () => {
    const root = tmp();
    const specDir = join(root, "spec");
    const adrDir = join(root, "adr");
    require_mkdir(specDir);
    require_mkdir(adrDir);
    writeFileSync(join(specDir, "q.md"), "| QA-01 | x |\n");
    const goodFile = join(root, "good.json");
    const badFile = join(root, "bad.json");
    writeFileSync(goodFile, file([feature("F-001")]));
    writeFileSync(
      badFile,
      file([
        feature("F-001", { passes: true, depends_on: ["F-002"] }),
        feature("F-002"),
      ]),
    );
    const run = (f: string) =>
      spawnSync(
        process.execPath,
        [
          "scripts/check-features.ts",
          "--file",
          f,
          "--spec-dir",
          specDir,
          "--adr-dir",
          adrDir,
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
    const bad = run(badFile);
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).toMatch(/bad\.json:\d+: F-001 passes/);
    expect(run(goodFile).status).toBe(0);
  });
});

import { mkdirSync } from "node:fs";

function require_mkdir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
