import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AstNode, type Comment, walk } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import { checkRanges } from "./check-ranges.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(dir, path), "utf8");

function build(text: string) {
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.ast;
}

type Slot = "leading" | "trailing" | "dangling";
type Attachment = {
  slot: Slot;
  node: AstNode & Record<string, unknown>;
  comment: Comment;
};

/** Every attachment in the tree, by the comment's `line:column`. */
function attachments(ast: ReturnType<typeof build>): Map<string, Attachment[]> {
  const out = new Map<string, Attachment[]>();
  walk(ast, (node) => {
    for (const slot of ["leading", "trailing", "dangling"] as const) {
      const list = (node as unknown as Record<string, Comment[] | undefined>)[
        `${slot}Comments`
      ];
      for (const comment of list ?? []) {
        const key = `${comment.range.line}:${comment.range.column}`;
        const entry = { slot, node: node as Attachment["node"], comment };
        out.set(key, [...(out.get(key) ?? []), entry]);
      }
    }
  });
  return out;
}

type Row = {
  line: number;
  column: number;
  slot: Slot;
  anchor: string;
  from: [number, number];
  to: [number, number];
  text: string;
};

/** `fixtures-comments.upstream.txt`: nf-lang 26.10.7's attachments, from `DumpComments.java`. */
function upstreamRows(): Map<string, Row[]> {
  const files = new Map<string, Row[]>();
  let rows: Row[] = [];
  for (const line of read("fixtures-comments.upstream.txt").split("\n")) {
    if (line.startsWith("== ")) {
      rows = [];
      files.set(line.slice(3), rows);
      continue;
    }
    const m =
      /^(\d+):(\d+) (leading|trailing|dangling) (\w+)@(-?\d+):(-?\d+)-(-?\d+):(-?\d+) (.*)$/.exec(
        line,
      );
    if (!m) continue;
    rows.push({
      line: Number(m[1]),
      column: Number(m[2]),
      slot: m[3] as Slot,
      anchor: m[4] as string,
      from: [Number(m[5]), Number(m[6])],
      to: [Number(m[7]), Number(m[8])],
      text: m[9] as string,
    });
  }
  return files;
}

const STATEMENTS = new Set([
  "ExpressionStatement",
  "VariableDeclaration",
  "Assignment",
  "If",
  "TryCatch",
  "Return",
  "Throw",
  "Assert",
  "EmptyStatement",
  "NamedOutput",
]);
const EXPRESSIONS = new Set([
  "Variable",
  "Number",
  "String",
  "Boolean",
  "Null",
  "GString",
  "List",
  "Map",
  "MapEntry",
  "NamedArgument",
  "Closure",
  "Property",
  "Index",
  "MethodCall",
  "Call",
  "New",
  "Unary",
  "Binary",
  "Cast",
  "TypeTest",
  "Ternary",
  "Elvis",
  "Parenthesized",
]);
const DECLARATIONS = new Set([
  "FeatureFlag",
  "Include",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Output",
  "Function",
]);
const PARAMETERS = new Set([
  "TypedName",
  "Param",
  "Parameter",
  "RecordInput",
  "TupleInput",
]);

/** Whether our node is nf-lang's anchor: the same kind family at the same start and end (a block, by its first item). */
function anchors(row: Row, node: AstNode & Record<string, unknown>): boolean {
  if (row.anchor === "ScriptNode") return node.kind === "Script";
  const r = node.range;
  if (row.anchor === "BlockStatement") {
    // upstream's block starts at its first statement; ours includes the braces
    const first =
      node.kind === "Block"
        ? (node.statements as AstNode[])[0]
        : node.kind === "Section"
          ? (node.items as AstNode[])[0]
          : undefined;
    return (
      first !== undefined &&
      first.range.line === row.from[0] &&
      first.range.column === row.from[1]
    );
  }
  const family =
    row.anchor.endsWith("Statement") && row.anchor !== "BlockStatement"
      ? STATEMENTS
      : row.anchor.endsWith("Expression")
        ? EXPRESSIONS
        : row.anchor === "Parameter"
          ? PARAMETERS
          : row.anchor.endsWith("Node") || /^\w+Node(V\d)?$/.test(row.anchor)
            ? DECLARATIONS
            : new Set<string>();
  return (
    family.has(node.kind) &&
    r.line === row.from[0] &&
    r.column === row.from[1] &&
    r.endLine === row.to[0] &&
    r.endColumn === row.to[1]
  );
}

/** Differences from nf-lang that are known and explained: `file:line:column` and the cause. */
const KNOWN_DIFFERENCES: Record<string, string> = {};

describe("F-102 AR-02: comment attachment", () => {
  const upstream = upstreamRows();
  const fixtures = (
    JSON.parse(read("fixtures.json")) as { fixtures: { file: string }[] }
  ).fixtures.map((f) => f.file);

  it("F-102 AR-02: comments are attached as nf-lang 26.10.7 attaches them, for every fixture", () => {
    let compared = 0;
    for (const file of fixtures) {
      const text = read(`fixtures/${file}`);
      const ast = build(text);
      const ours = attachments(ast);
      const rows = upstream.get(file) ?? [];
      // the same comments are attached, each once
      expect([...ours.keys()].sort(), `${file}: attached comments`).toEqual(
        rows.map((r) => `${r.line}:${r.column}`).sort(),
      );
      for (const [key, list] of ours)
        expect(list, `${file} ${key}`).toHaveLength(1);
      expect(ast.comments.length, `${file}: comment map`).toBe(rows.length);
      for (const row of rows) {
        const key = `${row.line}:${row.column}`;
        const [mine] = ours.get(key) as Attachment[];
        if (KNOWN_DIFFERENCES[`${file}:${key}`]) continue;
        expect(mine?.slot, `${file} ${key} ${row.text} slot`).toBe(row.slot);
        expect(
          anchors(row, mine?.node as Attachment["node"]),
          `${file} ${key} ${JSON.stringify(row.text)}: upstream anchor ${row.anchor}@${row.from}-${row.to}, ours ${mine?.node.kind}@${mine?.node.range.line}:${mine?.node.range.column}-${mine?.node.range.endLine}:${mine?.node.range.endColumn}`,
        ).toBe(true);
        compared++;
      }
      expect(
        checkRanges(ast, text, { reparse: "none", attached: true }),
        file,
      ).toEqual([]);
    }
    expect(compared).toBe(45);
  });

  it("F-102 AR-02: leading, trailing and dangling comments in comments-attachment.nf", () => {
    const ast = build(read("fixtures/comments-attachment.nf"));
    const find = (text: string) => {
      const [hit] = [...attachments(ast).values()]
        .flat()
        .filter((a) => a.comment.text.startsWith(text));
      if (!hit) throw new Error(`no attachment for ${text}`);
      return hit;
    };
    const at = (a: Attachment) =>
      `${a.slot} ${a.node.kind}@${a.node.range.line}:${a.node.range.column}`;

    const doc = find("/**");
    expect(doc.comment.kind).toBe("doc");
    expect(at(doc)).toBe("leading Process@7:1");
    expect(at(find("// one is enough"))).toBe(
      "trailing ExpressionStatement@9:5",
    );
    expect(at(find("// dangling at the end of the script section"))).toBe(
      "dangling Process@7:1",
    );
    // the link `.map { }` of the chain `channel.of(...).map { }.set { }`
    expect(at(find("// a comment between chain links"))).toBe(
      "leading MethodCall@27:5",
    );
    // the else block, whose first statement is `println 'no'`
    const beforeElse = find("// before else");
    expect(beforeElse.slot).toBe("leading");
    expect(beforeElse.node.kind).toBe("Block");
    expect(at(find("// dangling at the end of the file"))).toBe(
      "dangling Script@1:1",
    );
  });

  it("F-102 AR-02: comments in if, try, list and closure containers match nf-lang, and each ends in exactly one slot", () => {
    const text = [
      "workflow {",
      "    // leads the if",
      "    if( x ) {",
      "        // only a comment",
      "    } // trailing the then block",
      "    // before else",
      "    else {",
      "        foo() // trailing foo",
      "    }",
      "    try {",
      "        bar()",
      "    }",
      "    // before catch",
      "    catch( e ) {",
      "        // dangling in catch",
      "    }",
      "    def list = [",
      "        1, // after one",
      "        // before two",
      "        2",
      "        // dangling in list",
      "    ]",
      "    items.each { v ->",
      "        // inside the closure",
      "        println v",
      "    }",
      "}",
      "",
    ].join("\n");
    const ast = build(text);
    expect(checkRanges(ast, text, { reparse: "none", attached: true })).toEqual(
      [],
    );
    const at = (needle: string) => {
      const hit = [...attachments(ast).values()]
        .flat()
        .find((a) => a.comment.text.includes(needle));
      if (!hit) throw new Error(needle);
      return `${hit.slot} ${hit.node.kind}`;
    };
    // as nf-lang 26.10.7 attaches them (`DumpComments.java` on this text). The then block is empty, so it has no
    // position upstream: the comments up to the first statement of the else block are dangling on it.
    expect(at("leads the if")).toBe("leading If");
    expect(at("only a comment")).toBe("dangling Block");
    expect(at("trailing the then block")).toBe("dangling Block");
    expect(at("before else")).toBe("dangling Block");
    expect(at("trailing foo")).toBe("trailing ExpressionStatement");
    expect(at("before catch")).toBe("leading TryCatch");
    expect(at("dangling in catch")).toBe("dangling Block");
    expect(at("after one")).toBe("trailing Number");
    expect(at("before two")).toBe("leading Number");
    expect(at("dangling in list")).toBe("dangling List");
    expect(at("inside the closure")).toBe("leading ExpressionStatement");
  });
});
