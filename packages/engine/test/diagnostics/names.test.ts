import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../../src/diagnostics/text-edits";
import { diagnoseFiles } from "./open";

const B =
  "process B {\n    script:\n    'x'\n}\n\nprocess C {\n    script:\n    'x'\n}\n";

describe("F-112 names and includes", () => {
  it("F-112 AR-05: duplicate includes and declarations clashing with an include are reported where nf-lang reports them, and identical includes can be removed", async () => {
    const main = [
      "include { B ; C ; B } from './b.nf'",
      "include { C } from './b.nf'",
      "",
      "process B {",
      "    script:",
      "    'x'",
      "}",
      "",
      "workflow {",
      "    B()",
      "}",
      "",
    ].join("\n");
    const { diagnoser } = await diagnoseFiles([
      { path: "b.nf", text: B },
      { path: "main.nf", text: main },
    ]);
    const list = diagnoser
      .file("main.nf")
      .filter((d) => d.code === "duplicate-name");
    // the positions `nextflow lint` 26.10.7 reports for this tree
    expect(
      list.map((d) => [
        d.range.line,
        d.range.column,
        d.message.split(" -- ")[0],
      ]),
    ).toEqual([
      [1, 1, "`B` is already included"],
      [2, 1, "`C` is already included"],
      [4, 1, "`B` is already included"],
    ]);
    const fixes = list.flatMap((d) => d.fix?.edits ?? []);
    expect(list.map((d) => d.fix !== undefined)).toEqual([true, true, false]);
    expect(applyTextEdits(main, fixes)).toBe(
      main.replace(" ; B }", " }").replace("include { C } from './b.nf'\n", ""),
    );
  });

  it("F-112 LA-31: including a pipeline needs types in both scripts, and the second message names the included file relative to the project", async () => {
    const { diagnoser } = await diagnoseFiles([
      {
        path: "lib/rnaseq.nf",
        text: "params {\n    input: String\n}\n\nworkflow {\n    println 'x'\n}\n",
      },
      {
        path: "main.nf",
        text: "include { params as P ; workflow as W } from './lib/rnaseq.nf'\n\nworkflow {\n    println 'x'\n}\n",
      },
    ]);
    const list = diagnoser
      .file("main.nf")
      .filter((d) => d.code === "pipeline-include-types");
    expect(list.map((d) => [d.range.line, d.range.column])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(list.map((d) => d.message)).toEqual([
      "Including a pipeline requires `nextflow.enable.types = true` in the including script -- add `nextflow.enable.types = true` to this script",
      "An included pipeline must enable static typing -- set `nextflow.enable.types = true` in 'lib/rnaseq.nf'",
    ]);
    expect(
      diagnoser.file("main.nf").filter((d) => d.code === "include-alias"),
    ).toEqual([]);
  });

  it("F-601 FI-03 AR-05: config-unknown-option starts with Nextflow's run-time message and says what to do", async () => {
    const { diagnoser } = await diagnoseFiles([
      {
        path: "nextflow.config",
        text: "process {\n    cpus = 1\n    memmory = '4 GB' // misspelt\n}\n\nmystery.level = 3\nparams.x = 1\n",
      },
    ]);
    const list = diagnoser
      .file("nextflow.config")
      .filter((d) => d.code === "config-unknown-option");
    expect(
      list.map((d) => [
        d.severity,
        d.range.line,
        d.range.column,
        d.range.endColumn,
      ]),
    ).toEqual([
      ["warning", 3, 5, 12],
      ["warning", 6, 1, 14],
    ]);
    expect(list.map((d) => d.message)).toEqual([
      "Unrecognized config option 'process.memmory' -- check the name against the config reference, add the plugin that defines it, or remove it",
      "Unrecognized config option 'mystery.level' -- check the name against the config reference, add the plugin that defines it, or remove it",
    ]);
  });
});
