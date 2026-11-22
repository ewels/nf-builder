import type { SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPackVersions } from "../../src/packs";
import { equivalent, normaliseText } from "../../src/source/equivalent";
import { loadParser } from "../../src/source/parser";
import { createSourceFile } from "../../src/source/source-file";

let parser: SourceParser;
beforeAll(async () => {
  parser = await loadParser(installedPackVersions()[0] as string);
});
const nf = (text: string) => createSourceFile("main.nf", text, parser);
const config = (text: string) =>
  createSourceFile("nextflow.config", text, parser);
const reason = (a: string, b: string) => {
  const r = equivalent(nf(a), nf(b));
  return r.equivalent ? null : r.reason;
};

const base = [
  "// head",
  "process A {",
  "    script:",
  "    'echo'",
  "}",
  "",
  "enum E { X, Y }",
  "",
  "workflow {",
  "    A()",
  "}",
  "",
].join("\n");

describe("F-104 ADR-0004: equivalent", () => {
  it("F-104 ADR-0004: whitespace, indentation, blank lines, CRLF and trailing whitespace changes are equivalent", () => {
    const variants = [
      base.replaceAll("\n", "\r\n"),
      base.replaceAll("    ", "\t"),
      base.replaceAll("\n\n", "\n\n\n\n"),
      base.replaceAll("\n", "   \n"),
      base.replace("{ X, Y }", "{\n  X,\n  Y\n}"),
      `${base}\n\n   \n`,
    ];
    for (const v of variants) {
      const r = equivalent(nf(base), nf(v));
      expect(r, JSON.stringify(v)).toEqual({ equivalent: true });
    }
    expect(
      equivalent(config("a = 1\nb = 2\n"), config("a   =   1\r\n\r\nb = 2"))
        .equivalent,
    ).toBe(true);
  });

  it("F-104 ADR-0004: a change to code or comments is not equivalent", () => {
    const changes: [string, string][] = [
      ["literal", base.replace("'echo'", "'ecko'")],
      ["identifier", base.replace("process A", "process B")],
      ["trailing comma", base.replace("{ X, Y }", "{ X, Y, }")],
      ["quote style", base.replace("'echo'", '"echo"')],
      ["comment edited", base.replace("// head", "// heads")],
      ["comment removed", base.replace("// head\n", "")],
      ["comment added", base.replace("workflow {", "// new\nworkflow {")],
    ];
    for (const [what, text] of changes)
      expect(equivalent(nf(base), nf(text)).equivalent, what).toBe(false);
    const reordered = equivalent(
      nf("// one\n// two\nworkflow {\n}\n"),
      nf("// two\n// one\nworkflow {\n}\n"),
    );
    expect(reordered.equivalent).toBe(false);
    expect(
      reason("workflow {\n  a = 1\n}\n", "workflow {\n  a = 2\n}\n"),
    ).toContain("body[0]");
    expect(reason("// a\nworkflow {\n}\n", "// b\nworkflow {\n}\n")).toContain(
      "comment",
    );
  });

  it("F-104 ADR-0004: unparsed text is compared after normalising line endings and trailing whitespace only", () => {
    const bad = "process B {\n    script:\n    def a = = 1\n    'x'\n}\n";
    const a = nf(`${base}${bad}`);
    expect(a.status).toBe("partial");
    const crlf = nf(`${base}${bad}`.replaceAll("\n", "\r\n"));
    const trailing = nf(`${base}${bad}`.replaceAll("\n", "  \n"));
    expect(equivalent(a, crlf)).toEqual({ equivalent: true });
    expect(equivalent(a, trailing)).toEqual({ equivalent: true });
    const indented = nf(`${base}${bad}`.replace("    def a", "        def a"));
    expect(equivalent(a, indented).equivalent).toBe(false);
  });

  it("F-104: a different status or language is never equivalent; plain files compare normalised text", () => {
    const j = (text: string) => createSourceFile("a.json", text, parser);
    expect(
      equivalent(j('{ "a": 1 }\n'), j('{ "a": 1 }  \r\n\r\n')).equivalent,
    ).toBe(true);
    expect(equivalent(j('{ "a": 1 }'), j('{ "a": 2 }')).equivalent).toBe(false);
    expect(
      equivalent(j("a: 1"), createSourceFile("a.yml", "a: 1", parser))
        .equivalent,
    ).toBe(false);
    expect(
      equivalent(nf("workflow {\n}\n"), config("workflow {\n}\n")).equivalent,
    ).toBe(false);
    const verbatim = nf("process {{{");
    expect(verbatim.status).toBe("verbatim");
    expect(equivalent(verbatim, nf("process {{{  \r\n")).equivalent).toBe(true);
    expect(equivalent(verbatim, nf("process {{")).equivalent).toBe(false);
    expect(
      equivalent(nf("workflow {\n}\n"), nf("process {{{")).equivalent,
    ).toBe(false);
    expect(
      equivalent(nf("workflow {\n}\n"), j("workflow {\n}\n")).equivalent,
    ).toBe(false);
  });

  it("F-104 ADR-0004: normaliseText normalises line endings and trailing whitespace", () => {
    expect(normaliseText("a  \r\nb\t\rc\n\n \n")).toBe("a\nb\nc");
    expect(normaliseText("  a")).toBe("  a");
  });
});
