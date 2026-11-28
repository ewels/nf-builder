// The share of a workflow's main statements the projection models (F-107 step 2, ADR 0004).

import type { Projection } from "@nf-builder/lang-core";
import type { SummaryCoverage } from "../details/types";

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

/** The share as the workflow summary shows it (F-405): the percentage rounds down, and is null for no statements. */
export function modelledShare(c: {
  readonly statements: number;
  readonly modelled: number;
}): SummaryCoverage {
  return {
    statements: c.statements,
    modelled: c.modelled,
    percent:
      c.statements === 0 ? null : Math.floor((100 * c.modelled) / c.statements),
  };
}
