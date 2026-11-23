// A node's full details in the worker (F-206, UX-30, AR-04): the declaration details and the node's diagnostics.

import type { Diagnostic } from "@nf-builder/lang-core";
import {
  type DetailsInput,
  declarationDetails,
  resolveCallee,
} from "./declaration";
import { diagnosticsWithin, nodeDiagnosticScopes } from "./diagnostics";
import type { NodeDetails } from "./types";

/** Null when the projection has no such node. `diagnostics(path)` is one file's diagnostics, as `Diagnoser.file` gives them. */
export function nodeDetails(
  input: DetailsInput & {
    diagnostics(path: string): readonly Diagnostic[];
  },
  id: string,
): NodeDetails | null {
  const { projection, model } = input;
  const node = projection.nodes.find((n) => n.id === id);
  if (node === undefined) return null;
  const callee =
    node.kind === "call"
      ? resolveCallee(model, projection.workflow.path, node.callee.name)
      : null;
  const scopes = nodeDiagnosticScopes(projection, node, callee);
  const paths = [...new Set(scopes.map((s) => s.path))];
  return {
    node: id,
    declaration: declarationDetails(input, node, callee),
    diagnostics: diagnosticsWithin(paths.flatMap(input.diagnostics), scopes),
  };
}
