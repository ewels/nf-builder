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
