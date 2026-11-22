import { type AstNode, type Comment, walk } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";

type Slotted = AstNode & {
  leadingComments?: Comment[];
  trailingComments?: Comment[];
  danglingComments?: Comment[];
};

/** Each comment's slot and the kind and first line of the node it is attached to, by comment text. */
function slots(text: string): Record<string, string> {
  const result = parseConfigAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const out: Record<string, string> = {};
  walk(result.ast, (node) => {
    for (const slot of ["leading", "trailing", "dangling"] as const)
      for (const c of (node as Slotted)[`${slot}Comments`] ?? [])
        out[c.text] = `${slot} ${node.kind}@${node.range.line}`;
  });
  return out;
}

describe("F-103 AR-02: config comment slots", () => {
  it("an end-of-line comment trails its statement", () => {
    expect(slots("docker.enabled = true // on\nprocess.cpus = 2\n")).toEqual({
      "// on": "trailing ConfigAssign@1",
    });
  });

  it("a comment before a statement leads it, also inside a block", () => {
    expect(
      slots("// top\nparams.a = 1\nprocess {\n  // inner\n  cpus = 2\n}\n"),
    ).toEqual({
      "// top": "leading ConfigAssign@2",
      "// inner": "leading ConfigAssign@5",
    });
  });

  it("a comment alone in a block dangles on the block, and on a selector", () => {
    expect(
      slots(
        "process {\n  // nothing yet\n}\nprocess {\n  withName: 'A' {\n    // none\n  }\n}\n",
      ),
    ).toEqual({
      "// nothing yet": "dangling ConfigBlock@1",
      "// none": "dangling ConfigSelector@5",
    });
  });

  it("a comment inside a list or closure value is attached within it", () => {
    expect(
      slots(
        "params.x = [\n  1, // one\n  // two\n  2\n]\nprocess.memory = { \n  // body\n  2.GB\n}\n",
      ),
    ).toEqual({
      "// one": "trailing Number@2",
      "// two": "leading Number@4",
      "// body": "leading ExpressionStatement@8",
    });
  });

  it("a comment in the plugins block leads its entry", () => {
    expect(slots("plugins {\n  // schema\n  id 'nf-schema'\n}\n")).toEqual({
      "// schema": "leading ConfigApply@3",
    });
  });
});
