// Adding files to the open project from the Files view (F-210, UX-16): one zip or some loose files are staged in the
// worker (its text never reaches the page), previewed against the project, and written on confirm. As with the New project
// dialog's zip (F-403), an ignore-list edit previews again after a short pause and a reply a newer request has overtaken
// is dropped.
import type { Timer } from "../workspace/autosave";
import type {
  AddChoice,
  AddPreview,
  AddPreviewResult,
  ImportStageResult,
  WorkspaceApi,
} from "../workspace/types";
import type { DropKind } from "./drop";

const DEBOUNCE_MS = 300;

export const FOLDER_DROP_MESSAGE =
  "Folders can't be dropped. Drop the files in it, or a zip of the folder.";

export type AddFilesState =
  | { readonly status: "idle" }
  | { readonly status: "reading"; readonly name: string }
  | {
      readonly status: "ready";
      readonly name: string;
      readonly zip: boolean;
      readonly preview: AddPreview;
      /** The text in the box, which may be ahead of the preview while `updating`. */
      readonly ignore: string;
      readonly keepFolder: boolean;
      readonly updating: boolean;
      readonly adding: boolean;
    }
  | {
      readonly status: "refused";
      readonly name: string;
      readonly message: string;
    };

export interface AddFilesView {
  readonly state: AddFilesState;
  /** Stages what was dropped or chosen for `folder` ("" is the top of the project) and previews it. */
  start(kind: DropKind, folder: string): void;
  setIgnore(text: string): void;
  setKeepFolder(value: boolean): void;
  /** Writes the files; true when they were added. */
  confirm(): Promise<boolean>;
  /** Drops the stage and closes. */
  cancel(): void;
}

interface AddFilesDeps {
  workspace(): Pick<
    WorkspaceApi,
    "stageZip" | "stageFiles" | "previewAdd" | "addFiles" | "discardImport"
  >;
  /** The project shown now: a stage that finishes in another project is discarded. */
  session(): number;
  onChange(state: AddFilesState): void;
  /** After the files were written: the folder they went to and how many. */
  onAdded(folder: string, count: number): void;
  readonly timer?: Timer;
  readonly debounceMs?: number;
}

const IDLE: AddFilesState = { status: "idle" };
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

/** A file name for the dialog title: the only name, or the first and a count. */
const nameOf = (files: readonly File[]): string => {
  const [first] = files;
  if (first === undefined) return "";
  return files.length === 1
    ? first.name
    : `${first.name} and ${files.length - 1} more`;
};

/** The actions of one add; the state goes to `onChange`. */
export function createAddFiles(
  deps: AddFilesDeps,
): Omit<AddFilesView, "state"> {
  const timer: Timer = deps.timer ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const debounce = deps.debounceMs ?? DEBOUNCE_MS;
  let state: AddFilesState = IDLE;
  let choice = 0; // which drop the replies belong to
  let request = 0; // which preview is the newest
  let handle: unknown;

  const set = (next: AddFilesState) => {
    state = next;
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
    if (state.status === "ready") discard(state.preview.id);
  };
  const choiceOf = (s: AddFilesState & { status: "ready" }): AddChoice => ({
    id: s.preview.id,
    ignore: s.zip ? s.ignore : "",
    keepFolder: s.keepFolder,
    folder: s.preview.folder,
  });

  const preview = () => {
    handle = undefined;
    if (state.status !== "ready") return;
    const mine = ++request;
    const wanted = choice;
    deps
      .workspace()
      .previewAdd(choiceOf(state))
      .catch(
        (failure: unknown): AddPreviewResult => ({
          ok: false,
          code: "gone",
          message: messageOf(failure),
        }),
      )
      .then((result) => {
        if (mine !== request || wanted !== choice || state.status !== "ready")
          return;
        if (result.ok)
          set({
            ...state,
            preview: result,
            // a reply for older text leaves the newer edit pending
            updating: state.zip && state.ignore !== result.summary.ignore,
          });
        else
          set({ status: "refused", name: state.name, message: result.message });
      });
  };
  const edit = (change: Partial<AddFilesState & { status: "ready" }>) => {
    if (state.status !== "ready" || state.adding) return;
    timer.clear(handle);
    set({ ...state, ...change, updating: true });
    handle = timer.set(preview, debounce);
  };

  return {
    start(kind, folder) {
      dropStage();
      if (kind.kind === "none") return set(IDLE);
      if (kind.kind === "folder")
        return set({
          status: "refused",
          name: "",
          message: FOLDER_DROP_MESSAGE,
        });
      const zip = kind.kind === "zip";
      const name = zip ? kind.file.name : nameOf(kind.files);
      const mine = choice;
      const session = deps.session();
      set({ status: "reading", name });
      const fail = (failure: unknown): ImportStageResult => ({
        ok: false,
        code: "damaged",
        message: messageOf(failure),
      });
      const staged: Promise<ImportStageResult> = zip
        ? deps.workspace().stageZip(kind.file, kind.file.name)
        : deps
            .workspace()
            .stageFiles(kind.files.map((f) => ({ blob: f, name: f.name })));
      void staged.catch(fail).then(async (stage) => {
        if (mine !== choice || session !== deps.session()) {
          if (stage.ok) discard(stage.id);
          if (mine === choice) set(IDLE);
          return;
        }
        if (!stage.ok)
          return set({ status: "refused", name, message: stage.message });
        const ignore = zip ? stage.summary.ignore : "";
        const first = await deps
          .workspace()
          .previewAdd({ id: stage.id, ignore, keepFolder: false, folder })
          .catch(
            (failure: unknown): AddPreviewResult => ({
              ok: false,
              code: "gone",
              message: messageOf(failure),
            }),
          );
        if (mine !== choice) {
          discard(stage.id);
          return;
        }
        if (!first.ok) {
          discard(stage.id);
          return set({ status: "refused", name, message: first.message });
        }
        set({
          status: "ready",
          name,
          zip,
          preview: first,
          ignore,
          keepFolder: false,
          updating: false,
          adding: false,
        });
      });
    },
    setIgnore: (text) => edit({ ignore: text }),
    setKeepFolder: (value) => edit({ keepFolder: value }),
    async confirm() {
      if (state.status !== "ready" || state.adding || state.updating)
        return false;
      const { preview: shown } = state;
      if (shown.adds === 0 || shown.summary.ignoreProblems.length > 0)
        return false;
      const mine = choice;
      const ready = state;
      set({ ...ready, adding: true });
      let outcome: Awaited<ReturnType<WorkspaceApi["addFiles"]>>;
      try {
        outcome = await deps.workspace().addFiles(choiceOf(ready));
      } catch (failure) {
        outcome = {
          ok: false,
          revision: null,
          code: "internal",
          message: messageOf(failure),
          path: null,
          problems: [],
        };
      }
      if (mine !== choice) return false;
      if ("ok" in outcome) {
        set({ status: "refused", name: ready.name, message: outcome.message });
        return false;
      }
      set(IDLE);
      deps.onAdded(shown.folder, shown.adds);
      return true;
    },
    cancel() {
      dropStage();
      if (state.status !== "idle") set(IDLE);
    },
  };
}
