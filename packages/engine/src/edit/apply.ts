// Applying one command to a project model (AR-20, AR-23, AR-24, LA-13, F-111). Pure: it reads the model and returns text
// patches, their inverse and the new text of each changed file; `commit` writes a result into the model.
import type {
  CommandResult,
  EditCommand,
  FileText,
  Scaffold,
  ScriptCatalogue,
  SourceParser,
  TextPatch,
} from "@nf-builder/lang-core";
import {
  openProject,
  type ProjectFile,
  type ProjectModel,
  type ProjectModelOptions,
} from "../model/project";
import { installedPacks } from "../packs";
import { loadParser } from "../source/parser";
import { addCall } from "./commands/add-call";
import { connect, disconnect } from "./commands/connect";
import { createProcess, createWorkflow } from "./commands/create-definition";
import { createFile } from "./commands/create-file";
import { deleteNode } from "./commands/delete-node";
import { renameDeclaration } from "./commands/rename";
import { replaceFileText } from "./commands/replace-file-text";
import { checkResult } from "./guards";
import { applyPatches } from "./patches";
import { EditRefusal } from "./refusal";

export interface EditState {
  readonly model: ProjectModel;
  readonly parser: SourceParser;
  readonly catalogue: ScriptCatalogue;
  readonly scaffold: Scaffold;
}

/** Opens the project with the installed pack for `version`; `trace` is passed to `openProject` (F-113). */
export async function createEditState(
  version: string,
  files: Iterable<ProjectFile>,
  options: Pick<ProjectModelOptions, "trace"> = {},
): Promise<EditState> {
  const pack = installedPacks.find((p) => p.version === version);
  if (!pack) throw new Error(`No language pack for ${version}`);
  const [model, parser, catalogue] = await Promise.all([
    openProject(version, files, options),
    loadParser(version),
    pack.loadCatalogue(),
  ]);
  return {
    model,
    parser,
    catalogue: catalogue.script,
    scaffold: pack.scaffold,
  };
}

const build = (state: EditState, command: EditCommand): TextPatch[] => {
  switch (command.kind) {
    case "createProcess":
      return createProcess(state, command);
    case "createWorkflow":
      return createWorkflow(state, command);
    case "addCall":
      return addCall(state, command);
    case "replaceFileText":
      return replaceFileText(state, command);
    case "renameDeclaration":
      return renameDeclaration(state, command);
    case "connect":
      return connect(state, command);
    case "disconnect":
      return disconnect(state, command);
    case "deleteNode":
      return deleteNode(state, command);
    case "createFile":
      return createFile(state, command);
    default:
      throw new EditRefusal(
        "invalid",
        `Unknown command ${JSON.stringify((command as { kind?: unknown }).kind)}.`,
      );
  }
};

/** Never throws: a refusal, or an error inside a command, comes back as `ok: false`. */
export function applyCommand(
  state: EditState,
  command: EditCommand,
): CommandResult {
  try {
    const result = patchResult(state.model, build(state, command));
    checkResult((p) => state.model.file(p)?.source, result.files, state.parser);
    return result;
  } catch (error) {
    if (error instanceof EditRefusal)
      return {
        ok: false,
        code: error.code,
        message: error.message,
        path: error.path,
        problems: error.problems,
      };
    return {
      ok: false,
      code: "internal",
      message: `The edit failed unexpectedly (${error instanceof Error ? error.message : String(error)}). Nothing was changed.`,
      path: null,
      problems: [],
    };
  }
}

/** Applies `patches` to the model's current texts without writing them; throws `PatchError` when they don't apply. */
export function patchResult(
  model: ProjectModel,
  patches: readonly TextPatch[],
): Extract<CommandResult, { ok: true }> {
  const current = new Map<string, string>();
  for (const { path } of patches) {
    const text = model.file(path)?.source.text;
    if (text !== undefined) current.set(path, text);
  }
  const applied = applyPatches(current, patches);
  const files: FileText[] = patches.map((p) => ({
    path: p.path,
    text: p.kind === "delete" ? null : (applied.files.get(p.path) as string),
  }));
  return { ok: true, patches, inverse: applied.inverse, files };
}

/** Writes an accepted result into the model; returns the files the model recomputed, sorted. */
export function commit(
  state: EditState,
  result: { readonly files: readonly FileText[] },
): readonly string[] {
  const touched = new Set<string>();
  for (const file of result.files) {
    if (file.text === null) continue;
    for (const p of state.model.setFile(file.path, file.text).remodelled)
      touched.add(p);
  }
  for (const file of result.files) {
    if (file.text !== null) continue;
    for (const p of state.model.deleteFile(file.path).remodelled)
      touched.add(p);
  }
  return [...touched].sort();
}

/**
 * Applies patch lists in order to copies of the model's current texts, without writing them (F-209). Returns the final
 * text of each touched path, null when deleted; a path absent before and after is omitted. Throws `PatchError` before
 * anything is written. A step of several commands is a sequence because one list may patch a path only once.
 */
export function patchSequence(
  model: ProjectModel,
  lists: readonly (readonly TextPatch[])[],
): readonly FileText[] {
  const working = new Map<string, string | null>();
  const textOf = (path: string): string | null | undefined =>
    working.has(path) ? working.get(path) : model.file(path)?.source.text;
  for (const list of lists) {
    const current = new Map<string, string>();
    for (const { path } of list) {
      const text = textOf(path);
      if (typeof text === "string") current.set(path, text);
    }
    const applied = applyPatches(current, list);
    for (const { path } of list)
      working.set(path, applied.files.get(path) ?? null);
  }
  const files: FileText[] = [];
  for (const [path, text] of working)
    if (text !== null || model.file(path) !== undefined)
      files.push({ path, text });
  return files;
}
