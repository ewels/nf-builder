import type { ScriptCatalogue } from "@nf-builder/lang-core";
import type { ProjectModel } from "../model/project";
import { builtinNames, moduleDirectory, subworkflowDirectory } from "./names";

export interface FreshNameRequest {
  readonly kind: "process" | "workflow";
  readonly caller: string;
}

/** Default names of a definition added from the palette (F-301); a number follows when they are taken. */
export const NEW_NAME_BASE: Record<FreshNameRequest["kind"], string> = {
  process: "NEW_PROCESS",
  workflow: "NEW_WORKFLOW",
};

/** The file `CreateProcess` or `CreateWorkflow` writes for `name`. */
export const definitionPath = (
  kind: FreshNameRequest["kind"],
  name: string,
): string =>
  `${(kind === "process" ? moduleDirectory : subworkflowDirectory)(name)}/main.nf`;

/**
 * A name `CreateProcess` or `CreateWorkflow` accepts: not in the caller's scope, not a builtin, and its lower-cased
 * directory holds nothing (so a differently-cased sibling doesn't count as free).
 */
export function freshDefinitionName(
  model: ProjectModel,
  catalogue: ScriptCatalogue,
  request: FreshNameRequest,
): string {
  const builtins = builtinNames(catalogue);
  const paths = model.paths().map((p) => p.toLowerCase());
  const isTaken = (name: string) =>
    builtins.has(name) ||
    model.lookup(request.caller, name) !== undefined ||
    paths.some((p) =>
      p.startsWith(
        definitionPath(request.kind, name).slice(0, -"main.nf".length),
      ),
    );
  const base = NEW_NAME_BASE[request.kind];
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) if (!isTaken(`${base}_${n}`)) return `${base}_${n}`;
}
