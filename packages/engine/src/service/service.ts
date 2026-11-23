// The engine service (F-113): one open project, a revision counter, a projector snapshot per revision and a serial
// call queue. Pure and DOM-free, so it runs in a worker or in Node; every result is plain data.
import type {
  Catalogue,
  CommandResult,
  EditCommand,
  FileText,
  PackLints,
  Projection,
  QuickFix,
  TextPatch,
  WorkflowRef,
} from "@nf-builder/lang-core";
import { nodeDetails } from "../details/details";
import { createDiagnoser, type Diagnoser } from "../diagnostics/diagnose";
import { loadLints } from "../diagnostics/lints";
import { applyTextEdits } from "../diagnostics/text-edits";
import {
  applyCommand,
  commit,
  createEditState,
  type EditState,
  patchResult,
  patchSequence,
} from "../edit/apply";
import { PatchError } from "../edit/patches";
import { EMPTY_HISTORY, History, type HistoryLimits } from "../history/history";
import { commandLabel } from "../history/labels";
import {
  type CarryHints,
  carryHints,
  carryLayout,
  EMPTY_LAYOUT,
  formatLayout,
  LAYOUT_PATH,
  type LayoutChange,
  type LayoutDocument,
  type LayoutStatus,
  parseLayout,
  RemovedPositions,
  trackedWorkflows,
  workflowKey,
  workflowPairs,
  workflowPositions,
  writePositions,
} from "../layout";
import { inRange } from "../layout/sidecar";
import type { ModelEvent } from "../model/project";
import { installedPacks } from "../packs";
import { loadPalette } from "../palette";
import { createProjector, type Projector } from "../projection/project";
import { templateList } from "../templates";
import type {
  ApplyOptions,
  ApplyOutcome,
  DiagnosticsResult,
  EngineApi,
  EngineRefusal,
  EngineRefusalCode,
  HistoryOutcome,
  LoadProgress,
  NodeDetailsResult,
  ProjectChange,
  ProjectionResult,
  ProjectSummary,
} from "./types";

export interface EngineServiceOptions {
  /** Called for every parse and model computation, including those of later edits (tests count work with it). */
  readonly trace?: (event: ModelEvent) => void;
  /** Bounds of the undo history; tests inject small ones (F-209). */
  readonly historyLimits?: HistoryLimits;
}

interface Open {
  readonly version: string;
  readonly state: EditState;
  readonly lints: PackLints;
  readonly catalogue: Catalogue;
  readonly history: History;
  /** The revision this project was opened at, or last partly changed at; no fix diagnosed earlier applies (F-309). */
  openedAt: number;
  /** The revision at which each file last changed (F-309). */
  readonly changedAt: Map<string, number>;
  projector?: Projector;
  diagnoser?: Diagnoser;
  /** Projections built at the current revision, by `path#workflow`; dropped whenever the revision moves (F-207). */
  memo: Map<string, Projection | null>;
  /** The sidecar's entries; empty when it is absent, invalid or newer. */
  layout: LayoutDocument;
  layoutStatus: LayoutStatus;
  /** Positions of nodes a change removed, for undo (session only). */
  removed: RemovedPositions;
}

const ABSENT: LayoutStatus = { state: "absent", message: null };
const OK: LayoutStatus = { state: "ok", message: null };

const SIDECAR_REFUSAL =
  "nf-builder keeps .nf-builder/layout.json up to date itself. Move nodes on the canvas instead.";

function readLayout(text: string | null | undefined): {
  layout: LayoutDocument;
  layoutStatus: LayoutStatus;
} {
  if (text === null || text === undefined)
    return { layout: EMPTY_LAYOUT, layoutStatus: ABSENT };
  const parsed = parseLayout(text);
  if (!parsed.ok)
    return {
      layout: EMPTY_LAYOUT,
      layoutStatus: { state: parsed.state, message: parsed.message },
    };
  const { dropped } = parsed;
  return {
    layout: parsed.document,
    layoutStatus:
      dropped === 0
        ? OK
        : {
            state: "ok",
            message:
              dropped === 1
                ? "1 layout entry couldn't be read and was dropped."
                : `${dropped} layout entries couldn't be read and were dropped.`,
          },
  };
}

/** The state of the tracked workflows before a change, taken before `commit` because the projector reads the live model. */
interface BeforeCarry {
  readonly workflows: readonly WorkflowRef[];
  readonly projections: ReadonlyMap<string, Projection>;
  readonly changed: ReadonlySet<string>;
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

  const projectionOf = (
    open: Open,
    path: string,
    workflow: string | null,
  ): Projection | null => {
    const key = workflowKey({ path, name: workflow });
    const known = open.memo.get(key);
    if (known !== undefined) return known;
    const built = projectorOf(open).project(path, workflow);
    open.memo.set(key, built);
    return built;
  };

  /** Projects the workflows with stored entries in the files about to change. Never throws: a failure means no carry. */
  const prepareCarry = (
    open: Open,
    paths: readonly string[],
  ): BeforeCarry | null => {
    if (open.layoutStatus.state === "newer" || paths.includes(LAYOUT_PATH))
      return null;
    try {
      const changedPaths = new Set(paths);
      const tracked = trackedWorkflows(open.layout).filter((t) =>
        changedPaths.has(t.path),
      );
      if (tracked.length === 0) return null;
      const workflows = projectorOf(open).workflows();
      const projections = new Map<string, Projection>();
      for (const t of tracked) {
        const ref = workflows.find(
          (w) => w.path === t.path && w.name === t.workflow && w.modelled,
        );
        const projection = ref && projectionOf(open, t.path, t.workflow);
        if (projection)
          projections.set(
            workflowKey({ path: t.path, name: t.workflow }),
            projection,
          );
      }
      return { workflows, projections, changed: changedPaths };
    } catch {
      return null;
    }
  };

  /** Carries the stored keys across a committed change; returns the sidecar's new text when it changed. */
  const finishCarry = (
    open: Open,
    before: BeforeCarry | null,
    hints: CarryHints,
  ): FileText[] => {
    if (!before) return [];
    try {
      const pairs = workflowPairs(
        before,
        projectorOf(open).workflows(),
        (w) => projectionOf(open, w.path, w.name),
        before.changed,
        hints.renames ?? [],
      );
      const next = carryLayout(open.layout, pairs, hints, open.removed);
      const text = formatLayout(next);
      if (text === formatLayout(open.layout)) return [];
      open.state.model.setFile(LAYOUT_PATH, text);
      open.layout = next;
      return [{ path: LAYOUT_PATH, text }];
    } catch {
      // the worst case is that nodes are placed again
      return [];
    }
  };

  /** The model changed: the revision moves on and everything built from the old model is dropped. */
  const invalidate = (open: Open): void => {
    revision += 1;
    open.projector = undefined;
    open.diagnoser = undefined;
    open.memo = new Map();
  };

  /** Reports a change already written; callers update the history first, so the change carries its new status. */
  const changed = (
    open: Open,
    files: readonly FileText[],
    remodelled: readonly string[],
    before: BeforeCarry | null,
    hints: CarryHints,
  ): ProjectChange => {
    invalidate(open);
    for (const file of files) open.changedAt.set(file.path, revision);
    const sidecar = finishCarry(open, before, hints);
    return {
      revision,
      files: sidecar.length > 0 ? [...files, ...sidecar] : files,
      remodelled:
        sidecar.length > 0 ? [...remodelled, LAYOUT_PATH].sort() : remodelled,
      workflows: projectorOf(open).workflows(),
      history: open.history.status(),
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
        invalidate(open);
        open.openedAt = revision;
        open.history.clear();
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

  const sidecarRefusal = (): EngineRefusal => ({
    ...refusal("invalid", SIDECAR_REFUSAL),
    path: LAYOUT_PATH,
  });

  const accept = (
    open: Open,
    result: Extract<CommandResult, { ok: true }>,
    before: BeforeCarry | null,
    hints: CarryHints,
  ): ApplyOutcome => ({
    ok: true,
    ...changed(open, result.files, commit(open.state, result), before, hints),
    patches: result.patches,
    inverse: result.inverse,
  });

  /** A fix is stale when its file changed after it was diagnosed, or the project was reopened or changed since (F-309). */
  const staleFix = (
    open: Open,
    fix: QuickFix,
    given: number,
  ): EngineRefusal | null => {
    if (given < open.openedAt || given > revision) return stale(given);
    const changedAt = open.changedAt.get(fix.path);
    if (changedAt === undefined || changedAt <= given) return null;
    return refusal(
      "stale",
      `${fix.path} changed after its problems were checked (revision ${given}). Nothing was changed.`,
    );
  };

  /** The accept and record path that `apply` and `applyFix` share; the caller has checked the revision. */
  const run = (
    open: Open,
    command: EditCommand,
    startedChanging: () => void,
    options: ApplyOptions | undefined,
  ): ApplyOutcome => {
    const result = applyCommand(open.state, command);
    if (!result.ok) return { ...result, revision };
    if (result.files.some((f) => f.path === LAYOUT_PATH))
      return sidecarRefusal();
    const before = prepareCarry(
      open,
      result.files.map((f) => f.path),
    );
    startedChanging();
    const hints = carryHints(command);
    open.history.record(
      {
        patches: result.patches,
        inverse: result.inverse,
        renames: hints.renames ?? [],
        deleted: hints.deleted ?? [],
      },
      options?.label ?? commandLabel(command),
      options?.group ?? null,
    );
    return accept(open, result, before, hints);
  };

  /** Undo and redo share everything but the stack they take from. */
  const move = (
    open: Open,
    given: number,
    startedChanging: () => void,
    direction: "undo" | "redo",
  ): HistoryOutcome => {
    const old = stale(given);
    if (old) return old;
    const lists =
      direction === "undo"
        ? open.history.undoLists()
        : open.history.redoLists();
    if (!lists)
      return refusal("no-history", `There is nothing to ${direction}.`);
    let files: readonly FileText[];
    try {
      files = patchSequence(open.state.model, lists);
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      open.history.clear();
      return refusal(
        "internal",
        `${direction === "undo" ? "Undo" : "Redo"} failed (${error.message}). Nothing was changed, and the undo history was cleared.`,
      );
    }
    const hints =
      direction === "undo"
        ? open.history.undoHints()
        : open.history.redoHints();
    const before = prepareCarry(
      open,
      files.map((f) => f.path),
    );
    startedChanging();
    const label =
      direction === "undo" ? open.history.undone() : open.history.redone();
    return {
      ok: true,
      label,
      ...changed(open, files, commit(open.state, { files }), before, hints),
    };
  };

  return {
    palette: (version) => serial(() => loadPalette(version)),
    templates: (version) => serial(() => templateList(version)),

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
          history: new History(options.historyLimits),
          openedAt: revision + 1,
          changedAt: new Map(),
          memo: new Map(),
          removed: new RemovedPositions(),
          ...readLayout(state.model.file(LAYOUT_PATH)?.source.text),
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
          layout: open.layoutStatus,
        };
      }),

    writeFiles: (files) =>
      guarded((open, startedChanging) => {
        const imported = files.filter((f) => f.path === LAYOUT_PATH).at(-1);
        const before = prepareCarry(
          open,
          files.map((f) => f.path),
        );
        startedChanging();
        open.history.clear();
        const touched = new Set<string>();
        for (const file of files) {
          const change =
            file.text === null
              ? open.state.model.deleteFile(file.path)
              : open.state.model.setFile(file.path, file.text);
          for (const p of change.remodelled) touched.add(p);
        }
        if (imported) {
          // a written sidecar replaces the layout; its keys are not carried
          Object.assign(open, readLayout(imported.text));
          open.removed = new RemovedPositions();
        }
        return changed(open, files, [...touched].sort(), before, {});
      }),

    apply: (command, given, applyOptions) =>
      guarded((open, startedChanging): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        return run(open, command, startedChanging, applyOptions);
      }),

    applyFix: (fix, given, applyOptions) =>
      guarded((open, startedChanging): ApplyOutcome => {
        const old = staleFix(open, fix, given);
        if (old) return old;
        const text = open.state.model.file(fix.path)?.source.text;
        if (text === undefined)
          return refusal("not-found", `No file ${fix.path} to fix.`);
        let fixed: string;
        try {
          fixed = applyTextEdits(text, fix.edits);
        } catch (error) {
          if (error instanceof RangeError)
            return refusal("invalid", `${error.message}. Nothing was changed.`);
          throw error;
        }
        return run(
          open,
          { kind: "replaceFileText", path: fix.path, text: fixed },
          startedChanging,
          { ...applyOptions, label: applyOptions?.label ?? fix.title },
        );
      }),

    undo: (given) =>
      guarded((open, startedChanging) =>
        move(open, given, startedChanging, "undo"),
      ),

    redo: (given) =>
      guarded((open, startedChanging) =>
        move(open, given, startedChanging, "redo"),
      ),

    history: () =>
      serial(() => (current ? current.history.status() : EMPTY_HISTORY)),

    applyPatches: (patches, given) =>
      guarded((open, startedChanging): ApplyOutcome => {
        const old = stale(given);
        if (old) return old;
        if (patches.some((p: TextPatch) => p.path === LAYOUT_PATH))
          return sidecarRefusal();
        let result: Extract<CommandResult, { ok: true }>;
        try {
          result = patchResult(open.state.model, patches);
        } catch (error) {
          if (error instanceof PatchError)
            return refusal("invalid", error.message);
          throw error;
        }
        const before = prepareCarry(
          open,
          result.files.map((f) => f.path),
        );
        startedChanging();
        open.history.clear();
        return accept(open, result, before, {});
      }),

    project: (path, workflow) =>
      guarded((open): ProjectionResult => {
        const projection = projectionOf(open, path, workflow);
        return {
          revision,
          projection,
          positions: projection
            ? workflowPositions(
                open.layout,
                path,
                workflow,
                projection.nodes.map((n) => n.id),
              )
            : {},
        };
      }),

    setLayout: (write) =>
      guarded((open, startedChanging): LayoutChange | EngineRefusal => {
        // positions computed before a change may name keys the carry has since moved
        const refused = stale(write.revision);
        if (refused) return refused;
        const projection = projectionOf(open, write.path, write.workflow);
        if (!projection)
          return refusal(
            "not-found",
            `There is no workflow to lay out at ${write.path}.`,
          );
        const ids = new Set(projection.nodes.map((n) => n.id));
        for (const [id, p] of Object.entries(write.positions)) {
          if (!ids.has(id))
            return refusal(
              "invalid",
              `${id} isn't a node of that workflow. Nothing was saved.`,
            );
          if (!inRange(p.x) || !inRange(p.y))
            return refusal(
              "invalid",
              `The position of ${id} isn't a usable number. Nothing was saved.`,
            );
        }
        const nothing = (): LayoutChange => ({
          revision,
          files: [],
          layout: open.layoutStatus,
        });
        if (open.layoutStatus.state === "newer") return nothing();
        const next = writePositions(open.layout, write);
        const text = formatLayout(next);
        const present = open.state.model.file(LAYOUT_PATH)?.source.text;
        if (present === text) {
          open.layout = next;
          return nothing();
        }
        if (present === undefined && Object.keys(next.nodes).length === 0)
          return nothing();
        startedChanging();
        open.state.model.setFile(LAYOUT_PATH, text);
        open.layout = next;
        open.layoutStatus = OK;
        return {
          revision,
          files: [{ path: LAYOUT_PATH, text }],
          layout: OK,
        };
      }),

    diagnostics: () =>
      guarded(
        (open): DiagnosticsResult => ({
          revision,
          diagnostics: diagnoserOf(open).all(),
        }),
      ),

    details: (path, workflow, node) =>
      guarded((open): NodeDetailsResult => {
        const projection = projectorOf(open).project(path, workflow);
        if (projection === null) return { revision, details: null };
        const diagnoser = diagnoserOf(open);
        return {
          revision,
          details: nodeDetails(
            {
              model: open.state.model,
              catalogue: open.catalogue.script,
              projection,
              diagnostics: (p) => diagnoser.file(p),
            },
            node,
          ),
        };
      }),

    readFile: (path) =>
      serial(() => current?.state.model.file(path)?.source.text ?? null),

    close: () =>
      serial(() => {
        current = null;
      }),
  };
}
