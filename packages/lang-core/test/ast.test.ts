import { describe, expect, it } from "vitest";
import {
  type Comment,
  childNodes,
  type Range,
  SCRIPT_NODE_KINDS,
  type ScriptNode,
  type TypedProcess,
  walk,
} from "../src/index.ts";

type MissingKinds = Exclude<
  ScriptNode["kind"],
  (typeof SCRIPT_NODE_KINDS)[number]
>;
// Compile-time half of the exhaustiveness test: `MissingKinds` must be `never`.
const noMissingKinds: MissingKinds[] = [];

const range = (start: number, end: number): Range => ({
  start,
  end,
  line: 1,
  column: start + 1,
  endLine: 1,
  endColumn: end + 1,
});
const identifier = (name: string, start: number) => ({
  kind: "Identifier" as const,
  name,
  range: range(start, start + name.length),
});

describe("F-102 AR-02: the script AST types and walker", () => {
  it("F-102 AR-02: SCRIPT_NODE_KINDS lists every node kind once", () => {
    expect(noMissingKinds).toEqual([]);
    expect(new Set(SCRIPT_NODE_KINDS).size).toBe(SCRIPT_NODE_KINDS.length);
  });

  it("F-102 AR-02: walk visits children in field order and skips ranges and comments", () => {
    const comment: Comment = {
      kind: "line",
      text: "// c",
      range: range(0, 4),
      ownLine: true,
    };
    const stage = {
      kind: "Section" as const,
      label: "stage" as const,
      labelRange: range(30, 36),
      items: [],
      range: range(30, 40),
    };
    const process: TypedProcess = {
      kind: "Process",
      typed: true,
      range: range(5, 50),
      leadingComments: [comment],
      name: identifier("P", 13),
      directives: null,
      inputs: null,
      stage,
      outputs: null,
      topics: null,
      when: null,
      exec: null,
      stub: null,
    };
    const visited: string[] = [];
    walk(process, (node, parent) => {
      visited.push(`${node.kind}${parent ? ` < ${parent.kind}` : ""}`);
    });
    expect(visited).toEqual([
      "Process",
      "Identifier < Process",
      "Section < Process",
    ]);
    expect(childNodes(process).map((n) => n.kind)).toEqual([
      "Identifier",
      "Section",
    ]);
    // A subtree is skipped when the visitor returns false.
    const seen: string[] = [];
    walk(process, (node) => {
      seen.push(node.kind);
      return node.kind === "Process" ? false : undefined;
    });
    expect(seen).toEqual(["Process"]);
  });
});
