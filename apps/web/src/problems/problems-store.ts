// The problems store (F-309, AR-30): the UI's read-only copy of the project's diagnostics, pulled once per revision, and
// the problems panel's session-only state. Diagnostics are plain data (messages, ranges, codes and fix edits of a few
// characters), never file text. The engine is injected so tests use a fake.
import {
  type ApplyOutcome,
  type Diagnostic,
  type EngineApi,
  type ProblemSections,
  type ProblemsView,
  problemKey,
  problemSections,
  problemsView,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  canvasStore,
  type WorkspaceActions,
  type WorkspaceState,
} from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";

export type DiagnosticsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "refreshing"
  | "failed";

export interface ProblemsState {
  readonly status: DiagnosticsStatus;
  /** The revision the diagnostics were made at. */
  readonly revision: number | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly sections: ProblemSections;
  readonly message: string | null;
  /** The panel is open (session only: no stored format). */
  readonly open: boolean;
  readonly view: ProblemsView;
  /** The key of the problem to focus when the panel opens. */
  readonly focus: string | null;
  /** The key of the problem whose fix is being applied. */
  readonly applying: string | null;
  readonly notice: string | null;
}

export interface ProblemsActions {
  refresh(): Promise<void>;
  show(view: ProblemsView, focus?: string | null): void;
  /** Opens the panel on `view`, or closes it when it is already open there. */
  toggle(view: ProblemsView): void;
  close(): void;
  /** Activates a problem. */
  goTo(d: Diagnostic): Promise<void>;
  /** Applies the problem's quick fix as one undo step; null when it has none or no diagnostics are held. */
  applyFix(d: Diagnostic): Promise<ApplyOutcome | null>;
}

const NONE = problemSections([]);

const INITIAL: ProblemsState = {
  status: "idle",
  revision: null,
  diagnostics: [],
  sections: NONE,
  message: null,
  open: false,
  view: "problems",
  focus: null,
  applying: null,
  notice: null,
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createProblemsStore(options: {
  engine: () => EngineApi;
  workspace: StoreApi<WorkspaceState & WorkspaceActions>;
  /** Defers a pull by one macrotask, so the canvas store's projection request reaches the worker first. */
  schedule?: (fn: () => void) => void;
}): StoreApi<ProblemsState & ProblemsActions> {
  const { engine, workspace } = options;
  const schedule = options.schedule ?? ((fn) => void setTimeout(fn, 0));
  const store = createStore<ProblemsState & ProblemsActions>()((set, get) => {
    let inFlight = false;
    let again = false;

    async function pull(): Promise<void> {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          const { summary, session } = workspace.getState();
          if (summary === null) break;
          let next: Partial<ProblemsState>;
          try {
            const result = await engine().diagnostics();
            if ("ok" in result) next = failure(result.message);
            else {
              const now = workspace.getState();
              // a result for another project or revision is dropped: the change that moved on pulls again
              if (
                now.session !== session ||
                now.summary?.revision !== result.revision
              )
                continue;
              next = {
                status: "ready",
                revision: result.revision,
                diagnostics: result.diagnostics,
                sections: problemSections(result.diagnostics),
                message: null,
              };
            }
          } catch (error) {
            next = failure(messageOf(error));
          }
          if (workspace.getState().session !== session) continue;
          set(next);
        } while (again);
      } finally {
        inFlight = false;
      }
    }

    const failure = (message: string): Partial<ProblemsState> => ({
      status: "failed",
      message,
    });

    let shown: { session: number; revision: number | null } = {
      session: -1,
      revision: null,
    };
    const follow = (state: WorkspaceState): void => {
      const revision = state.summary?.revision ?? null;
      if (state.session === shown.session && revision === shown.revision)
        return;
      const sessionChanged = state.session !== shown.session;
      shown = { session: state.session, revision };
      if (revision === null) {
        set({ ...INITIAL, view: get().view });
        return;
      }
      if (sessionChanged)
        set({ ...INITIAL, view: get().view, status: "loading" });
      else if (get().status === "ready") set({ status: "refreshing" });
      schedule(() => void pull());
    };
    // the first state comes after the initialiser returns
    queueMicrotask(() => {
      workspace.subscribe(follow);
      follow(workspace.getState());
    });

    return {
      ...INITIAL,

      refresh: pull,

      show(view, focus = null) {
        set({ open: true, view, focus });
      },

      toggle(view) {
        const { open, view: current } = get();
        if (open && current === view) get().close();
        else get().show(view);
      },

      close() {
        set({ open: false, focus: null });
      },

      // navigation arrives with F-309 task 6; until then a problem opens its own tab
      async goTo(d) {
        get().show(problemsView(d), problemKey(d));
      },

      async applyFix(d) {
        const { revision } = get();
        if (d.fix === undefined || revision === null) return null;
        const mine = workspace.getState().session;
        set({ applying: problemKey(d), notice: null });
        try {
          const outcome = await workspace
            .getState()
            .applyFix(d.fix, revision, mine);
          set({
            notice: outcome.ok ? `Applied: ${d.fix.title}` : outcome.message,
          });
          // no retry: the file changed, so the user decides again on fresh problems
          if (!outcome.ok) void get().refresh();
          return outcome;
        } finally {
          set({ applying: null });
        }
      },
    };
  });
  return store;
}

export const problemsStore = createProblemsStore({
  engine: getEngine,
  workspace: canvasStore,
});

export function useProblems<T>(
  selector: (state: ProblemsState & ProblemsActions) => T,
): T {
  return useStore(problemsStore, selector);
}
