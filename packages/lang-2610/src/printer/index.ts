// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/
// ScriptFormattingVisitor.java `visit` (L93-L162) (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE).
// Not exported from the pack entry (plan F-110 3.2).
import type {
  Comment,
  ConfigApply,
  ConfigAst,
  ConfigPrinter,
  ConfigStatement,
  Declaration,
  PrintOptions,
  PrintResult,
  ScriptAst,
  ScriptPrinter,
} from "@nf-builder/lang-core";
import { attachedComments } from "./comments.ts";
import { ConfigFormatter } from "./config-formatter.ts";
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
    // the comment map, and the comments of nodes an edit created, which it doesn't list
    missingComments: missing(
      [...new Set([...ast.comments, ...attachedComments(ast)])],
      fmt,
    ),
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

/** The whole config file, as `nextflow lint -format` prints it (F-601, ADR 0032). */
export function printConfig(
  ast: ConfigAst,
  options: PrintOptions = {},
): PrintResult {
  const fmt = new Formatter(options.layout ?? FRESH_LAYOUT);
  new ConfigFormatter(fmt).config(ast);
  return {
    text: fmt.toString(),
    missingComments: missing(
      [...new Set([...ast.comments, ...attachedComments(ast)])],
      fmt,
    ),
  };
}

/** One config statement at `indent` levels: its leading comments, the statement, its trailing comment and a final "\n". */
export function printConfigStatement(
  node: ConfigStatement | ConfigApply,
  options: PrintOptions & { readonly indent?: number } = {},
): PrintResult {
  const fmt = new Formatter(options.layout ?? FRESH_LAYOUT);
  for (let i = 0; i < (options.indent ?? 0); i++) fmt.incIndent();
  new ConfigFormatter(fmt).statement(node);
  return {
    text: fmt.toString(),
    missingComments: missing(attachedComments(node), fmt),
  };
}

export const configPrinter = {
  printConfig,
  printConfigStatement,
} satisfies ConfigPrinter;
