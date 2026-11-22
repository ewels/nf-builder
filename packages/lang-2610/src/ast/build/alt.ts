import type { ParserRuleContext } from "antlr4ng";

/**
 * Whether `ctx` is the labelled alternative that has `member` (an accessor such as `pathElement` or `SAFE_DOT`).
 *
 * The builders dispatch on the accessors a context has, not on its class, so they work on the contexts of any grammar
 * that shares the rule names and shapes: the script and config grammars share their expression rules, and F-103 builds
 * config expressions with the same code. Token types differ between the two grammars, so the builders read operators
 * from token text, never from token types. The accessors are methods on the class, so unlike the `_label` fields they
 * exist whether or not the alternative matched.
 */
export function has<T extends ParserRuleContext>(
  ctx: ParserRuleContext,
  member: keyof T & string,
): ctx is T {
  return member in ctx;
}

/** Whether `ctx` has any of the accessors, for alternatives that need no narrowing. */
export function hasAny(ctx: ParserRuleContext, ...members: string[]): boolean {
  return members.some((member) => member in ctx);
}
