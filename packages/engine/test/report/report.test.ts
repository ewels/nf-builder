import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyShare, projectReport } from "../../src/report/report";
import { diagnoseFiles } from "../diagnostics/open";
import { readTree } from "../model/read-tree";
import { projectorFor } from "../projection/open";

const ROOT = join(import.meta.dirname, "../../../..");
const s1 = join(ROOT, "tools/oracle/cases/s1-legacy-calls-typed-module");

async function build() {
  const files = [
    ...readTree(s1),
    {
      path: "bad.nf",
      text: readFileSync(
        join(ROOT, "tools/corpus/fixtures/bad-declaration.nf"),
        "utf8",
      ),
    },
  ];
  const { model, diagnoser } = await diagnoseFiles(files);
  const projector = await projectorFor(model);
  return { model, projector, diagnoser };
}

describe("project report", () => {
  it("F-401 step 3 UX-61: the report lists bad.nf as partial with process SECOND kept as text, and counts TYPED_COUNT typed, FIRST legacy and both entry workflows legacy", async () => {
    const { model, projector, diagnoser } = await build();
    const report = projectReport(model, projector.workflows(), diagnoser.all());
    expect(report.files).toBe(model.paths().length);
    expect(report.parseFailures).toHaveLength(1);
    const failure = report.parseFailures[0];
    expect(failure?.path).toBe("bad.nf");
    expect(failure?.status).toBe("partial");
    expect(failure?.problems).toBeGreaterThan(0);
    expect(failure?.unparsed).toEqual([{ keyword: "process", name: "SECOND" }]);
    expect(report.processes).toEqual({ typed: 1, legacy: 1 });
    expect(report.workflows).toEqual({ typed: 0, legacy: 2 });
  });

  it("F-401 UX-61: legacyShare is legacy over typed plus legacy processes and workflows; suggestions equal countDiagnostics", async () => {
    expect(
      legacyShare({
        processes: { typed: 1, legacy: 1 },
        workflows: { typed: 0, legacy: 2 },
      }),
    ).toEqual({ legacy: 3, total: 4 });
    expect(
      legacyShare({
        processes: { typed: 0, legacy: 0 },
        workflows: { typed: 0, legacy: 0 },
      }),
    ).toEqual({ legacy: 0, total: 0 });
    const { model, projector, diagnoser } = await build();
    const all = diagnoser.all();
    const report = projectReport(model, projector.workflows(), all);
    expect(report.diagnostics.suggestions).toBe(
      all.filter((d) => d.severity === "suggestion").length,
    );
  });
});
