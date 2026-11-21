import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  checkFeatureScope,
  isScopeChange,
  parseLabels,
} from "../scripts/check-features-scope.ts";

type F = Record<string, unknown>;

function feature(id: string, extra: F = {}): F {
  return {
    id,
    milestone: "M0",
    description: `Feature ${id}`,
    spec: ["UX-01"],
    depends_on: [],
    steps: ["one", "two"],
    passes: false,
    notes: "",
    ...extra,
  };
}

function featuresJson(features: F[], comment = "x"): string {
  return `${JSON.stringify({ $comment: comment, features }, null, 2)}\n`;
}

const base = () => [
  feature("F-001", { notes: "A." }),
  feature("F-002"),
  feature("F-003"),
];

function withHead(change: (features: F[]) => F[]): {
  baseText: string;
  headText: string;
} {
  return {
    baseText: featuresJson(base()),
    headText: featuresJson(change(base())),
  };
}

const reword = () =>
  withHead((fs) =>
    fs.map((f) => (f.id === "F-002" ? { ...f, description: "Reworded" } : f)),
  );

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "scope-"));
  dirs.push(d);
  return d;
}

describe("features.json scope guard", () => {
  it("F-004 step 2: rewording a feature description fails the guard without the scope-change label", () => {
    const { baseText, headText } = reword();
    const v = checkFeatureScope({ baseText, headText, labels: [] });
    expect(v.ok).toBe(false);
    expect(v.problems).toHaveLength(1);
    const p = v.problems[0];
    for (const s of ["F-002", '"description"', "scope-change", "ADR 0012"])
      expect(p?.message).toContain(s);
    const line =
      headText.split("\n").findIndex((l) => l.includes('"id": "F-002"')) + 1;
    expect(p?.line).toBe(line);
  });

  it("F-004 step 2: the same rewording passes with the scope-change label", () => {
    const { baseText, headText } = reword();
    const v = checkFeatureScope({
      baseText,
      headText,
      labels: ["maintainer", "scope-change"],
    });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.labelled).toBe(true);
    expect(
      v.changes.some((c) => c.kind === "field" && c.field === "description"),
    ).toBe(true);
  });

  it("F-004 ADR-0012: setting passes either way and appending to notes pass without a label", () => {
    const baseText = featuresJson([
      feature("F-001", { passes: false }),
      feature("F-002", { passes: true }),
      feature("F-003", { notes: "" }),
      feature("F-004", { notes: "A." }),
    ]);
    const headText = featuresJson([
      feature("F-001", { passes: true }),
      feature("F-002", { passes: false }),
      feature("F-003", { notes: "Verified it." }),
      feature("F-004", { notes: "A. B." }),
    ]);
    const v = checkFeatureScope({ baseText, headText, labels: [] });
    expect(v.ok).toBe(true);
    expect(v.changes.filter((c) => c.kind === "passes")).toHaveLength(2);
    expect(v.changes.filter((c) => c.kind === "notes-appended")).toHaveLength(
      2,
    );
    expect(v.changes.some(isScopeChange)).toBe(false);
  });

  it("F-004 ADR-0012: editing or removing existing notes needs the scope-change label", () => {
    for (const [from, to] of [
      ["A. B.", "A. C."],
      ["A.", ""],
    ] as const) {
      const baseText = featuresJson([feature("F-001", { notes: from })]);
      const headText = featuresJson([feature("F-001", { notes: to })]);
      const without = checkFeatureScope({ baseText, headText, labels: [] });
      expect(without.ok).toBe(false);
      expect(without.changes.map((c) => c.kind)).toContain("notes-rewritten");
      expect(
        checkFeatureScope({ baseText, headText, labels: ["scope-change"] }).ok,
      ).toBe(true);
    }
  });

  const cases: [string, (fs: F[]) => F[], string?][] = [
    [
      "a changed milestone",
      (fs) => fs.map((f) => (f.id === "F-002" ? { ...f, milestone: "M9" } : f)),
    ],
    [
      "a removed spec entry",
      (fs) => fs.map((f) => (f.id === "F-002" ? { ...f, spec: [] } : f)),
    ],
    [
      "an added depends_on",
      (fs) =>
        fs.map((f) => (f.id === "F-002" ? { ...f, depends_on: ["F-001"] } : f)),
    ],
    [
      "a reworded step",
      (fs) =>
        fs.map((f) => (f.id === "F-002" ? { ...f, steps: ["one", "2"] } : f)),
    ],
    [
      "an added step",
      (fs) =>
        fs.map((f) =>
          f.id === "F-002" ? { ...f, steps: ["one", "two", "3"] } : f,
        ),
    ],
    [
      "a renamed id",
      (fs) => fs.map((f) => (f.id === "F-002" ? { ...f, id: "F-020" } : f)),
    ],
    ["an added feature", (fs) => [...fs, feature("F-009")]],
    ["a removed feature", (fs) => fs.filter((f) => f.id !== "F-003")],
    [
      "two swapped features",
      (fs) => [fs[1] as F, fs[0] as F, fs[2] as F],
      "F-002",
    ],
    [
      "an unknown key on a feature",
      (fs) => fs.map((f) => (f.id === "F-002" ? { ...f, extra: 1 } : f)),
    ],
  ];
  it.each(cases)(
    "F-004 ADR-0012: %s needs the scope-change label",
    (_name, change, mention) => {
      const { baseText, headText } = withHead(change);
      const without = checkFeatureScope({ baseText, headText, labels: [] });
      expect(without.ok).toBe(false);
      if (mention) {
        const text = without.problems.map((p) => p.message).join("\n");
        expect(text).toContain(mention);
        expect(text).toContain("F-001");
      }
      expect(
        checkFeatureScope({ baseText, headText, labels: ["scope-change"] }).ok,
      ).toBe(true);
    },
  );

  it("F-004 ADR-0012: a changed $comment needs the scope-change label", () => {
    const baseText = featuresJson(base(), "x");
    const headText = featuresJson(base(), "y");
    expect(checkFeatureScope({ baseText, headText, labels: [] }).ok).toBe(
      false,
    );
    expect(
      checkFeatureScope({ baseText, headText, labels: ["scope-change"] }).ok,
    ).toBe(true);
  });

  it("F-004: only the exact scope-change label counts", () => {
    const { baseText, headText } = reword();
    for (const label of ["scope change", "Scope-Change", "maintainer"])
      expect(
        checkFeatureScope({ baseText, headText, labels: [label] }).ok,
        label,
      ).toBe(false);
  });

  it("F-004: an unchanged or only reformatted features.json passes with no changes", () => {
    const text = featuresJson(base());
    expect(
      checkFeatureScope({ baseText: text, headText: text, labels: [] }).changes,
    ).toEqual([]);
    const reordered = base().map((f) =>
      Object.fromEntries(Object.entries(f).reverse()),
    );
    const headText = `${JSON.stringify({ features: reordered, $comment: "x" }, null, 4)}\n`;
    const v = checkFeatureScope({ baseText: text, headText, labels: [] });
    expect(v.changes).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("F-004: a head features.json that can't be compared fails even with the label", () => {
    const baseText = featuresJson(base());
    const heads = [
      "{",
      JSON.stringify({ features: {} }),
      JSON.stringify({ features: [{ description: "x" }] }),
      JSON.stringify({ features: [feature("F-001"), feature("F-001")] }),
    ];
    for (const headText of heads) {
      const v = checkFeatureScope({
        baseText,
        headText,
        labels: ["scope-change"],
      });
      expect(v.ok, headText).toBe(false);
      expect(v.problems).toHaveLength(1);
      expect(v.problems[0]?.message).toContain("pnpm check:features");
    }
  });

  it("F-004: an unreadable base features.json throws", () => {
    expect(() =>
      checkFeatureScope({
        baseText: "{",
        headText: featuresJson(base()),
        labels: [],
      }),
    ).toThrow();
  });

  it("F-004: PR_LABELS is a JSON array of label names", () => {
    expect(parseLabels(undefined)).toEqual([]);
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels("[]")).toEqual([]);
    expect(parseLabels('[\n  "scope-change"\n]')).toEqual(["scope-change"]);
    expect(() => parseLabels("scope-change")).toThrow(
      "JSON array of label names",
    );
    expect(() => parseLabels("[1]")).toThrow("JSON array of label names");
  });
});

describe("features.json scope guard command line", () => {
  function run(args: string[], env: Record<string, string> = {}) {
    const e: Record<string, string | undefined> = { ...process.env };
    delete e.PR_LABELS;
    delete e.GITHUB_ACTIONS;
    const r = spawnSync(
      process.execPath,
      ["scripts/check-features-scope.ts", ...args],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...e, ...env },
      },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it("F-004 step 2: node scripts/check-features-scope.ts exits 1 on a reworded description and 0 once PR_LABELS has scope-change", () => {
    const d = tmp();
    const { baseText, headText } = reword();
    writeFileSync(join(d, "base.json"), baseText);
    writeFileSync(join(d, "head.json"), headText);
    const args = [
      "--base",
      join(d, "base.json"),
      "--head",
      join(d, "head.json"),
    ];
    const bad = run(args);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain("F-002");
    expect(bad.out).toContain("scope-change");
    expect(bad.out).toContain('Only "passes" changes');
    expect(bad.out).not.toContain("::error ");
    expect(run(args, { GITHUB_ACTIONS: "true" }).out).toContain("::error ");
    const ok = run(args, { PR_LABELS: '["scope-change"]' });
    expect(ok.status).toBe(0);
    expect(ok.out).toContain("allowed by the scope-change label");
    expect(ok.out).toContain('"description" changed');
  });

  it("F-004: the scope guard exits 2 without --base, with a missing base file, or with bad PR_LABELS", () => {
    const d = tmp();
    writeFileSync(join(d, "base.json"), featuresJson(base()));
    for (const r of [
      run([]),
      run(["--base", join(d, "missing.json")]),
      run(["--base", join(d, "base.json")], { PR_LABELS: "nope" }),
    ]) {
      expect(r.status).toBe(2);
      expect(r.out.trim().length).toBeGreaterThan(10);
    }
  });

  it("F-004: the scope guard imports only node: built-ins and the other checkers, so its CI job needs no pnpm install", () => {
    const text = readFileSync(
      join(REPO_ROOT, "scripts/check-features-scope.ts"),
      "utf8",
    );
    const specs = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs)
      expect(
        s.startsWith("node:") ||
          s === "./check-common.ts" ||
          s === "./check-features.ts",
        s,
      ).toBe(true);
  });
});

describe("Scope guard workflow", () => {
  it("F-004 step 2: the Scope guard workflow re-runs on label changes and compares the PR merge commit with its base", () => {
    const yml = readFileSync(
      join(REPO_ROOT, ".github/workflows/scope-guard.yml"),
      "utf8",
    );
    const on = yml.slice(yml.indexOf("on:"), yml.indexOf("permissions:"));
    for (const t of [
      "pull_request",
      "opened",
      "synchronize",
      "reopened",
      "labeled",
      "unlabeled",
    ])
      expect(on, t).toContain(t);
    expect(yml).not.toContain("pull_request_target");
    expect(yml).toContain("contents: read");
    expect(yml).toContain("fetch-depth: 2");
    expect(yml).toContain("git show HEAD^1:docs/plan/features.json");
    expect(yml).toContain(
      `PR_LABELS: \${{ toJSON(github.event.pull_request.labels.*.name) }}`,
    );
    expect(yml).toContain("\n    name: Scope guard\n");
    expect(yml).toContain("node scripts/check-features-scope.ts --base");
    expect(yml).not.toContain("pnpm install");
    expect(yml).not.toContain("./.github/actions/setup");
  });
});
