// Synthesised and edited trees (F-110, plan 4.3, 5.2 and 6.3 to 6.4): nodes an edit creates carry `NO_RANGE` and are
// laid out afresh; the printed files are checked in printed/synth/ and by the oracle's fixed-point check.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScriptAst } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import {
  attachedComments,
  normaliseComment,
} from "../../src/printer/comments.ts";
import { createLayout, printScript } from "../../src/printer/index.ts";
import { commentTexts } from "./comment-texts.ts";
import { structure } from "./structure.ts";
import {
  assign,
  call,
  named,
  script,
  string,
  synth,
  variable,
} from "./synth.ts";

const here = import.meta.dirname;
const printedDir = join(here, "printed");

function parse(text: string): ScriptAst {
  const result = parseScriptAst(text);
  if (!result.ok || result.errors.length > 0) throw new Error("parse failed");
  return result.ast;
}

const printTree = (path: string) => {
  const { ast, text } = (
    synth[path] as () => { ast: ScriptAst; text?: string }
  )();
  return {
    ast,
    ...printScript(
      ast,
      text === undefined ? {} : { layout: createLayout(text) },
    ),
  };
};

describe("synthesised and edited trees", () => {
  for (const path of Object.keys(synth)) {
    it(`F-110 step 1 LA-45: ${path} (synthesised or edited) prints printed/${path}`, async () => {
      const { text, missingComments } = printTree(path);
      await expect(text).toMatchFileSnapshot(join(printedDir, path));
      expect(missingComments).toEqual([]);
    });

    it(`F-110 LA-45: parse(print(t)) has the structure of t for ${path}`, () => {
      const { ast, text } = printTree(path);
      const reparsed = parse(text);
      expect(structure(reparsed)).toEqual(structure(ast));
      // the comment texts are equal, and in order
      expect(reparsed.comments.map((c) => normaliseComment(c.text))).toEqual(
        attachedComments(ast).map((c) => normaliseComment(c.text)),
      );
    });

    it(`F-110 step 2: ${path} as printed parses with no errors`, () => {
      expect(parseScriptAst(printTree(path).text)).toMatchObject({
        ok: true,
        errors: [],
      });
    });
  }

  it("F-110 LA-14: a tuple argument for a legacy input prints as tuple(...) with one argument per component, never a list literal", () => {
    const tuple2 = call("tuple", [variable("meta"), variable("reads")]);
    const tuple3 = call("tuple", [variable("a"), variable("b"), variable("c")]);
    const text = printScript(
      script([assign("x", call("PROC", [tuple2])), assign("y", tuple3)]),
    ).text;
    expect(text).toBe("x = PROC(tuple(meta, reads))\ny = tuple(a, b, c)\n");
    expect(text).not.toContain("[");
    // a trailing comma wraps one component per line, and it stays a tuple( call
    const wrapped = printScript(
      script([assign("x", { ...tuple3, trailingComma: true })]),
    ).text;
    expect(wrapped).toBe("x = tuple(\n    a,\n    b,\n    c,\n)\n");
    expect(wrapped).not.toContain("[");
  });

  it("F-110: a NO_RANGE tree gets the fresh layout", () => {
    const text = printTree("synth/workflow/main.nf").text;
    // one blank line before each declaration but the second include, and none inside a record or params block
    const top = text.split("\n").filter((l) => /^[a-z]/.test(l));
    expect(top.map((l) => l.split(" ")[0])).toEqual([
      "nextflow.enable.types",
      "include",
      "include",
      "params",
      "workflow",
      "workflow",
      "output",
    ]);
    expect(text).toContain("\n\ninclude { helper }");
    expect(text).toContain("a.nf'\ninclude { third }");
    expect(text).toContain(
      "b.nf'\n\nparams {\n    greeting: String = 'Hello'\n}\n\nworkflow greet {",
    );
    // nothing wraps without a trailing comma
    expect(
      printScript(
        script([
          assign("x", call("f", [string("a"), named("b", string("c"))])),
        ]),
      ).text,
    ).toBe("x = f('a', b: 'c')\n");
    // a triple-quoted string is not re-indented
    const countLines = printTree(
      "synth/create-process/modules/local/count_lines/main.nf",
    ).text;
    expect(countLines).toContain(
      `    """\n    wc -l \${text} > lines.txt\n    """`,
    );
    // the doc comment follows the blank line after the flag
    expect(
      countLines.startsWith(
        "nextflow.enable.types = true\n\n/**\n * Count the lines of a file.\n */\nprocess COUNT_LINES {",
      ),
    ).toBe(true);
  });

  it("F-110: in an edited tree, positioned nodes keep their source blank lines and new nodes get none", () => {
    const base = readFileSync(join(here, "input/synth-base/main.nf"), "utf8");
    const text = printTree("synth/create-process/main.nf").text;
    // the parsed statements keep the blank line between them; the new include and call have none above them
    expect(base).toContain("first = GREET('a')\n\n    second = GREET('b')\n");
    expect(text).toContain(
      "first = GREET('a')\n\n    second = GREET('b')\n    counted = COUNT_LINES(",
    );
    expect(text).toContain(
      "include { GREET } from './modules/local/greet/main.nf'\ninclude { COUNT_LINES }",
    );
    expect(text).toContain(
      "// the base workflow an edit starts from\nworkflow {",
    );
  });

  it("F-110 LA-45: parse(print(parse(x))) has the structure of parse(x) for the expected files whose text it keeps", () => {
    const files = [
      // not typed/function.nf (a legacy type becomes modern) nor typed/expressions.nf (named arguments move last)
      "typed/process.nf",
      "typed/workflow.nf",
      "typed/record.nf",
      "typed/params.nf",
      "typed/output.nf",
      "typed/include.nf",
      "la14/main.nf",
    ];
    for (const path of files) {
      const input = readFileSync(join(here, "input", path), "utf8");
      const ast = parse(input);
      const printed = printScript(ast, { layout: createLayout(input) }).text;
      expect(structure(parse(printed)), path).toEqual(structure(ast));
      expect(commentTexts(printed), path).toEqual(commentTexts(input));
    }
  });
});
