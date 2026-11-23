// The zip import state behind the New project dialog (F-403, IO-12, UX-61). The worker reads the zip and keeps the stage;
// this holds only the summary it returns. Choosing another file, resetting or unmounting discards the stage, an ignore-list
// edit restages after a short pause, and a reply that a newer request has overtaken is dropped.
import type { ImportSummary } from "@nf-builder/sources";
import { useEffect, useRef, useState } from "react";
import { getEngine } from "../engine/engine-client";
import type { Timer } from "../workspace/autosave";
import {
  DEFAULT_PROJECT_NAME,
  PROJECT_NAME_MAX,
} from "../workspace/project-name";
import type { ImportStageResult, WorkspaceApi } from "../workspace/types";

export const IGNORE_DEBOUNCE_MS = 300;

export type ZipImportState =
  | { readonly status: "empty" }
  | { readonly status: "reading"; readonly name: string }
  | {
      readonly status: "ready";
      readonly name: string;
      readonly id: string;
      readonly summary: ImportSummary;
      /** The text in the box, which may be ahead of the summary while `updating`. */
      readonly ignore: string;
      readonly updating: boolean;
    }
  | {
      readonly status: "refused";
      readonly name: string;
      readonly message: string;
    };

export interface ZipImportView {
  readonly state: ZipImportState;
  choose(file: File | null): void;
  setIgnore(text: string): void;
  reset(): void;
}

export interface ZipImportDeps {
  workspace(): Pick<
    WorkspaceApi,
    "stageZip" | "restageImport" | "discardImport"
  >;
  onChange(state: ZipImportState): void;
  readonly timer?: Timer;
  readonly debounceMs?: number;
}

const EMPTY: ZipImportState = { status: "empty" };
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

/** The default project name for a zip: its file name without `.zip`, at most `PROJECT_NAME_MAX` characters. */
export function zipProjectName(fileName: string): string {
  const base = fileName.replace(/\.zip$/i, "").trim();
  const name = [...base].slice(0, PROJECT_NAME_MAX).join("").trim();
  return name === "" ? DEFAULT_PROJECT_NAME : name;
}

export function createZipImport(deps: ZipImportDeps): ZipImportView {
  const timer: Timer = deps.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const delay = deps.debounceMs ?? IGNORE_DEBOUNCE_MS;
  let state: ZipImportState = EMPTY;
  let choice = 0; // which file the replies belong to
  let request = 0; // which restage is the newest
  let handle: unknown;

  const set = (next: ZipImportState) => {
    state = next;
    view.state = next;
    deps.onChange(next);
  };
  const discard = (id: string) => {
    void deps
      .workspace()
      .discardImport(id)
      .catch(() => undefined);
  };
  const dropStage = () => {
    timer.clear(handle);
    handle = undefined;
    request += 1;
    choice += 1;
    if (state.status === "ready") discard(state.id);
  };

  const restage = () => {
    handle = undefined;
    if (state.status !== "ready") return;
    const { id, ignore } = state;
    const mine = ++request;
    const wanted = choice;
    deps
      .workspace()
      .restageImport(id, ignore)
      .then(
        (result) => result,
        (failure: unknown): ImportStageResult => ({
          ok: false,
          code: "gone",
          message: messageOf(failure),
        }),
      )
      .then((result) => {
        if (mine !== request || wanted !== choice || state.status !== "ready")
          return;
        if (result.ok)
          set({ ...state, summary: result.summary, updating: false });
        else
          set({ status: "refused", name: state.name, message: result.message });
      });
  };

  const view: { state: ZipImportState } & ZipImportView = {
    state,
    choose(file) {
      dropStage();
      if (file === null) return set(EMPTY);
      const name = file.name;
      const mine = choice;
      set({ status: "reading", name });
      deps
        .workspace()
        .stageZip(file, name)
        .then(
          (result) => result,
          (failure: unknown): ImportStageResult => ({
            ok: false,
            code: "damaged",
            message: messageOf(failure),
          }),
        )
        .then((result) => {
          if (mine !== choice) {
            if (result.ok) discard(result.id);
            return;
          }
          set(
            result.ok
              ? {
                  status: "ready",
                  name,
                  id: result.id,
                  summary: result.summary,
                  ignore: result.summary.ignore,
                  updating: false,
                }
              : { status: "refused", name, message: result.message },
          );
        });
    },
    setIgnore(text) {
      if (state.status !== "ready") return;
      timer.clear(handle);
      set({ ...state, ignore: text, updating: true });
      handle = timer.set(restage, delay);
    },
    reset() {
      dropStage();
      if (state.status !== "empty") set(EMPTY);
    },
  };
  return view;
}

/** The hook the dialog uses: one import per mount, whose stage is discarded when the dialog goes. */
export function useZipImport(): ZipImportView {
  const [state, setState] = useState<ZipImportState>(EMPTY);
  const control = useRef<ZipImportView>(undefined);
  control.current ??= createZipImport({
    workspace: getEngine,
    onChange: setState,
  });
  const inner = control.current;
  useEffect(() => () => inner.reset(), [inner]);
  return {
    state,
    choose: (file) => inner.choose(file),
    setIgnore: (text) => inner.setIgnore(text),
    reset: () => inner.reset(),
  };
}
