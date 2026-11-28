import { describe, expect, it } from "vitest";
import { workflowSuggestions } from "../../src/details/suggestions";
import { diagnoseFiles } from "../diagnostics/open";
import { projectorFor } from "../projection/open";

const MAIN = `process LEGACY {
    input:
    val x

    output:
    stdout

    script:
    """
    echo \${x}
    """
}

workflow INNER {
    LEGACY(1)
}

workflow {
    INNER()
}
`;

async function setup() {
  const { model, diagnoser } = await diagnoseFiles([
    { path: "main.nf", text: MAIN },
    {
      path: "other.nf",
      text: "workflow OTHER {\n    take:\n    x\n    main:\n    y = x\n}\n",
    },
  ]);
  const projector = await projectorFor(model);
  return { diagnoser, projector };
}

describe("F-405 suggestions per workflow", () => {
  it("F-405 LA-35: workflowSuggestions counts the suggestions inside the workflow, not in other workflows of the file or in other files", async () => {
    const { diagnoser, projector } = await setup();
    const all = diagnoser.all();
    expect(
      all.filter((d) => d.code === "legacy-process").map((d) => d.path),
    ).toEqual(["main.nf"]);
    const inner = projector.project("main.nf", "INNER")?.workflow;
    if (!inner) throw new Error("no INNER");
    const found = workflowSuggestions(inner, all);
    expect(found.map((d) => d.code)).toEqual(["legacy-workflow"]);
    expect(found.every((d) => d.path === "main.nf")).toBe(true);
    const warning = {
      ...(all[0] as (typeof all)[number]),
      severity: "warning" as const,
    };
    expect(
      workflowSuggestions(inner, [
        ...all,
        { ...warning, range: found[0]?.range ?? warning.range },
      ]),
    ).toHaveLength(1);
  });

  it("F-405 LA-35: an entry workflow's legacy-workflow suggestion at the workflow keyword is inside it", async () => {
    const { diagnoser, projector } = await setup();
    const entry = projector.project("main.nf", null)?.workflow;
    if (!entry) throw new Error("no entry");
    const found = workflowSuggestions(entry, diagnoser.all());
    expect(found.map((d) => d.code)).toEqual(["legacy-workflow"]);
    expect(found[0]?.range.start).toBe(entry.range.start);
  });
});
