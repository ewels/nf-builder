import type { CommandResult, EditCommand } from "@nf-builder/lang-core";
import { applyCommand, commit, createEditState } from "../../src/edit/apply";
import { installedPackVersions } from "../../src/packs";

export const version = installedPackVersions()[0] as string;

export const stateFor = (files: Record<string, string>) =>
  createEditState(
    version,
    Object.entries(files).map(([path, text]) => ({ path, text })),
  );

export type Ok = Extract<CommandResult, { ok: true }>;
export type Refused = Extract<CommandResult, { ok: false }>;

export function accepted(
  state: Awaited<ReturnType<typeof stateFor>>,
  command: EditCommand,
): Ok {
  const result = applyCommand(state, command);
  if (!result.ok) throw new Error(`refused: ${result.code}: ${result.message}`);
  return result;
}

export function refused(
  state: Awaited<ReturnType<typeof stateFor>>,
  command: EditCommand,
): Refused {
  const result = applyCommand(state, command);
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

export const texts = (state: Awaited<ReturnType<typeof stateFor>>) =>
  Object.fromEntries(
    state.model.paths().map((p) => [p, state.model.file(p)?.source.text ?? ""]),
  );

export { commit };

import type { GraphNode, PortRef, Projection } from "@nf-builder/lang-core";
import { createProjector } from "../../src/projection/project";

type State = Awaited<ReturnType<typeof stateFor>>;

export function projection(
  state: State,
  path = "main.nf",
  workflow: string | null = null,
): Projection {
  const p = createProjector(state.model, state.catalogue).project(
    path,
    workflow,
  );
  if (!p) throw new Error(`no projection for ${path}`);
  return p;
}

/** The node whose id ends with `suffix` (ids are `<path>#<workflow>/<local>`). */
export function node(
  state: State,
  local: string,
  path = "main.nf",
  workflow: string | null = null,
): GraphNode {
  const found = projection(state, path, workflow).nodes.find((n) =>
    n.id.endsWith(`/${local}`),
  );
  if (!found) throw new Error(`no node ${local}`);
  return found;
}

export const port = (
  state: State,
  local: string,
  portId: string,
  path = "main.nf",
  workflow: string | null = null,
): PortRef => ({ node: node(state, local, path, workflow).id, port: portId });
