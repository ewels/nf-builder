import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CallNode, GraphNode, LegacyProcess } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectModel } from "../../../src/model/project";
import { installedPacks } from "../../../src/packs";
import { dataflowLibrary } from "../../../src/projection/library";
import {
  type LegacySignature,
  legacyProcessSignature,
  legacyResultDataflow,
} from "../../../src/projection/signature";
import { formatFlowType } from "../../../src/projection/types";
import { openFiles, openTree, projectorFor } from "../open";

const root = (path: string) =>
  fileURLToPath(new URL(`../../../../../${path}`, import.meta.url));
const CASE = root("tools/oracle/cases/f107-legacy-dataflow");

let io: ProjectModel;
let cases: ProjectModel;
let library: ReturnType<typeof dataflowLibrary>;
beforeAll(async () => {
  const pack = installedPacks[0];
  if (pack === undefined) throw new Error("no pack installed");
  library = dataflowLibrary((await pack.loadCatalogue()).script);
  io = await openFiles([
    {
      path: "io.nf",
      text: readFileSync(
        root("packages/lang-2610/test/ast/fixtures/process-legacy-io.nf"),
        "utf8",
      ),
    },
  ]);
  cases = await openTree(CASE);
});

function legacy(
  model: ProjectModel,
  path: string,
  name: string,
): LegacyProcess {
  const ast = model.file(path)?.source.ast;
  const found = (ast?.kind === "Script" ? ast.body : []).find(
    (i) => i.kind === "Process" && i.name.name === name,
  );
  if (found === undefined || found.kind !== "Process" || found.typed)
    throw new Error(`no legacy process ${name} in ${path}`);
  return found;
}
const signatureOf = (model: ProjectModel, path: string, name: string) =>
  legacyProcessSignature(legacy(model, path, name), library);
const show = (s: LegacySignature["inputs"]) =>
  s.map((p) => [p.id, p.label, p.type === null ? "-" : formatFlowType(p.type)]);
const QUALIFIERS = "modules/local/qualifiers/main.nf";

describe("F-107 LA-21 legacy process ports", () => {
  it("F-107 LA-21: a legacy process has one input port per input line; a tuple is one port labelled with its components", () => {
    expect(show(signatureOf(io, "io.nf", "ALIGN").inputs)).toEqual([
      ["$1", "tuple(meta, reads)", "Tuple"],
      ["index", "index", "Path"],
      ["legacy_file", "legacy_file", "Path"],
      ["$4", "GENOME", "String"],
      ["$5", "stdin", "String"],
      ["mode", "mode", "-"],
    ]);
    expect(show(signatureOf(cases, QUALIFIERS, "ALL_INPUTS").inputs)).toEqual([
      ["sample", "sample", "-"],
      ["reads", "reads", "Path"],
      ["extra", "extra", "Path"],
      ["$4", "tuple(meta, bam, tag)", "Tuple"],
      ["flag", "flag", "-"],
      ["$6", "GREETING", "String"],
      ["$7", "stdin", "String"],
    ]);
  });

  it("F-302 LA-14 LA-21: a legacy tuple input carries its component count", () => {
    const counts = (s: LegacySignature["inputs"]) =>
      s.map((p) => [p.id, p.components]);
    expect(counts(signatureOf(io, "io.nf", "ALIGN").inputs)).toEqual([
      ["$1", 2],
      ["index", undefined],
      ["legacy_file", undefined],
      ["$4", undefined],
      ["$5", undefined],
      ["mode", undefined],
    ]);
    expect(
      counts(signatureOf(cases, QUALIFIERS, "ALL_INPUTS").inputs)[3],
    ).toEqual(["$4", 3]);
  });

  it("F-107 LA-21: legacy outputs are named by emit:, else out when alone, else [i]; topic and optional outputs stay ports", () => {
    expect(show(signatureOf(io, "io.nf", "ALIGN").outputs)).toEqual([
      ["bam", "bam", "Tuple"],
      ["log", "log", "Path"],
      ["result", "result", "String"],
      ["[3]", "[3]", "String"],
      ["out", "out", "String"],
    ]);
    expect(
      show(signatureOf(cases, QUALIFIERS, "ALL_INPUTS").outputs).map(
        (p) => p[0],
      ),
    ).toEqual(["result", "versions", "maybe", "sample", "[4]"]);
    expect(show(signatureOf(cases, QUALIFIERS, "ONE_UNNAMED").outputs)).toEqual(
      [["out", "out", "Path"]],
    );
    expect(
      show(signatureOf(cases, QUALIFIERS, "MANY_UNNAMED").outputs),
    ).toEqual([
      ["[0]", "[0]", "Path"],
      ["[1]", "[1]", "-"],
      ["[2]", "[2]", "Tuple"],
    ]);
  });

  it("F-107 LA-21 LA-28: output element types follow the qualifier; results are values only when every argument is a value or plain and no input is each", () => {
    const all = signatureOf(cases, QUALIFIERS, "ALL_INPUTS");
    const one = signatureOf(cases, QUALIFIERS, "ONE_UNNAMED");
    expect(all.repeats).toBe(true);
    expect(one.repeats).toBe(false);
    expect(legacyResultDataflow(one, [])).toBe("value");
    expect(legacyResultDataflow(one, ["value"])).toBe("value");
    expect(legacyResultDataflow(one, ["plain"])).toBe("value");
    expect(legacyResultDataflow(one, ["channel"])).toBe("channel");
    expect(legacyResultDataflow(one, [null])).toBe("channel");
    expect(legacyResultDataflow(one, ["value", "channel"])).toBe("channel");
    expect(legacyResultDataflow(all, ["value", "value"])).toBe("channel");
  });

  it("F-107 LA-14 LA-21: a typed workflow's call to a legacy process has its qualifier ports, with the result kind from the arguments", async () => {
    const model = await openFiles([
      ...[...cases.paths()]
        .filter((p) => p.startsWith("modules/"))
        .map((path) => ({
          path,
          text: cases.file(path)?.source.text ?? "",
        })),
      {
        path: "main.nf",
        text: "nextflow.enable.types = true\n\ninclude { ONE_UNNAMED; MANY_UNNAMED } from './modules/local/qualifiers/main.nf'\n\nworkflow {\n    main:\n    ch = channel.of(1, 2)\n    one = ONE_UNNAMED(ch)\n    v = channel.value(1)\n    many = MANY_UNNAMED(v)\n}\n",
      },
    ]);
    const p = (await projectorFor(model)).project("main.nf", null);
    const call = (id: string): CallNode => {
      const n = p?.nodes.find((x: GraphNode) => x.id === id);
      if (n === undefined || n.kind !== "call") throw new Error(id);
      return n;
    };
    const one = call("main.nf#/one");
    expect(one.callee).toMatchObject({ kind: "process", typed: false });
    expect(one.inputs.map((x) => x.id)).toEqual(["x"]);
    expect(
      one.outputs.map((x) => [x.id, formatFlowType(x.type as never)]),
    ).toEqual([["out", "Channel<Path>"]]);
    const many = call("main.nf#/many");
    expect(
      many.outputs.map((x) => [x.id, formatFlowType(x.type as never)]),
    ).toEqual([
      ["[0]", "Value<Path>"],
      ["[1]", "Value<?>"],
      ["[2]", "Value<Tuple>"],
    ]);
  });
});
