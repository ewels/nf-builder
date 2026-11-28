// The edit popup's pending state (F-303, UX-40, UX-44, AR-30): the form read from the engine, the user's draft of it, and
// Apply, which sends one command (or one group) through the canvas store. Nothing reaches the project until Apply.
import {
  type EngineApi,
  type FieldProblem,
  type FormChoices,
  formChanged,
  isIdentifier,
  type ParseProblem,
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
  /** The tab to open on; Configure when absent (F-304). */
  readonly section?: Section;
}

export type Section = "configure" | "code";

/** The Code tab's draft (F-304, UX-43, UX-44). Untouched, the form is the truth; once edited, the text is. */
export interface CodeDraft {
  /** The declaration's text as the project has it. */
  readonly original: string;
  readonly text: string;
  /** Typed or formatted in Code: the text is the truth from then on. */
  readonly touched: boolean;
  /** The form `text` was last rendered from or parsed to; Configure edits are measured against it. */
  readonly baseForm: TypedProcessForm;
  readonly check: "valid" | "checking" | "invalid";
  /** The parse problems of `text`, on its own lines. */
  readonly problems: readonly ParseProblem[];
  readonly message: string | null;
  /** What `text` parsed to, when `check` is valid and the text is touched. */
  readonly parsed: {
    readonly name: string;
    readonly form: TypedProcessForm;
    readonly choices: FormChoices;
  } | null;
}

interface Opened {
  readonly opener: HTMLElement | null;
  readonly tab: string;
  readonly node: string;
  readonly target: { readonly path: string; readonly name: string };
  /** The revision the form was read at. */
  readonly revision: number;
  readonly original: TypedProcessForm;
  readonly section: Section;
  readonly code: CodeDraft;
  /** The file span of the declaration, for Show whole file. */
  readonly span: { readonly start: number; readonly end: number };
  /** Esc was pressed with an edited code draft: asking before it is discarded. */
  readonly discarding: boolean;
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
  /** Esc: closes at once, but asks first when the code draft was edited (F-304; amends ADR 0066). */
  requestClose(): void;
  keepEditing(): void;
  /** Shows a tab. Code to Configure needs code that parses; Configure to Code renders the form's changes into the text. */
  showSection(section: Section): Promise<void>;
  /** The editor's text; the parse check follows after a pause. */
  editCode(text: string): void;
  /** Puts the declaration through the formatter. */
  formatCode(): Promise<void>;
  /** The editor's flush (F-209): runs the pending check now. It applies nothing. */
  flushCode(): Promise<void>;
}

export type PopupStore = PopupData &
  PopupActions & {
    /** Why the last open was refused; the next open or close clears it. */
    readonly refusal: string | null;
  };

/** Whether the Apply button is allowed: not while the code on show doesn't parse (UX-44). */
export function canApply(s: PopupData): boolean {
  if (s.status !== "editing") return false;
  return !(s.section === "code" && s.code.touched && s.code.check !== "valid");
}

/** Whether Esc should ask: the code text was changed from the project's (F-304). */
export function codeEdited(s: PopupData): boolean {
  return (
    (s.status === "editing" || s.status === "applying") &&
    s.code.touched &&
    s.code.text !== s.code.original
  );
}

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
    const CHECK_DELAY_MS = 300;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stopTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const patchCode = (change: Partial<CodeDraft>, rest: object = {}) => {
      const s = opened();
      if (s !== null) set({ ...rest, code: { ...s.code, ...change } });
    };
    /** Parses the text on show; a result for text or a popup that has moved on is dropped. */
    const check = async (): Promise<void> => {
      stopTimer();
      const s = opened();
      if (s === null) return;
      const mine = generation;
      const { text } = s.code;
      let result: Awaited<ReturnType<EngineApi["parseDeclaration"]>>;
      try {
        result = await deps.engine().parseDeclaration({ ...s.target, text });
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
      const now = opened();
      if (mine !== generation || now === null || now.code.text !== text) return;
      if ("ok" in result)
        patchCode({
          check: "invalid",
          problems: result.problems,
          message: result.message,
          parsed: null,
        });
      else
        patchCode({
          check: "valid",
          problems: [],
          message: null,
          parsed: {
            name: result.name,
            form: result.form,
            choices: result.choices,
          },
        });
    };
    /** Renders the Configure draft over the code text, so a form edit made after a code edit isn't lost, and checks it. */
    const renderForm = async (): Promise<boolean> => {
      const s = opened();
      if (s === null) return false;
      const mine = generation;
      const base = s.code.touched ? s.code.text : null;
      const rendered = await deps
        .engine()
        .declarationText({
          ...s.target,
          base,
          form: s.draft,
        })
        .catch(() => null);
      if (mine !== generation || opened() === null) return false;
      if (rendered === null || "ok" in rendered) {
        set({
          message:
            rendered?.message ?? "The form couldn't be turned into code.",
        });
        return false;
      }
      patchCode({
        text: rendered.text,
        baseForm: s.draft,
        check: s.code.touched ? "checking" : "valid",
        problems: [],
        message: null,
        parsed: null,
      });
      if (s.code.touched) await check();
      return true;
    };
    /** Apply when the code text is the truth (F-304, UX-44). */
    const applyCode = async (): Promise<void> => {
      let s = opened();
      if (s === null) return;
      if (s.section === "configure") {
        const problems = draftProblems(s.draft);
        if (problems.length > 0) {
          set({ message: problems[0]?.message ?? null, fields: problems });
          return;
        }
        if (formChanged(s.code.baseForm, s.draft) && !(await renderForm()))
          return;
      } else if (s.code.check === "checking") await check();
      s = opened();
      if (s === null) return;
      const { parsed } = s.code;
      if (s.code.check !== "valid" || parsed === null) {
        set({ message: s.code.message ?? "The code doesn't parse." });
        return;
      }
      if (s.code.text === s.code.original) {
        generation++;
        set({ status: "closed" });
        return;
      }
      const mine = generation;
      set({ status: "applying" });
      const outcome = await deps.canvas.getState().editDeclarationText({
        target: s.target,
        revision: s.revision,
        text: s.code.text,
        name: parsed.name,
        node: s.node,
      });
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
          section: request.section ?? "configure",
          span: result.span,
          discarding: false,
          code: {
            original: result.text,
            text: result.text,
            touched: false,
            baseForm: result.form,
            check: "valid",
            problems: [],
            message: null,
            parsed: null,
          },
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
        if (s.code.touched) return applyCode();
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
        stopTimer();
        set({ status: "closed", refusal: null });
      },

      requestClose() {
        const s = get();
        if (codeEdited(s) && s.status === "editing") set({ discarding: true });
        else get().closePopup();
      },

      keepEditing() {
        if (opened() !== null) set({ discarding: false });
      },

      async showSection(section) {
        const s = opened();
        if (s === null || s.section === section) return;
        if (section === "code") {
          const changed = s.code.touched
            ? formChanged(s.code.baseForm, s.draft)
            : formChanged(s.original, s.draft);
          set({ section, message: null, fields: [] });
          if (changed) await renderForm();
          return;
        }
        if (s.code.touched) {
          if (s.code.check === "checking") await check();
          const now = opened();
          if (now === null) return;
          const { parsed } = now.code;
          if (now.code.check !== "valid" || parsed === null) return;
          set({
            section,
            draft: parsed.form,
            choices: parsed.choices,
            code: { ...now.code, baseForm: parsed.form },
            message: null,
            fields: [],
          });
          return;
        }
        set({ section, message: null, fields: [] });
      },

      editCode(text) {
        const s = opened();
        if (s === null || text === s.code.text) return;
        set({
          code: {
            ...s.code,
            text,
            touched: true,
            check: "checking",
            problems: s.code.problems,
            message: null,
            parsed: null,
          },
          message: null,
          fields: [],
        });
        stopTimer();
        timer = setTimeout(() => void check(), CHECK_DELAY_MS);
      },

      async formatCode() {
        const s = opened();
        if (s === null || s.code.check !== "valid") return;
        const mine = generation;
        const result = await deps
          .engine()
          .formatDeclaration({ ...s.target, text: s.code.text })
          .catch(() => null);
        const now = opened();
        if (mine !== generation || now === null) return;
        if (result === null || "ok" in result) {
          set({
            message: result?.message ?? "The code couldn't be formatted.",
          });
          return;
        }
        if (result.text === now.code.text) return;
        get().editCode(result.text);
        await check();
      },

      async flushCode() {
        const s = opened();
        if (s !== null && s.code.check === "checking") await check();
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
