import type { SourceParser } from "@nf-builder/lang-core";

interface Classification {
  readonly kind: "process" | "workflow";
  readonly component: string | null;
  /** null: main.nf could not be modelled (ADR 0004). */
  readonly typed: boolean | null;
}

const registryKind = (kind: string | undefined): "process" | "workflow" =>
  kind?.toLowerCase() === "workflow" ? "workflow" : "process";

/**
 * Typed or legacy, process or workflow, from the module's `main.nf` (IO-31). The parsed declaration wins over the
 * registry: the one named `componentName`, otherwise the only one. When none qualifies, kind and component come from
 * the registry and `typed` is null.
 */
export function classifyModule(
  parser: SourceParser,
  mainNf: string | null,
  registry: { kind?: string; componentName?: string },
): Classification {
  if (mainNf !== null) {
    const declarations = (parser.parseScript(mainNf).ast?.body ?? []).flatMap(
      (item) =>
        (item.kind === "Process" || item.kind === "Workflow") &&
        item.name !== null
          ? [item]
          : [],
    );
    const named = declarations.filter(
      (d) => d.name?.name === registry.componentName,
    );
    const chosen =
      named.length > 0
        ? named[0]
        : declarations.length === 1
          ? declarations[0]
          : undefined;
    if (chosen)
      return {
        kind: chosen.kind === "Workflow" ? "workflow" : "process",
        component: chosen.name?.name ?? null,
        typed: chosen.typed,
      };
  }
  return {
    kind: registryKind(registry.kind),
    component: registry.componentName ?? null,
    typed: null,
  };
}
