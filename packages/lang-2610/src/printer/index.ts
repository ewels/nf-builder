// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/
// ScriptFormattingVisitor.java `visit` (L93-L162) and `visitFunction` (L655-L675) (Apache-2.0; see ../../grammar/NOTICE
// and ../../grammar/LICENSE). Not exported from the pack entry (plan F-110 3.2).
import {
  type Comment,
  type Declaration,
  PrintError,
  type PrintOptions,
  type PrintResult,
  type ScriptAst,
  type ScriptItem,
  type ScriptPrinter,
  type Statement,
} from "@nf-builder/lang-core";
import { attachedComments } from "./comments.ts";
import { Formatter } from "./formatter.ts";
import { createLayout, FRESH_LAYOUT } from "./layout.ts";
import { hasLegacyType, hasType } from "./types.ts";

export { createLayout };

const DECLARATIONS: ReadonlySet<string> = new Set([
  "FeatureFlag",
  "Include",
  "Import",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Function",
  "IncompleteDeclaration",
]);

const isDeclaration = (item: ScriptItem): item is Declaration =>
  DECLARATIONS.has(item.kind);

function declaration(fmt: Formatter, node: Declaration): void {
  switch (node.kind) {
    case "Function":
      func(fmt, node);
      return;
    case "Import":
      throw new PrintError("import declarations are not supported", node);
    case "IncompleteDeclaration":
      throw new PrintError("incomplete declaration", node);
    default:
      throw new PrintError(`not ported yet: ${node.kind}`, node);
  }
}

/** L655 */
function func(
  fmt: Formatter,
  node: Extract<Declaration, { kind: "Function" }>,
): void {
  fmt.appendLeadingComments(node);
  fmt.append(`def ${node.name.name}(`);
  fmt.parameters(node.params);
  fmt.append(")");
  if (hasLegacyType(node.legacyReturnType)) {
    fmt.append(" -> ");
    fmt.legacyTypeAnnotation(node.legacyReturnType);
  } else if (hasType(node.returnType)) {
    fmt.append(" -> ");
    fmt.typeAnnotation(node.returnType);
  }
  fmt.append(" {\n");
  fmt.incIndent();
  fmt.statements(node.body.statements, null);
  fmt.appendDanglingComments(node);
  fmt.decIndent();
  fmt.append("}");
  fmt.appendTrailingComment(node);
  fmt.appendNewLine();
}

const missing = (all: readonly Comment[], fmt: Formatter): Comment[] =>
  all.filter((comment) => !fmt.emitted.has(comment));

/** The whole file (L93): the shebang, a code snippet or the declarations, and the script's dangling comments. */
export function printScript(
  ast: ScriptAst,
  options: PrintOptions = {},
): PrintResult {
  const fmt = new Formatter(options.layout ?? FRESH_LAYOUT);
  if (ast.shebang) {
    fmt.append(ast.shebang.text);
    fmt.appendNewLine();
  }

  const declarations = ast.body.filter(isDeclaration);
  const statements = ast.body.filter(
    (item): item is Statement =>
      !isDeclaration(item) && item.kind !== "InvalidDeclaration",
  );
  for (const item of ast.body)
    if (item.kind === "InvalidDeclaration")
      throw new PrintError("invalid declaration", item);
  if (statements.length > 0 && declarations.length > 0)
    throw new PrintError(
      "a script cannot mix top-level statements and declarations",
      statements[0] as Statement,
    );

  if (statements.length > 0) {
    // a code snippet
    fmt.statements(statements, null);
  } else {
    for (const node of declarations) declaration(fmt, node);
  }
  fmt.appendDanglingComments(ast);

  return {
    text: fmt.toString(),
    missingComments: missing(ast.comments, fmt),
  };
}

/** One declaration: its leading comments, the declaration, its trailing comment and a final "\n". */
export function printDeclaration(
  node: Declaration,
  options: PrintOptions = {},
): PrintResult {
  const fmt = new Formatter(options.layout ?? FRESH_LAYOUT);
  declaration(fmt, node);
  return {
    text: fmt.toString(),
    missingComments: missing(attachedComments(node), fmt),
  };
}

export const scriptPrinter = {
  createLayout,
  printScript,
  printDeclaration,
} satisfies ScriptPrinter;
