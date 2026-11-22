import {
  type AstNode,
  type CodeNode,
  type ScriptAst,
  walk,
} from "@nf-builder/lang-core";
import type { ProjectModel } from "../../../src/model/project";
import type { Projector } from "../../../src/projection/project";

const COMMENTS = new Set([
  "range",
  "labelRange",
  "elseRange",
  "leadingComments",
  "trailingComments",
  "danglingComments",
  "comments",
  "shebang",
]);
/** A node as plain data without ranges and comments, for comparing statements that sit at different places. */
export const plain = (node: unknown): string =>
  JSON.stringify(node, (key, value) => (COMMENTS.has(key) ? undefined : value));

export interface CodeNodeAt {
  readonly path: string;
  readonly node: CodeNode;
  readonly text: string;
  readonly typed: boolean;
  readonly ast: ScriptAst;
}

/** Every code node of every modelled workflow, with the text of its file. */
export function codeNodes(
  model: ProjectModel,
  projector: Projector,
): CodeNodeAt[] {
  const out: CodeNodeAt[] = [];
  for (const ref of projector.workflows()) {
    if (!ref.modelled) continue;
    const source = model.file(ref.path)?.source;
    if (source?.language !== "nextflow" || source.ast === null) continue;
    const projection = projector.project(ref.path, ref.name);
    for (const node of projection?.nodes ?? [])
      if (node.kind === "code")
        out.push({
          path: ref.path,
          node,
          text: source.text,
          typed: source.ast.typesEnabled,
          ast: source.ast,
        });
  }
  return out;
}

/** The statement in `ast` that a code node stands for. */
export function statementOf(
  ast: ScriptAst,
  node: CodeNode,
): AstNode | undefined {
  let found: AstNode | undefined;
  walk(ast, (n) => {
    if (
      found === undefined &&
      n.range.start === node.range.start &&
      n.range.end === node.range.end &&
      n.kind !== "Section"
    )
      found = n;
    return undefined;
  });
  return found;
}

/** A code node's text wrapped in `workflow { main: ... }`, with the file's types flag. */
export const wrapped = (node: CodeNode, typed: boolean): string =>
  `${typed ? "nextflow.enable.types = true\n\n" : ""}workflow {\n    main:\n${node.text}\n}\n`;
