// The engine service (F-113): one open project, a revision counter, a projector snapshot per revision and a serial
// call queue. Pure and DOM-free, so it runs in a worker or in Node; every result is plain data.
import type {
  Catalogue,
  CommandResult,
  FileText,
  PackLints,
} from "@nf-builder/lang-core";
import { createDiagnoser, type Diagnoser } from "../diagnostics/diagnose";
import { loadLints } from "../diagnostics/lints";
import {
  applyCommand,
  commit,
  createEditState,
  type EditState,
  patchResult,
} from "../edit/apply";
import { PatchError } from "../edit/patches";
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
  /** Called for every parse and model computation, including those of later edits (tests count work with it). */
  readonly trace?: (event: ModelEvent) => void;
}

interface Open {
  readonly version: string;
  readonly state: EditState;
  readonly lints: PackLints;
  readonly catalogue: Catalogue;
  projector?: Projector;
  diagnoser?: Diagnoser;
}

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
    message: string,
  ): EngineRefusal => ({
    ok: false,
    revision: current ? revision : null,
    code,
    message,
    path: null,
    problems: [],
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

  const diagnoserOf = (open: Open): Diagnoser => {
    if (!open.diagnoser)
      open.diagnoser = createDiagnoser({
        model: open.state.model,
        projector: projectorOf(open),
        catalogue: open.catalogue,
        lints: open.lints,
      });
    return open.diagnoser;
  };

  const changed = (
    open: Open,
    files: readonly FileText[],
    remodelled: readonly string[],
  ): ProjectChange => {
    revision += 1;
    open.projector = undefined;
    open.diagnoser = undefined;
    return {
      revision,
      files,
      remodelled,
      workflows: projectorOf(open).workflows(),
    };
  };

  /**
   * Runs a call that needs the open project; any exception becomes an `internal` refusal. A call marks the point where
   * it starts changing the model; after that point a throw may leave the model partly changed, so the snapshot is
   * dropped and the revision moves on (a caller's older revision is then stale).
   */
  const guarded = <T>(
    fn: (open: Open, startedChanging: () => void) => T,
  ): Promise<T | EngineRefusal> =>
    serial(() => {
      if (!current) return refusal("no-project", "No project is open.");
      const open = current;
      let changing = false;
      try {
        return fn(open, () => {
          changing = true;
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!changing)
          return refusal(
            "internal",
            `The engine failed unexpectedly (${reason}). Nothing was changed.`,
          );
        revision += 1;
        open.projector = undefined;
        open.diagnoser = undefined;
        return refusal(
          "internal",
          `The engine failed unexpectedly while changing the project (${reason}). The project may be partly changed; use the new revision and check its files.`,
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
    startedChanging: () => void,
  ): ApplyOutcome => {
    startedChanging();
    const remodelled = commit(open.state, result);
    return {
      ok: true,
      ...changed(open, result.files, remodelled),
      patches: result.patches,
      inverse: result.inverse,
    };
  };

  return {
    palette: (version) => serial(() => loadPalette(version)),

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
        const lints = await loadLints(request.version);
        const pack = installedPacks.find((p) => p.version === request.version);
        const catalogue = await pack?.loadCatalogue();
        if (!catalogue) throw new Error(`No pack for ${request.version}`);
        const open: Open = {
          version: request.version,
          state,
          lints,
          catalogue,
        };
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
      guarded((open, startedChanging) => {
        startedChanging();
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

    apply: (command, given) =>
      guarded((open, startedChanging): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        const result = applyCommand(open.state, command);
        return result.ok
          ? accept(open, result, startedChanging)
          : { ...result, revision };
      }),

    applyPatches: (patches, given) =>
      guarded((open, startedChanging): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        let result: Extract<CommandResult, { ok: true }>;
        try {
          result = patchResult(open.state.model, patches);
        } catch (error) {
          if (error instanceof PatchError)
            return refusal("invalid", error.message);
          throw error;
        }
        return accept(open, result, startedChanging);
      }),

    project: (path, workflow) =>
      guarded(
        (open): ProjectionResult => ({
          revision,
          projection: projectorOf(open).project(path, workflow),
        }),
      ),

    diagnostics: () =>
      guarded(
        (open): DiagnosticsResult => ({
          revision,
          diagnostics: diagnoserOf(open).all(),
        }),
      ),
  };
}
