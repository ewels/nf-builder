// Conditional dataflow (F-107 2.5): the branches of a ternary or elvis expression, each with the guard it runs under.

import type { Expression, Guard } from "@nf-builder/lang-core";

/** `c ? a : b` and `a ?: b` as their value branches, in order; null for any other expression. */
export function branchesOf(
  e: Expression,
):
  | readonly { readonly expression: Expression; readonly guard: Guard }[]
  | null {
  if (e.kind !== "Ternary" && e.kind !== "Elvis") return null;
  const condition = e.condition.range;
  return [
    {
      expression: e.kind === "Ternary" ? e.consequent : e.condition,
      guard: { condition, branch: "then" },
    },
    { expression: e.alternate, guard: { condition, branch: "else" } },
  ];
}
