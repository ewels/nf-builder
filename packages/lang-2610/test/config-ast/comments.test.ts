import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import {
  type Attachment,
  anchors,
  attachments,
  type DumpRow,
  toRow,
} from "../ast/comment-anchors.ts";

/** Each comment's slot and the kind and first line of the node it is attached to, by comment text. */
function slots(text: string): Record<string, string> {
  const result = parseConfigAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return Object.fromEntries(
    [...attachments(result.ast).values()]
      .flat()
      .map((a) => [
        a.comment.text,
        `${a.slot} ${a.node.kind}@${a.node.range.line}`,
      ]),
  );
}

describe("F-103 AR-02: config comment slots", () => {
  it("F-103 AR-02: an end-of-line comment trails its statement", () => {
    expect(slots("docker.enabled = true // on\nprocess.cpus = 2\n")).toEqual({
      "// on": "trailing ConfigAssign@1",
    });
  });

  it("F-103 AR-02: a comment before a statement leads it, also inside a block", () => {
    expect(
      slots("// top\nparams.a = 1\nprocess {\n  // inner\n  cpus = 2\n}\n"),
    ).toEqual({
      "// top": "leading ConfigAssign@2",
      "// inner": "leading ConfigAssign@5",
    });
  });

  it("F-103 AR-02: a comment alone in a block dangles on the block, and on a selector", () => {
    expect(
      slots(
        "process {\n  // nothing yet\n}\nprocess {\n  withName: 'A' {\n    // none\n  }\n}\n",
      ),
    ).toEqual({
      "// nothing yet": "dangling ConfigBlock@1",
      "// none": "dangling ConfigSelector@5",
    });
  });

  it("F-103 AR-02: a comment inside a list or closure value is attached within it", () => {
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

  it("F-103 AR-02: a comment in the plugins block leads its entry", () => {
    expect(slots("plugins {\n  // schema\n  id 'nf-schema'\n}\n")).toEqual({
      "// schema": "leading ConfigApply@3",
    });
  });
});

type Upstream = { files: { file: string; comments: DumpRow[] }[] };

describe("F-103 AR-02: config comment attachment against nf-lang", () => {
  const root = join(
    import.meta.dirname,
    "../../../../tools/oracle/cases/config-constructs",
  );
  const upstream = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "fixtures-comments.upstream.json"),
      "utf8",
    ),
  ) as Upstream;

  it("F-103 AR-02: every config fixture's comments are attached as nf-lang 26.10.7 attaches them", () => {
    let compared = 0;
    for (const { file, comments } of upstream.files) {
      const result = parseConfigAst(readFileSync(join(root, file), "utf8"));
      if (!result.ok)
        throw new Error(`${file}: ${JSON.stringify(result.errors)}`);
      const ours = attachments(result.ast);
      expect([...ours.keys()].sort(), `${file}: attached comments`).toEqual(
        comments.map((c) => `${c.line}:${c.column}`).sort(),
      );
      expect(result.ast.comments.length, `${file}: comment map`).toBe(
        comments.length,
      );
      for (const c of comments) {
        const key = `${c.line}:${c.column}`;
        const list = ours.get(key) as Attachment[];
        expect(list, `${file} ${key}`).toHaveLength(1);
        const [mine] = list as [Attachment];
        expect(mine.slot, `${file} ${key} ${c.text} slot`).toBe(c.slot);
        expect(
          anchors(toRow(c), mine.node),
          `${file} ${key}: upstream anchor ${c.node.class}@${c.node.line}:${c.node.column}-${c.node.endLine}:${c.node.endColumn}, ours ${mine.node.kind}@${mine.node.range.line}:${mine.node.range.column}`,
        ).toBe(true);
        compared++;
      }
    }
    expect(compared).toBe(
      upstream.files.reduce((n, f) => n + f.comments.length, 0),
    );
    expect(compared).toBeGreaterThan(20);
  });
});
