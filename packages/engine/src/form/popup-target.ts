// What a double-click on a node opens (F-303, UX-40, UX-42): pure, from the projected node alone.
import type { GraphNode } from "@nf-builder/lang-core";

export type PopupTarget =
  | {
      readonly kind: "typedProcess";
      readonly path: string;
      readonly name: string;
    }
  /** F-307 opens the workflow's tab; the popup does nothing. */
  | { readonly kind: "workflow" }
  | { readonly kind: "unavailable"; readonly reason: string };

const unavailable = (reason: string): PopupTarget => ({
  kind: "unavailable",
  reason,
});

/** The popup a node opens: Configure for a call of a modelled typed process, else nothing, with the reason why. */
export function popupTarget(node: GraphNode): PopupTarget {
  if (node.kind !== "call")
    return unavailable(`Configure isn't available for ${node.kind} nodes yet.`);
  const { callee } = node;
  if (callee.status === "unresolved" || callee.path === null)
    return unavailable(`${callee.name} isn't found in the project.`);
  if (callee.status === "unparsed")
    return unavailable(
      `${callee.name} has code that doesn't parse. Fix it in the Code tab before editing it here.`,
    );
  if (callee.kind === "workflow") return { kind: "workflow" };
  if (callee.kind === "process" && callee.typed === false)
    return unavailable(
      "Editing legacy processes arrives with Migrate to typed.",
    );
  if (callee.kind === "process" && callee.typed === true)
    return { kind: "typedProcess", path: callee.path, name: callee.name };
  return unavailable(
    `Configure isn't available for ${callee.kind ?? "unknown"} nodes yet.`,
  );
}
