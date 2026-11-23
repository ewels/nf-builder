// Which diagnostics belong to a node (F-206, UX-30, AR-05): those whose range lies inside the node's range in the
// workflow file, inside its callee's declaration, or inside the include that binds an unparsed or unresolved callee.

import type {
  Diagnostic,
  GraphNode,
  Projection,
  Range,
} from "@nf-builder/lang-core";
import { compareDiagnostics } from "../diagnostics/diagnose";
import { problemKey } from "../problems/sections";
import type { CalleeDeclaration } from "./declaration";
import { rangeContains, spansWorkflow } from "./node-range";

export interface DiagnosticScope {
  readonly path: string;
  readonly range: Range;
}

export function nodeDiagnosticScopes(
  projection: Projection,
  node: GraphNode,
  callee: CalleeDeclaration | null,
): DiagnosticScope[] {
  if (spansWorkflow(projection, node)) return [];
  const path = projection.workflow.path;
  const scopes: DiagnosticScope[] = [{ path, range: node.range }];
  if (node.kind !== "call" || callee === null) return scopes;
  const declaration = callee.declaration;
  if (
    callee.path !== null &&
    declaration !== null &&
    declaration.kind !== "Script" &&
    declaration.kind !== "ParamsBlock"
  )
    scopes.push({ path: callee.path, range: declaration.range });
  if (node.callee.status !== "modelled" && callee.include !== null)
    scopes.push({ path, range: callee.include.range });
  return scopes;
}

/** The diagnostics inside any scope, without duplicates, in `compareDiagnostics` order. */
export function diagnosticsWithin(
  diagnostics: readonly Diagnostic[],
  scopes: readonly DiagnosticScope[],
): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    if (
      !scopes.some((s) => s.path === d.path && rangeContains(s.range, d.range))
    )
      continue;
    const key = problemKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort(compareDiagnostics);
}
