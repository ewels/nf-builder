import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileOutline } from "../../src/details/outline";
import { openFiles } from "../projection/open";

const FIXTURES = join(
  import.meta.dirname,
  "../../../lang-2610/test/ast/fixtures",
);
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

async function outlineOf(path: string, text: string) {
  const model = await openFiles([{ path, text }]);
  const file = model.file(path)?.source;
  if (file === undefined) throw new Error("no file");
  return fileOutline(file);
}

describe("F-605 file outline", () => {
  it("F-605 FI-31: fileOutline lists every top-level declaration of a script in source order with its kind, name and line", async () => {
    const functions = await outlineOf("lib/a.nf", fixture("function.nf"));
    expect(functions?.map((i) => [i.kind, i.name, i.line])).toEqual([
      ["function", "greet", 1],
      ["function", "add", 5],
      ["function", "greetIfNamed", 10],
      ["function", "fib", 17],
    ]);
    expect(functions?.[1]?.detail).toBe("(a: Integer, b: Integer) -> Integer");
    const enums = await outlineOf("lib/e.nf", fixture("enum.nf"));
    expect(enums?.map((i) => [i.kind, i.name, i.detail])).toEqual([
      [
        "enum",
        "Day",
        "MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY",
      ],
    ]);
    const records = await outlineOf("lib/r.nf", fixture("record.nf"));
    expect(records?.map((i) => [i.kind, i.name, i.detail])).toEqual([
      ["record", "FastqPair", "id, fastq_1, fastq_2"],
    ]);
    const text = [
      "nextflow.enable.types = true",
      "include { A ; B as C } from './x.nf'",
      "params.legacy = 1",
      "params {",
      "    input: String",
      "}",
      "process P {",
      "    script:",
      "    'x'",
      "}",
      "workflow {",
      "    P()",
      "}",
      "workflow NAMED {",
      "    P()",
      "}",
      "output {",
      "    results {",
      "    }",
      "}",
      "",
    ].join("\n");
    const mixed = await outlineOf("main.nf", text);
    expect(mixed?.map((i) => [i.kind, i.name, i.line])).toEqual([
      ["featureFlag", "nextflow.enable.types", 1],
      ["include", "A, B as C", 2],
      ["unparsed", "param params.legacy", 3],
      ["params", "params", 4],
      ["process", "P", 7],
      ["workflow", "(entry)", 11],
      ["workflow", "NAMED", 14],
      ["output", "output", 17],
    ]);
    expect(mixed?.[1]?.detail).toBe("./x.nf");
    const legacy = await outlineOf("p.nf", "params.input = 'x'\n");
    expect(legacy?.map((i) => [i.kind, i.name])).toEqual([
      ["legacyParam", "params.input"],
    ]);
    const start = text.indexOf("process P");
    expect(mixed?.[4]?.range).toEqual({
      start,
      end: text.indexOf("workflow {") - 1,
    });
  });

  it("F-605 FI-31: an unparsed declaration keeps its keyword and name, and top-level statements are listed as statements", async () => {
    const items = await outlineOf(
      "x.nf",
      "nextflow.enable.types = true\nparams.x = 1\n",
    );
    expect(items?.map((i) => [i.kind, i.name, i.line])).toEqual([
      ["featureFlag", "nextflow.enable.types", 1],
      ["unparsed", "param params.x", 2],
    ]);
    // a file that fails to parse at all has no items to list
    expect(await outlineOf("v.nf", "process {\n")).toEqual([]);
    const statements = await outlineOf("s.nf", "println 'hello'\nx = 1\n");
    expect(statements?.map((i) => [i.kind, i.name])).toEqual([
      ["statement", "println 'hello'"],
      ["statement", "x = 1"],
    ]);
  });

  it("F-605 FI-31 AR-30: an outline carries names and ranges, with details capped at 80 characters", async () => {
    const long = `${"a".repeat(120)}`;
    const items = await outlineOf(
      "l.nf",
      `include { X } from './${long}.nf'\nprintln '${long}'\n`,
    );
    for (const item of items ?? []) {
      expect(item.detail.length).toBeLessThanOrEqual(80);
      expect(item.name.length).toBeLessThanOrEqual(80);
      expect(Object.keys(item).sort()).toEqual([
        "detail",
        "kind",
        "line",
        "name",
        "range",
      ]);
    }
    expect(items?.[0]?.detail.endsWith("…")).toBe(true);
  });

  it("F-605: config, Markdown and plain files have no outline", async () => {
    expect(await outlineOf("nextflow.config", "process.cpus = 1\n")).toBeNull();
    expect(await outlineOf("README.md", "# Hi\n")).toBeNull();
    expect(await outlineOf("notes.txt", "x")).toBeNull();
  });
});
