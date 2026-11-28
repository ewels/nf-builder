// The edit popup's pending state (F-303, UX-40, UX-44, AR-30): the form read from the engine, the user's draft of it, and
// Apply, which sends one command (or one group) through the canvas store. Nothing reaches the project until Apply.
import {
  type EngineApi,
  type FieldProblem,
  type FormChoices,
  formChanged,
  isIdentifier,
  type TypedProcessForm,
} from "@nf-builder/engine";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  type CanvasStore,
  canvasStore,
  type DeclarationEdit,
} from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { isReadOnly } from "../read-only/read-only-store";

export interface PopupRequest {
  /** The workflow tab the node is on. */
  readonly tab: string;
  readonly node: string;
  /** What had the focus; it gets it back when the popup closes. */
  readonly opener: HTMLElement | null;
}

interface Opened {
  readonly opener: HTMLElement | null;
  readonly tab: string;
  readonly node: string;
  readonly target: { readonly path: string; readonly name: string };
  /** The revision the form was read at. */
  readonly revision: number;
  readonly original: TypedProcessForm;
  readonly draft: TypedProcessForm;
  readonly choices: FormChoices;
  /** Why the last Apply was refused, for the live region. */
  readonly message: string | null;
  /** The fields the refusal is about. */
  readonly fields: readonly FieldProblem[];
}

export type PopupData =
  | { readonly status: "closed" }
  | ({ readonly status: "loading" } & Pick<Opened, "opener" | "tab" | "node">)
  | ({ readonly status: "editing" | "applying" } & Opened);

export interface PopupActions {
  /** Reads the form of a node and shows the popup; nothing in read-only (F-703), and a refusal leaves it closed with `refusal` set. */
  openPopup(request: PopupRequest): Promise<void>;
  updateDraft(change: (draft: TypedProcessForm) => TypedProcessForm): void;
  /** Validates the draft and applies it; no change closes without a step. A refusal keeps the popup open. */
  applyPopup(): Promise<void>;
  /** Cancel, Esc and narrowing below 1024 px: closes and discards the draft. */
  closePopup(): void;
}

export type PopupStore = PopupData &
  PopupActions & {
    /** Why the last open was refused; the next open or close clears it. */
    readonly refusal: string | null;
  };

/** The problems the page finds itself: names that aren't identifiers or are used twice, and directives with no value (UX-44). */
export function draftProblems(draft: TypedProcessForm): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const add = (
    section: FieldProblem["field"]["section"],
    row: number | null,
    part: string | null,
    message: string,
  ) => problems.push({ field: { section, row, part }, message });
  const invalid = (what: string, name: string) =>
    `${what} "${name}" isn't a valid name. Use letters, digits and underscores, and don't start with a digit.`;
  if (!isIdentifier(draft.name))
    add("name", null, null, invalid("The name", draft.name));
  const inputs = new Set<string>();
  draft.inputs.forEach((row, i) => {
    if (row.kind !== "named") return;
    if (row.name === "")
      add("inputs", i, "name", "Enter a name for the input.");
    else if (!isIdentifier(row.name))
      add("inputs", i, "name", invalid("The input", row.name));
    else if (inputs.has(row.name))
      add("inputs", i, "name", `Another input is already called ${row.name}.`);
    inputs.add(row.name);
  });
  const outputs = new Set<string>();
  draft.outputs.forEach((row, i) => {
    if (row.name === "") return;
    if (!isIdentifier(row.name))
      add("outputs", i, "name", invalid("The output", row.name));
    else if (outputs.has(row.name))
      add(
        "outputs",
        i,
        "name",
        `Another output is already called ${row.name}.`,
      );
    outputs.add(row.name);
  });
  draft.directives.forEach((row, i) => {
    if (row.kind === "named" && row.args.trim() === "")
      add("directives", i, "args", `Enter a value for ${row.name}.`);
  });
  return problems;
}

export function createPopupStore(deps: {
  readonly canvas: CanvasStore;
  readonly engine: () => EngineApi;
  readonly readOnly: () => boolean;
}): StoreApi<PopupStore> {
  return createStore<PopupStore>()((set, get) => {
    // a result for a popup that was closed or opened again meanwhile is dropped
    let generation = 0;
    const opened = () => {
      const s = get();
      return s.status === "editing" ? s : null;
    };
    return {
      status: "closed",
      refusal: null,

      async openPopup(request) {
        if (deps.readOnly()) return;
        const mine = ++generation;
        const { canvas } = deps;
        const tab = canvas.getState().tabs.find((t) => t.id === request.tab);
        if (tab === undefined || tab.kind !== "workflow") return;
        set({
          status: "loading",
          refusal: null,
          opener: request.opener,
          tab: request.tab,
          node: request.node,
        });
        let result: Awaited<ReturnType<EngineApi["declarationForm"]>>;
        try {
          result = await deps
            .engine()
            .declarationForm(tab.path, tab.workflow, request.node);
        } catch (error) {
          result = {
            ok: false,
            revision: null,
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
            path: null,
            problems: [],
          };
        }
        if (mine !== generation) return;
        if ("ok" in result) {
          set({ status: "closed", refusal: result.message });
          return;
        }
        if (result.form.kind !== "typedProcess") {
          set({ status: "closed", refusal: "Nothing to edit here yet." });
          return;
        }
        set({
          status: "editing",
          refusal: null,
          opener: request.opener,
          tab: request.tab,
          node: request.node,
          target: result.target,
          revision: result.revision,
          original: result.form,
          draft: result.form,
          choices: result.choices,
          message: null,
          fields: [],
        });
      },

      updateDraft(change) {
        const s = opened();
        if (s === null) return;
        set({ draft: change(s.draft), message: null, fields: [] });
      },

      async applyPopup() {
        const s = opened();
        if (s === null) return;
        if (!formChanged(s.original, s.draft)) {
          generation++;
          set({ status: "closed" });
          return;
        }
        const problems = draftProblems(s.draft);
        if (problems.length > 0) {
          set({
            message: problems[0]?.message ?? null,
            fields: problems,
          });
          return;
        }
        const mine = generation;
        set({ status: "applying" });
        const request: DeclarationEdit = {
          target: s.target,
          revision: s.revision,
          form: s.draft,
          node: s.node,
        };
        const outcome = await deps.canvas.getState().editDeclaration(request);
        if (mine !== generation) return;
        if (outcome.ok) {
          generation++;
          set({ status: "closed" });
          return;
        }
        set({
          status: "editing",
          message: outcome.message,
          fields: outcome.fields,
        });
      },

      closePopup() {
        generation++;
        set({ status: "closed", refusal: null });
      },
    };
  });
}

export const popupStore = createPopupStore({
  canvas: canvasStore,
  engine: getEngine,
  readOnly: isReadOnly,
});

export function usePopup<T>(select: (state: PopupStore) => T): T {
  return useStore(popupStore, select);
}
export const openPopup = (request: PopupRequest): Promise<void> =>
  popupStore.getState().openPopup(request);
export const closePopup = (): void => popupStore.getState().closePopup();
