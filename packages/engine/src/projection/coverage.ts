// The share of a workflow's main statements the projection models (F-107 step 2, ADR 0004).

import type { Projection } from "@nf-builder/lang-core";

/** How many main statements a projection lists and how many produced no code node. */
export function projectionCoverage(p: Projection): {
  readonly statements: number;
  readonly modelled: number;
} {
  return {
    statements: p.statements.length,
    modelled: p.statements.filter((s) => s.modelled).length,
  };
}
