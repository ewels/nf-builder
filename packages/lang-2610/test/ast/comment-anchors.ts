import { type AstNode, type Comment, walk } from "@nf-builder/lang-core";

// Shared by comments.test.ts (the fixtures) and test/corpus/ast.corpus.ts (the whole corpus): where our comment
// attachment put each comment, and whether a node is the anchor nf-lang's CommentAttacher chose.

type Built = AstNode;

export type Slot = "leading" | "trailing" | "dangling";
export type Attachment = {
  slot: Slot;
  node: AstNode & Record<string, unknown>;
  comment: Comment;
};

/** Every attachment in the tree, by the comment's `line:column`. */
export function attachments(ast: Built): Map<string, Attachment[]> {
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

/** One of nf-lang's attachments: `anchor` is the Java class of the node the comment is attached to. */
export type Row = {
  line: number;
  column: number;
  slot: Slot;
  anchor: string;
  from: [number, number];
  to: [number, number];
  text: string;
};

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

/** nf-lang's config node classes and the kinds of our config nodes that stand for them. */
const CONFIG_ANCHORS: Record<string, readonly string[]> = {
  ConfigNode: ["ConfigFile"],
  ConfigAssignNode: ["ConfigAssign"],
  ConfigBlockNode: ["ConfigBlock", "ConfigSelector"],
  ConfigApplyBlockNode: ["ConfigApplyBlock"],
  ConfigApplyNode: ["ConfigApply"],
  ConfigIncludeNode: ["ConfigInclude"],
};

/**
 * Whether our node is nf-lang's anchor: the same kind family at the same start and end (a block, by its first item).
 * `allowLabelStart`: a statement with labels starts at its first label in our tree (ADR 0027), so its start column may
 * differ from nf-lang's; the line and the end must still match.
 */
export function anchors(
  row: Row,
  node: AstNode & Record<string, unknown>,
  options: { allowLabelStart?: boolean } = {},
): boolean {
  if (row.anchor === "ScriptNode") return node.kind === "Script";
  const config = CONFIG_ANCHORS[row.anchor];
  if (config)
    return (
      config.includes(node.kind) &&
      (node.kind === "ConfigFile" ||
        (node.range.line === row.from[0] &&
          node.range.column === row.from[1] &&
          node.range.endLine === row.to[0] &&
          node.range.endColumn === row.to[1]))
    );
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
  const labelled =
    options.allowLabelStart === true &&
    Array.isArray(node.labels) &&
    node.labels.length > 0;
  return (
    family.has(node.kind) &&
    r.line === row.from[0] &&
    (labelled || r.column === row.from[1]) &&
    r.endLine === row.to[0] &&
    r.endColumn === row.to[1]
  );
}
