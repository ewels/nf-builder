// The processes the entry workflow reaches, for selector counts (F-601, FI-06). It follows calls through named
// workflows and includes with the model's own name lookup, and records every name a `withName` selector can match.
import {
  type AstNode,
  type Expression,
  type IncludableDeclaration,
  type ProcessDef,
  type ScriptAst,
  type Statement,
  type WorkflowDef,
  walk,
} from "@nf-builder/lang-core";
import type { Binding } from "../model/file-model";
import type { ProjectModel } from "../model/project";
import type { ProcessUse, ProcessUses } from "./types";

const MAX_DEPTH = 20;

const isStatement = (item: { kind: string }): item is Statement =>
  [
    "Block",
    "ExpressionStatement",
    "VariableDeclaration",
    "Assignment",
    "If",
    "TryCatch",
    "Return",
    "Throw",
    "Assert",
  ].includes(item.kind);

/** What a name is bound to, and the file that declares it. */
function resolve(
  model: ProjectModel,
  path: string,
  name: string,
): { declaration: IncludableDeclaration; path: string; base: string } | null {
  const binding: Binding | undefined = model.lookup(path, name);
  if (!binding) return null;
  if (binding.kind === "declaration")
    return { declaration: binding.declaration, path, base: name };
  const target = binding.include.target;
  const declaration = binding.entry.declaration;
  if (target.kind !== "file" || declaration === null) return null;
  return {
    declaration,
    path: target.path,
    base: binding.entry.entry.name.name,
  };
}

const nameOf = (id: { kind: string; name?: string; value?: string }): string =>
  (id.kind === "Identifier" ? id.name : id.value) ?? "";

/** The string-literal arguments of a process's `label` directives. */
function labelsOf(process: ProcessDef): string[] {
  const labels: string[] = [];
  for (const item of process.directives?.items ?? []) {
    const call = item.expression;
    if (call.kind !== "MethodCall" || call.receiver !== null) continue;
    if (nameOf(call.method) !== "label") continue;
    for (const arg of call.args)
      if (arg.kind === "String") labels.push(arg.value);
  }
  return labels;
}

/** The names a workflow body calls: plain calls, and the variable on the right of a legacy `|` or `&`. */
function calledNames(nodes: readonly AstNode[]): string[] {
  const names: string[] = [];
  for (const root of nodes)
    walk(root, (node) => {
      if (node.kind === "MethodCall") {
        const call = node as Extract<Expression, { kind: "MethodCall" }>;
        if (call.receiver === null) names.push(nameOf(call.method));
      } else if (node.kind === "Binary") {
        const binary = node as Extract<Expression, { kind: "Binary" }>;
        if (
          (binary.operator === "|" || binary.operator === "&") &&
          binary.right.kind === "Variable"
        )
          names.push(binary.right.name);
      }
      return undefined;
    });
  return names;
}

interface Entry {
  readonly path: string;
  readonly nodes: readonly AstNode[];
}

/** `main.nf`'s unnamed workflow, else the first one; a script with top-level statements has an unnamed workflow too. */
function entryWorkflow(model: ProjectModel): Entry | null {
  const found: Entry[] = [];
  for (const path of model.paths()) {
    const source = model.file(path)?.source;
    if (source?.language !== "nextflow" || source.ast === null) continue;
    const ast: ScriptAst = source.ast;
    const entry = ast.body.find(
      (i): i is WorkflowDef => i.kind === "Workflow" && i.name === null,
    );
    if (entry)
      found.push({
        path,
        nodes: [...(entry.main?.items ?? []), ...(entry.emits?.items ?? [])],
      });
    else {
      const statements = ast.body.filter(isStatement);
      if (statements.length > 0) found.push({ path, nodes: statements });
    }
  }
  return found.find((e) => e.path === "main.nf") ?? found[0] ?? null;
}

export function processUses(model: ProjectModel): ProcessUses {
  const entry = entryWorkflow(model);
  const uses = new Map<string, ProcessUse>();
  if (entry === null) {
    for (const path of model.paths()) {
      const file = model.file(path);
      for (const [name, d] of file?.declarations ?? [])
        if (d.declaration.kind === "Process")
          uses.set(`${path}#${name}`, {
            fq: name,
            simple: name,
            base: name,
            labels: labelsOf(d.declaration),
            path,
          });
    }
    return { entry: null, uses: [...uses.values()] };
  }

  const visit = (
    nodes: readonly AstNode[],
    path: string,
    prefix: string,
    stack: readonly WorkflowDef[],
  ): void => {
    for (const name of calledNames(nodes)) {
      const target = resolve(model, path, name);
      if (target === null) continue;
      const { declaration } = target;
      if (declaration.kind === "Process") {
        const fq = `${prefix}${name}`;
        if (!uses.has(fq))
          uses.set(fq, {
            fq,
            simple: name,
            base: target.base,
            labels: labelsOf(declaration),
            path: target.path,
          });
      } else if (
        declaration.kind === "Workflow" &&
        stack.length < MAX_DEPTH &&
        !stack.includes(declaration)
      ) {
        visit(
          [
            ...(declaration.main?.items ?? []),
            ...(declaration.emits?.items ?? []),
          ],
          target.path,
          `${prefix}${name}:`,
          [...stack, declaration],
        );
      }
    }
  };
  visit(entry.nodes, entry.path, "", []);
  return { entry: entry.path, uses: [...uses.values()] };
}
