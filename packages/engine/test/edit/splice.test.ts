import type {
  Declaration,
  ScriptSourceFile,
  SourceParser,
  Statement,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assignment,
  call,
  expressionStatement,
  includeOf,
} from "../../src/edit/nodes";
import { EditRefusal } from "../../src/edit/refusal";
import {
  assertCommentsKept,
  includeInsertion,
  itemSpan,
  reprintDeclaration,
} from "../../src/edit/splice";
import { loadParser } from "../../src/source/parser";
import { createSourceFile } from "../../src/source/source-file";
import { version } from "./helpers";

let parser: SourceParser;
beforeAll(async () => {
  parser = await loadParser(version);
});
const script = (text: string) =>
  createSourceFile("main.nf", text, parser) as ScriptSourceFile;
const applyEdit = (
  text: string,
  e: { start: number; end: number; text: string },
) => text.slice(0, e.start) + e.text + text.slice(e.end);
const appendCall = (def: Declaration & { kind: "Workflow" }, name: string) => {
  const main = def.main;
  if (!main) throw new Error("no main");
  return {
    ...def,
    main: {
      ...main,
      items: [...main.items, expressionStatement(call(name, []))],
    },
  };
};

const base = [
  "include { A } from './a.nf'",
  "",
  "// about B",
  "process B {",
  "    script:",
  "    'b'",
  "} // end B",
  "",
  "workflow {",
  "    A()",
  "}",
  "",
].join("\n");

describe("F-111 splice", () => {
  it("F-111 AR-22 LA-45: a reprint replaces the span from the first leading comment to the trailing comment; the rest is byte-identical", () => {
    const file = script(
      "// about W\nworkflow {\n    println 'x' // tail\n}\n\nprocess P {\n    script:\n    'p'\n}\n",
    );
    const def = file.ast?.body[0];
    if (def?.kind !== "Workflow") throw new Error("no workflow");
    const span = itemSpan(def);
    expect(file.text.slice(span.start, span.end)).toBe(
      "// about W\nworkflow {\n    println 'x' // tail\n}",
    );
    const edit = reprintDeclaration(
      file,
      def,
      appendCall(def, "Q"),
      parser.printer,
    );
    expect(edit.start).toBe(span.start);
    expect(edit.end).toBe(span.end);
    expect(applyEdit(file.text, edit)).toBe(
      "// about W\nworkflow {\n    println('x') // tail\n    Q()\n}\n\nprocess P {\n    script:\n    'p'\n}\n",
    );
  });

  it("F-302 UX-25: assertCommentsKept refuses an update that drops an attached comment, unless the node is removed", () => {
    const file = script("workflow {\n    A() // tail\n    B()\n}\n");
    const def = file.ast?.body[0];
    if (def?.kind !== "Workflow" || !def.main) throw new Error("no workflow");
    const [first, ...rest] = def.main.items;
    const dropped = { ...def, main: { ...def.main, items: rest } };
    expect(() => assertCommentsKept(file, def, dropped)).toThrow(EditRefusal);
    expect(() => assertCommentsKept(file, def, dropped)).toThrow(
      /drop the comment "\/\/ tail"/,
    );
    expect(() =>
      assertCommentsKept(file, def, dropped, [first as Statement]),
    ).not.toThrow();
    expect(() => assertCommentsKept(file, def, def)).not.toThrow();
  });

  it("F-111 ADR-0033: a declaration in a partial file is reprinted with a layout masked to its span", () => {
    const text = "workflow {\n    A()\n\n    B()\n}\n\nprocess {\n";
    const file = script(text);
    expect(file.status).toBe("partial");
    const def = file.ast?.body[0];
    if (def?.kind !== "Workflow") throw new Error("no workflow");
    const out = applyEdit(
      text,
      reprintDeclaration(file, def, appendCall(def, "C"), parser.printer),
    );
    expect(out).toBe(
      "workflow {\n    A()\n\n    B()\n    C()\n}\n\nprocess {\n",
    );
    const after = script(out);
    expect(after.status).toBe("partial");
    expect(after.problems.map((p) => p.message)).toEqual(
      file.problems.map((p) => p.message),
    );
  });

  it("F-111 ADR-0032: an include goes after the last include, else after the flags, else before the first declaration's comments", () => {
    const include = includeOf("N", "./n.nf");
    const at = (text: string) => {
      const file = script(text);
      return applyEdit(text, includeInsertion(file, include, parser.printer));
    };
    expect(at(base)).toBe(
      base.replace(
        "include { A } from './a.nf'\n",
        "include { A } from './a.nf'\ninclude { N } from './n.nf'\n",
      ),
    );
    expect(at("nextflow.enable.types = true\n\nworkflow {\n    A()\n}\n")).toBe(
      "nextflow.enable.types = true\n\ninclude { N } from './n.nf'\n\nworkflow {\n    A()\n}\n",
    );
    expect(at("// about W\nworkflow {\n    A()\n}\n")).toBe(
      "include { N } from './n.nf'\n\n// about W\nworkflow {\n    A()\n}\n",
    );
    expect(at("")).toBe("include { N } from './n.nf'\n");
    expect(at("// only a comment\n")).toBe(
      "// only a comment\n\ninclude { N } from './n.nf'\n",
    );
  });

  it("F-111: printed text follows the file's CRLF line endings", () => {
    const text = base.replace(/\n/g, "\r\n");
    const file = script(text);
    const wf = file.ast?.body.find((i) => i.kind === "Workflow");
    if (wf?.kind !== "Workflow") throw new Error("no workflow");
    const out = applyEdit(
      text,
      reprintDeclaration(file, wf, appendCall(wf, "Z"), parser.printer),
    );
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("    Z()\r\n}");
    const inc = applyEdit(
      text,
      includeInsertion(file, includeOf("N", "./n.nf"), parser.printer),
    );
    expect(inc.replace(/\r\n/g, "")).not.toContain("\n");
    expect(inc).toContain("include { N } from './n.nf'\r\n");
  });

  it("F-111 AR-22 LA-45: a CRLF file with a multi-line string keeps single CRLF line breaks after a reprint", () => {
    const text =
      'process A {\n    script:\n    "a"\n}\n\nworkflow {\n    m = """\n      one\n      two\n      """\n    println(m)\n}\n'.replace(
        /\n/g,
        "\r\n",
      );
    const file = script(text);
    const wf = file.ast?.body.find((i) => i.kind === "Workflow");
    if (wf?.kind !== "Workflow") throw new Error("no workflow");
    const out = applyEdit(
      text,
      reprintDeclaration(file, wf, appendCall(wf, "A"), parser.printer),
    );
    expect(out).not.toContain("\r\r");
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(out).toContain('"""\r\n      one\r\n      two\r\n      """');
    expect(script(out).problems).toEqual([]);
  });

  it("F-111 ADR-0004: a reprint that would drop a comment is refused", () => {
    const file = script("workflow {\n    // note\n    A()\n    B()\n}\n");
    const def = file.ast?.body[0];
    if (def?.kind !== "Workflow") throw new Error("no workflow");
    const [first, second] = (def.main?.items ?? []) as [Statement, Statement];
    // replacing the commented statement with a new one drops its comment
    const dropped = {
      ...def,
      main: def.main && {
        ...def.main,
        items: [assignment("x", call("C", [])), second],
      },
    };
    expect(first.leadingComments?.length).toBe(1);
    expect(() =>
      reprintDeclaration(file, def, dropped, parser.printer),
    ).toThrow(EditRefusal);
    // unless the command removes that node on purpose
    expect(() =>
      reprintDeclaration(file, def, dropped, parser.printer, [first]),
    ).not.toThrow();
  });

  it("F-111 LA-45 ADR-0032: a reprint keeps the content of a multi-line string exactly as written (known difference string-reindent)", () => {
    const text =
      'workflow {\n    if (true) {\n    m = """\n      first\n        second\n      """\n    println(m)\n    }\n}\n';
    const file = script(text);
    const def = file.ast?.body[0];
    if (def?.kind !== "Workflow") throw new Error("no workflow");
    const out = applyEdit(
      text,
      reprintDeclaration(file, def, def, parser.printer),
    );
    // the statement moves to its formatted indentation; the string's lines don't move with it
    expect(out).toContain(
      '        m = """\n      first\n        second\n      """',
    );
    expect(script(out).problems).toEqual([]);
  });
});
