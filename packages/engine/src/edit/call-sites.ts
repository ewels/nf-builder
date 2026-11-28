// Where a process is called, and what its calls pass after its inputs change (F-303, ADR 0039, LA-33).
import {
  type Argument,
  type AstNode,
  type IncludableDeclaration,
  type MethodCall,
  walk,
} from "@nf-builder/lang-core";
import type { ProjectModel } from "../model/project";
import { nullLiteral } from "./nodes";

export interface CallSite {
  readonly path: string;
  /** The name the file calls it by: the include's alias, else the name. */
  readonly localName: string;
  /** The call; null for a use that has no argument list to change, such as `channel.of(1) | NAME`. */
  readonly call: MethodCall | null;
  /** The top-level item (workflow or function) holding it. */
  readonly item: AstNode;
}

/** Every call of the process `name` declared in `path`: in its own file and in every file that includes it, aliased or not. */
export function processCalls(
  model: ProjectModel,
  path: string,
  name: string,
): CallSite[] {
  const target = model.file(path)?.declarations.get(name)?.declaration;
  if (!target) return [];
  const sites: CallSite[] = [];
  for (const p of model.paths()) {
    const file = model.file(p);
    if (file?.source.language !== "nextflow" || !file.source.ast) continue;
    const locals = new Set<string>();
    for (const [local, binding] of file.scope) {
      const bound: IncludableDeclaration | null | undefined =
        binding.kind === "declaration"
          ? binding.declaration
          : binding.entry.declaration;
      if (bound === target) locals.add(local);
    }
    if (locals.size === 0) continue;
    for (const item of file.source.ast.body) {
      if (item.kind === "Unparsed") continue;
      walk(item as AstNode, (node) => {
        const n = node as unknown as Record<string, unknown>;
        if (
          node.kind === "MethodCall" &&
          n.receiver === null &&
          (n.method as { kind: string; name?: string }).kind === "Identifier" &&
          locals.has((n.method as { name: string }).name)
        )
          sites.push({
            path: p,
            localName: (n.method as { name: string }).name,
            call: node as MethodCall,
            item: item as AstNode,
          });
        else if (node.kind === "Binary" && n.operator === "|") {
          const right = n.right as { kind: string; name?: string };
          if (right.kind === "Variable" && locals.has(right.name as string))
            sites.push({
              path: p,
              localName: right.name as string,
              call: null,
              item: item as AstNode,
            });
        }
        return undefined;
      });
    }
  }
  return sites;
}

/**
 * The call's arguments after its inputs were reordered, dropped or added: the positional argument each new input came
 * from (`origins`, null for a new input, which gets `null`), then the named arguments as they were.
 */
export function remapArguments(
  call: MethodCall,
  origins: readonly (number | null)[],
): Argument[] {
  const positional = call.args.filter((a) => a.kind !== "NamedArgument");
  const named = call.args.filter((a) => a.kind === "NamedArgument");
  const mapped = origins.map((origin): Argument => {
    const arg = origin === null ? undefined : positional[origin];
    return arg ?? nullLiteral();
  });
  return [...mapped, ...named];
}
