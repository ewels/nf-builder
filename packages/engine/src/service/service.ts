// The engine service (F-113): one open project, a revision counter, a projector snapshot per revision and a serial
// call queue. Pure and DOM-free, so it runs in a worker or in Node; every result is plain data.
import type {
  CommandResult,
  EditCommand,
  FileText,
  LanguagePack,
  ParseProblem,
  TextPatch,
} from "@nf-builder/lang-core";
import {
  applyCommand,
  commit,
  createEditState,
  type EditState,
} from "../edit/apply";
import { applyPatches, PatchError } from "../edit/patches";
import type { ModelEvent } from "../model/project";
import { installedPacks } from "../packs";
import { loadPalette } from "../palette";
import { createProjector, type Projector } from "../projection/project";
import type {
  ApplyOutcome,
  DiagnosticsResult,
  EngineApi,
  EngineRefusal,
  EngineRefusalCode,
  LoadProgress,
  ProjectChange,
  ProjectionResult,
  ProjectSummary,
} from "./types";

export interface EngineServiceOptions {
  /** The packs `palette` reads; defaults to the installed ones. */
  readonly packs?: readonly LanguagePack[];
  /** Called for every parse and model computation, including those of later edits (tests count work with it). */
  readonly trace?: (event: ModelEvent) => void;
}

interface Open {
  readonly version: string;
  readonly state: EditState;
  projector?: Projector;
  diagnostics?: DiagnosticsResult["diagnostics"];
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createEngineService(
  options: EngineServiceOptions = {},
): EngineApi {
  let current: Open | null = null;
  let revision = 0;
  let tail: Promise<unknown> = Promise.resolve();

  /** Runs `fn` after every earlier call has settled. */
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };

  const refusal = (
    code: EngineRefusalCode,
    text: string,
    path: string | null = null,
    problems: readonly ParseProblem[] = [],
  ): EngineRefusal => ({
    ok: false,
    revision: current ? revision : null,
    code,
    message: text,
    path,
    problems,
  });

  const projectorOf = (open: Open): Projector => {
    if (!open.projector) {
      const pack = installedPacks.find((p) => p.version === open.version);
      open.projector = createProjector(open.state.model, open.state.catalogue, {
        legacyOperators: pack?.legacyOperators,
      });
    }
    return open.projector;
  };

  const changed = (
    open: Open,
    files: readonly FileText[],
    remodelled: readonly string[],
  ): ProjectChange => {
    revision += 1;
    open.projector = undefined;
    open.diagnostics = undefined;
    return {
      revision,
      files,
      remodelled,
      workflows: projectorOf(open).workflows(),
    };
  };

  /** Runs a call that needs the open project; any exception becomes an `internal` refusal (IO-14). */
  const guarded = <T>(
    fn: (open: Open) => T,
  ): Promise<Exclude<T, never> | EngineRefusal> =>
    serial(() => {
      if (!current) return refusal("no-project", "No project is open.");
      try {
        return fn(current);
      } catch (error) {
        return refusal(
          "internal",
          `The engine failed unexpectedly (${message(error)}). Nothing was changed.`,
        );
      }
    });

  const stale = (given: number): EngineRefusal | null =>
    given === revision
      ? null
      : refusal(
          "stale",
          `The project changed (revision ${revision}, not ${given}). Nothing was changed.`,
        );

  const accept = (
    open: Open,
    result: Extract<CommandResult, { ok: true }>,
  ): ApplyOutcome => {
    const remodelled = commit(open.state, result);
    return {
      ok: true,
      ...changed(open, result.files, remodelled),
      patches: result.patches,
      inverse: result.inverse,
    };
  };

  return {
    palette: (version) => serial(() => loadPalette(version, options.packs)),

    open: (request, onProgress) =>
      serial(async (): Promise<ProjectSummary> => {
        const total = request.files.length;
        let live = onProgress;
        const emit = (p: LoadProgress) => live?.(p);
        let parsed = 0;
        let modelling = false;
        emit({ phase: "loading", done: 0, total, path: null });
        const state = await createEditState(request.version, request.files, {
          trace: (event) => {
            options.trace?.(event);
            if (event.kind === "parse") {
              parsed += 1;
              emit({ phase: "parsing", done: parsed, total, path: event.path });
            } else if (!modelling) {
              modelling = true;
              emit({ phase: "modelling", done: total, total, path: null });
            }
          },
        });
        // progress is advisory and covers the open only; later edits trace through the same hook
        live = undefined;
        const open: Open = { version: request.version, state };
        current = open;
        revision += 1;
        const files = state.model.paths().flatMap((path) => {
          const source = state.model.file(path)?.source;
          return source
            ? [
                {
                  path,
                  language: source.language,
                  status: source.status,
                  problems: source.problems.length,
                },
              ]
            : [];
        });
        return {
          revision,
          version: request.version,
          files,
          workflows: projectorOf(open).workflows(),
        };
      }),

    writeFiles: (files) =>
      guarded((open) => {
        const touched = new Set<string>();
        for (const file of files) {
          const change =
            file.text === null
              ? open.state.model.deleteFile(file.path)
              : open.state.model.setFile(file.path, file.text);
          for (const p of change.remodelled) touched.add(p);
        }
        return changed(open, files, [...touched].sort());
      }),

    apply: (command: EditCommand, given) =>
      guarded((open): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        const result = applyCommand(open.state, command);
        if (!result.ok)
          return refusal(
            result.code,
            result.message,
            result.path,
            result.problems,
          );
        return accept(open, result);
      }),

    applyPatches: (patches: readonly TextPatch[], given) =>
      guarded((open): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        const before = new Map<string, string>();
        for (const patch of patches) {
          const text = open.state.model.file(patch.path)?.source.text;
          if (text !== undefined) before.set(patch.path, text);
        }
        let applied: ReturnType<typeof applyPatches>;
        try {
          applied = applyPatches(before, patches);
        } catch (error) {
          if (error instanceof PatchError)
            return refusal("invalid", error.message);
          throw error;
        }
        const files: FileText[] = patches.map((p) => ({
          path: p.path,
          text:
            p.kind === "delete" ? null : (applied.files.get(p.path) as string),
        }));
        return accept(open, {
          ok: true,
          patches,
          inverse: applied.inverse,
          files,
        });
      }),

    project: (path, workflow) =>
      guarded(
        (open): ProjectionResult => ({
          revision,
          projection: projectorOf(open).project(path, workflow),
        }),
      ),

    diagnostics: () =>
      guarded((open): DiagnosticsResult => {
        open.diagnostics ??= open.state.model.diagnostics();
        return { revision, diagnostics: open.diagnostics };
      }),
  };
}
