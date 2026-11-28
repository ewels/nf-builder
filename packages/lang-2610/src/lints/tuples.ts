// Tuple arity (LA-14, F-302): `nextflow lint` doesn't check a legacy input's shape (spike S1, case
// s1-typed-legacy-tuple-arity: lint accepts, the run fails with "Input tuple does not match tuple declaration"), so a
// typed script's call to a legacy process is compared with the declaration here. Ours, not nf-lang's.
import type {
  Argument,
  FlowType,
  LintFinding,
  LintRule,
  MethodCall,
  Port,
} from "@nf-builder/lang-core";
import { walk } from "@nf-builder/lang-core";
import { wrongArgumentCount } from "./calls.ts";
import { scriptOf } from "./scan.ts";
import { indexEdges, sourceOf } from "./types.ts";

/**
 * How many components a value of `source` has against how many the legacy `tuple` input `port` declares; null when the
 * counts agree or either is unknown (a `Tuple` with no arguments, a non-tuple source, an input with no count).
 */
export function tupleArityOf(
  source: FlowType | null,
  port: Port,
): { expected: number; actual: number } | null {
  const element = source?.element;
  if (element?.name !== "Tuple" || element.args.length === 0) return null;
  const expected = port.components;
  if (expected === undefined || expected === element.args.length) return null;
  return { expected, actual: element.args.length };
}

/** A typed script's call to a legacy process whose `tuple` input gets a tuple of another size. */
export const tupleArity: LintRule = {
  code: "tuple-arity",
  check: (context) => {
    const ast = scriptOf(context);
    if (!ast?.typesEnabled) return [];
    const wrongCount = wrongArgumentCount(context);
    const literals = new Map<string, MethodCall>();
    walk(ast, (node) => {
      const call = node as MethodCall;
      if (
        node.kind === "MethodCall" &&
        call.receiver === null &&
        call.method.kind === "Identifier" &&
        call.method.name === "tuple"
      )
        literals.set(`${call.range.start}:${call.range.end}`, call);
      return undefined;
    });
    const out: LintFinding[] = [];
    for (const projection of context.projections()) {
      const index = indexEdges(projection);
      for (const node of projection.nodes) {
        if (node.kind !== "call" || wrongCount.has(node.range.start)) continue;
        const { callee } = node;
        if (
          callee.status !== "modelled" ||
          callee.kind !== "process" ||
          callee.typed === true
        )
          continue;
        for (const port of node.inputs) {
          if (port.components === undefined || !port.argument) continue;
          const literal = literals.get(
            `${port.argument.start}:${port.argument.end}`,
          );
          const found = literal
            ? literalArity(literal.args, port.components)
            : tupleArityOf(sourceOf(index, node, port), port);
          if (found)
            out.push({
              range: port.argument,
              message: `Tuple with ${found.actual} ${found.actual === 1 ? "component" : "components"} is passed to the \`tuple\` input \`${port.label}\` of \`${callee.name}\`, which declares ${found.expected} -- pass one argument per declared component`,
            });
        }
      }
    }
    return out;
  },
};

/** A `tuple(...)` literal's component count against the declared one; null when they agree or it has named arguments. */
function literalArity(
  args: readonly Argument[],
  expected: number,
): { expected: number; actual: number } | null {
  if (args.some((a) => a.kind === "NamedArgument")) return null;
  return args.length === expected ? null : { expected, actual: args.length };
}
