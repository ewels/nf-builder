import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../../src/diagnostics/text-edits";
import {
  nodeAtRange,
  problemSections,
  problemTarget,
} from "../../src/problems";
import { diagnoseFiles, FIXTURES, fixtureDirs } from "../diagnostics/open";
import { readTree } from "../model/read-tree";
import { projectorFor } from "../projection/open";

const path = (rel: string) =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));
const problems = () => readTree(path("tools/oracle/cases/f309-problems"));
const fixed = () => readTree(path("tools/oracle/cases/f309-problems-fixed"));

const brief = (
  list: readonly {
    path: string;
    code: string;
    severity: string;
    range: { line: number; column: number };
  }[],
) =>
  list.map((d) => [
    d.path,
    d.code,
    d.severity,
    `${d.range.line}:${d.range.column}`,
  ]);

describe("F-309 fixtures", () => {
  it("F-309 step 1 LA-34 LA-35: f309-problems has one fixable deprecated-channel warning in main.nf and the legacy-workflow and legacy-process suggestions; f309-problems-fixed has only the two suggestions", async () => {
    const { diagnoser } = await diagnoseFiles(problems());
    const all = diagnoser.all();
    expect(brief(all)).toEqual([
      ["main.nf", "legacy-workflow", "suggestion", "3:1"],
      ["main.nf", "deprecated-channel", "warning", "4:15"],
      [
        "modules/local/legacy_count/main.nf",
        "legacy-process",
        "suggestion",
        "1:9",
      ],
    ]);
    expect(all.filter((d) => d.fix).map((d) => d.code)).toEqual([
      "deprecated-channel",
    ]);
    const clean = await diagnoseFiles(fixed());
    expect(brief(clean.diagnoser.all())).toEqual([
      ["main.nf", "legacy-workflow", "suggestion", "3:1"],
      [
        "modules/local/legacy_count/main.nf",
        "legacy-process",
        "suggestion",
        "1:9",
      ],
    ]);
  });

  it("F-309 UX-03: the f309 targets: the warning selects main.nf#/numbers, legacy-workflow reveals main.nf's code, legacy-process opens a file tab", async () => {
    const { model, diagnoser } = await diagnoseFiles(problems());
    const projection = (await projectorFor(model)).project("main.nf", null);
    if (projection === null) throw new Error("no projection");
    const workflows = [projection.workflow];
    const find = (code: string) => {
      const d = diagnoser.all().find((x) => x.code === code);
      if (!d) throw new Error(code);
      return d;
    };
    const warning = find("deprecated-channel");
    expect(problemTarget(warning, workflows)).toMatchObject({
      kind: "workflow",
      inside: true,
    });
    expect(nodeAtRange(projection, warning.path, warning.range)).toBe(
      "main.nf#/numbers",
    );
    const legacyWorkflow = find("legacy-workflow");
    expect(problemTarget(legacyWorkflow, workflows)).toMatchObject({
      kind: "workflow",
      inside: true,
    });
    expect(
      nodeAtRange(projection, legacyWorkflow.path, legacyWorkflow.range),
    ).toBeNull();
    expect(problemTarget(find("legacy-process"), workflows)).toEqual({
      kind: "file",
      path: "modules/local/legacy_count/main.nf",
    });
  });

  it("F-309 step 2 ADR-0042: the deprecated-channel fix turns f309-problems/main.nf into f309-problems-fixed/main.nf byte for byte", async () => {
    const { model, diagnoser } = await diagnoseFiles(problems());
    const fix = diagnoser.all().find((d) => d.fix)?.fix;
    if (!fix) throw new Error("no fix");
    const text = model.file(fix.path)?.source.text ?? "";
    expect(applyTextEdits(text, fix.edits)).toBe(
      readFileSync(
        path("tools/oracle/cases/f309-problems-fixed/main.nf"),
        "utf8",
      ),
    );
  });

  it("F-309 AR-30 ADR-0042: no quick fix in the pack's lint fixtures carries more than 64 characters of replacement text", async () => {
    let fixes = 0;
    for (const { dir } of fixtureDirs()) {
      const { diagnoser } = await diagnoseFiles(readTree(dir));
      for (const d of diagnoser.all())
        for (const e of d.fix?.edits ?? []) {
          fixes++;
          expect(e.text.length, `${d.code} in ${dir}`).toBeLessThanOrEqual(64);
        }
    }
    expect(fixes).toBeGreaterThan(0);
    expect(FIXTURES).toContain("lints");
  });

  it("F-309 LA-31 LA-32 LA-33 LA-36: over the pack's lint fixtures, construct, type and arity errors land under Problems as errors, an unused output as a warning, and tuple, params and publishDir lints under Suggestions", async () => {
    // fixture code -> the section and severity its positive tree must produce
    const expected = [
      // LA-31
      ["feature-flag", "problems", "error"],
      ["pipeline-include-types", "problems", "error"],
      ["agent-output", "problems", "error"],
      ["config-include-placement", "problems", "error"],
      // LA-32
      ["type-mismatch", "problems", "error"],
      // LA-33
      ["call-arity", "problems", "error"],
      ["unused-output", "problems", "warning"],
      // LA-36
      ["tuple-where-record", "suggestions", "suggestion"],
      ["legacy-params", "suggestions", "suggestion"],
      ["params-outside-entry", "suggestions", "suggestion"],
      ["publish-dir", "suggestions", "suggestion"],
    ] as const;
    for (const [code, view, severity] of expected) {
      const dir = fixtureDirs().find(
        (f) => f.code === code && f.kind === "positive",
      )?.dir;
      if (dir === undefined) throw new Error(`no positive fixture for ${code}`);
      const { diagnoser } = await diagnoseFiles(readTree(dir));
      const sections = problemSections(diagnoser.all());
      const listed = sections[view]
        .flatMap((g) => g.diagnostics)
        .filter((d) => d.code === code);
      expect(listed.length, `${code} under ${view}`).toBeGreaterThan(0);
      expect(
        listed.every((d) => d.severity === severity),
        `${code} is a ${severity}`,
      ).toBe(true);
      const other = view === "problems" ? "suggestions" : "problems";
      expect(
        sections[other].flatMap((g) => g.diagnostics).map((d) => d.code),
        `${code} not under ${other}`,
      ).not.toContain(code);
    }
  });
});
