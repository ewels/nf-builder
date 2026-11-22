// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/
// ScriptFormattingVisitor.java `visit` (L93-L162) (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
// Not exported from the pack entry (plan F-110 3.2).
import type {
  Comment,
  Declaration,
  PrintOptions,
  PrintResult,
  ScriptAst,
  ScriptPrinter,
} from "@nf-builder/lang-core";
import { attachedComments } from "./comments.ts";
import { Formatter } from "./formatter.ts";
import { createLayout, FRESH_LAYOUT } from "./layout.ts";
import { ScriptFormatter } from "./script-formatter.ts";

export { createLayout };

const missing = (all: readonly Comment[], fmt: Formatter): Comment[] =>
  all.filter((comment) => !fmt.emitted.has(comment));

/** The whole file: the shebang, a code snippet or the declarations, and the script's dangling comments. */
export function printScript(
  ast: ScriptAst,
  options: PrintOptions = {},
): PrintResult {
  const fmt = new Formatter(options.layout ?? FRESH_LAYOUT);
  new ScriptFormatter(fmt).script(ast);
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
  new ScriptFormatter(fmt).declaration(node, null);
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
