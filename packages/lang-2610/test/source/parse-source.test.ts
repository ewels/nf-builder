import { readFileSync } from "node:fs";
import type { Unparsed } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigChunks,
  parseConfigSource,
  parseScriptChunks,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { configFixtures, malformed, scriptFixtures } from "./files.ts";
import { labelOf } from "./labels.ts";
import { checkTiling } from "./tiling.ts";

const good = (name: string) =>
  `process ${name} {\n    input:\n    val x\n\n    output:\n    stdout\n\n    script:\n    'echo'\n}\n`;
const bad = (name: string) =>
  `process ${name} {\n    script:\n    def a = = 1\n    'echo'\n}\n`;

describe("F-104 step 2 ADR-0004: the chunked path", () => {
  it("F-104 step 2: on every AST fixture and config construct fixture, the chunk path stitches back the whole-file AST", () => {
    let count = 0;
    for (const file of scriptFixtures()) {
      const text = readFileSync(file, "utf8");
      const whole = parseScriptAst(text);
      if (!whole.ok || whole.errors.length > 0) continue;
      count++;
      const chunks = parseScriptChunks(text);
      expect(chunks.status, file).toBe("modelled");
      expect(chunks.ast, file).toEqual(whole.ast);
    }
    for (const file of configFixtures()) {
      const text = readFileSync(file, "utf8");
      const whole = parseConfigAst(text);
      if (!whole.ok || whole.errors.length > 0) continue;
      count++;
      const chunks = parseConfigChunks(text);
      expect(chunks.status, file).toBe("modelled");
      expect(chunks.ast, file).toEqual(whole.ast);
    }
    expect(count).toBeGreaterThan(50);
  });

  it("F-104 step 2: shifted ranges are exact after astral characters and CRLF", () => {
    const badProcess = bad("BAD");
    const text = `include { A } from '\u{1d400}\u{1d400}'\n${badProcess}\n${good("GOOD")}`;
    for (const eol of ["\n", "\r\n"]) {
      const t = text.replaceAll("\n", eol);
      const r = parseScriptChunks(t);
      expect(r.status).toBe("partial");
      const body = r.ast?.body ?? [];
      expect(body.map((i) => labelOf(i, t))).toEqual([
        "include",
        "process BAD",
        "process GOOD",
      ]);
      const unparsed = body[1] as Unparsed;
      expect(t.slice(unparsed.range.start, unparsed.range.end)).toBe(
        unparsed.text,
      );
      for (const item of body)
        expect(t.slice(item.range.start, item.range.end).length).toBe(
          item.range.end - item.range.start,
        );
      // the whole-file parse of the text with the bad declaration blanked out has the same modelled items
      const repaired = t.replace(
        unparsed.text,
        unparsed.text.replace(/[^\r\n]/g, " "),
      );
      const whole = parseScriptAst(repaired);
      expect(whole.ok && whole.errors).toEqual([]);
      const wholeBody = whole.ok ? whole.ast.body : [];
      expect(body.filter((i) => i.kind !== "Unparsed")).toEqual(wholeBody);
      expect(checkTiling(t, r.ast as never)).toEqual([]);
    }
  });

  it("F-104 step 2: types enabled in an earlier chunk apply to later chunks", () => {
    const text = [
      "nextflow.enable.types = true",
      "",
      "process TYPED {",
      "    input:",
      "    message: String",
      "",
      "    script:",
      "    'echo'",
      "}",
      "",
      bad("BAD"),
    ].join("\n");
    const r = parseScriptChunks(text);
    const typed = r.ast?.body.find((i) => i.kind === "Process");
    expect(typed?.kind === "Process" && typed.typed).toBe(true);
    expect(r.ast?.typesEnabled).toBe(true);
    expect(r.ast?.body.map((i) => i.kind)).toEqual([
      "FeatureFlag",
      "Process",
      "Unparsed",
    ]);
  });

  it("F-104 step 2: a broken include among includes is isolated", () => {
    const text =
      "include { A } from './a'\ninclude { B } form './b'\ninclude { C } from './c'\n";
    const r = parseScriptChunks(text);
    expect(r.ast?.body.map((i) => labelOf(i, text))).toEqual([
      "include",
      "include",
      "include",
    ]);
    expect(r.ast?.body.map((i) => i.kind)).toEqual([
      "Include",
      "Unparsed",
      "Include",
    ]);
  });

  it("F-104 step 2 ADR-0004: a declaration with an unclosed brace no longer swallows the later declarations", () => {
    const includes =
      "include { A } from './a'\ninclude { B from './b'\ninclude { C } from './c'\n\nworkflow {\n  A()\n}\n";
    const r = parseScriptChunks(includes);
    expect(r.ast?.body.map((i) => i.kind)).toEqual([
      "Include",
      "Unparsed",
      "Include",
      "Workflow",
    ]);
    const process = `${good("A")}\nprocess B {\n  script:\n  'x'\n\n${good("C")}\nworkflow {\n  C()\n}\n`;
    const p = parseScriptSource(process);
    expect(p.status).toBe("partial");
    expect(p.ast?.body.map((i) => labelOf(i, process))).toEqual([
      "process A",
      "process B",
      "process C",
      "workflow",
    ]);
    expect(p.ast?.body.map((i) => i.kind)).toEqual([
      "Process",
      "Unparsed",
      "Process",
      "Workflow",
    ]);
  });

  it("F-104 step 2 ADR-0004: a config with a #! line keeps the line as text and models the rest", () => {
    const text = "#!x\na = 1\nb = 2\n";
    const r = parseConfigSource(text);
    expect(r.status).toBe("partial");
    expect(r.problems.some((p) => p.source === "internal")).toBe(false);
    expect(r.ast?.statements.map((i) => i.kind)).toEqual([
      "Unparsed",
      "ConfigAssign",
      "ConfigAssign",
    ]);
    const first = r.ast?.statements[0];
    expect(first?.kind === "Unparsed" && first.text).toBe("#!x");
  });

  it("F-104 IO-14: a parser exception turns only its chunk into Unparsed with an internal problem", () => {
    const text = `${good("ONE")}\nprocess DEEP {\n    script:\n    x = ${"(".repeat(5_000)}1${")".repeat(5_000)}\n}\n\n${good("TWO")}`;
    const r = parseScriptSource(text);
    expect(r.status).toBe("partial");
    const body = r.ast?.body ?? [];
    expect(body.map((i) => i.kind)).toEqual(["Process", "Unparsed", "Process"]);
    expect(
      (body[1] as Unparsed).problems.some((p) => p.source === "internal"),
    ).toBe(true);
    expect(checkTiling(text, r.ast as never)).toEqual([]);
  }, 60_000);

  it("F-104 ADR-0004: when no declaration can be modelled the file is verbatim", () => {
    const single = parseScriptSource(bad("ONLY"));
    expect(single.status).toBe("verbatim");
    expect(single.ast).toBeNull();
    const text = malformed("unclosed-comment.nf");
    const r = parseScriptSource(text);
    const whole = parseScriptAst(text);
    expect(r.status).toBe("verbatim");
    expect(r.ast).toBeNull();
    expect(r.problems).toEqual(whole.errors);
  });

  it("F-104 ADR-0004: the shebang stays out of the comment map and the file's problems are the whole-file errors", () => {
    const text = `#!/usr/bin/env nextflow\n// c\n${good("ONE")}\n${bad("TWO")}`;
    const r = parseScriptSource(text);
    expect(r.ast?.shebang?.text).toBe("#!/usr/bin/env nextflow");
    expect(r.ast?.comments.map((c) => c.text)).toEqual(["// c"]);
    const whole = parseScriptAst(text);
    expect(r.problems).toEqual(whole.errors);
  });
});
