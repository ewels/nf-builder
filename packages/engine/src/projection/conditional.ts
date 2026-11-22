// Conditional dataflow (F-107 2.5): the branches of a ternary or elvis expression, each with the guard it runs under.

import type { Expression, Guard } from "@nf-builder/lang-core";

/** `c ? a : b` and `a ?: b` as their value branches, in order; null for any other expression. */
export function branchesOf(
  e: Expression,
):
  | readonly { readonly expression: Expression; readonly guard: Guard }[]
  | null {
  if (e.kind === "Ternary")
    return [
      {
        expression: e.consequent,
        guard: { condition: e.condition.range, branch: "then" },
      },
      {
        expression: e.alternate,
        guard: { condition: e.condition.range, branch: "else" },
      },
    ];
  if (e.kind === "Elvis")
    return [
      {
        expression: e.condition,
        guard: { condition: e.condition.range, branch: "then" },
      },
      {
        expression: e.alternate,
        guard: { condition: e.condition.range, branch: "else" },
      },
    ];
  return null;
}
