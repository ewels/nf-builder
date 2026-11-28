import type {
  EngineApi,
  EngineRefusal,
  FieldProblem,
  Projection,
  ProjectionResult,
  TypedProcessForm,
  WorkflowRef,
} from "@nf-builder/engine";
import { EMPTY_HISTORY } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createPopupStore } from "../src/popup/popup-store";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const main: WorkflowRef = {
  path: "main.nf",
  name: null,
  modelled: true,
  typed: true,
  range,
};
const MODULE = "modules/local/greet/main.nf";
const NODE = "main.nf#/greet";
const form: TypedProcessForm = {
  kind: "typedProcess",
  name: "GREET",
  description: "",
  docTags: null,
  inputs: [
    { origin: 0, kind: "named", name: "name", type: "String", nullable: false },
  ],
  stage: [],
  outputs: [{ origin: 0, name: "", type: "", value: "file('x.txt')" }],
  topics: [],
  directives: [],
  script: { label: "script", text: "echo hi" },
  stub: null,
  kept: [],
};
const choices = { directives: [], stage: [], types: ["String"] };
const callNode = (callee: string) => ({
  id: callee === "GREET" ? NODE : `main.nf#/${callee}@1`,
  kind: "call",
  label: callee,
  callee: {
    status: "resolved",
    name: callee,
    path: MODULE,
    typed: true,
    kind: "process",
  },
  inputs: [],
  outputs: [],
});
const change = (revision: number) => ({
  ok: true,
  revision,
  files: [{ path: "main.nf", text: "x" }],
  remodelled: ["main.nf"],
  workflows: [main],
  history: { undo: "Edit process", redo: null, undoCount: 1, redoCount: 0 },
});

interface Options {
  /** Command kinds the engine refuses. */
  refuse?: string[];
  fields?: FieldProblem[];
  /** The declarations the outline reports for the process's file. */
  outline?: string[];
  formRevision?: number;
}

function setup(options: Options = {}) {
  const log: string[] = [];
  const applies: { command: { kind: string }; options: unknown }[] = [];
  const undos: unknown[] = [];
  let revision = 1;
  let renamed: string | null = null;
  const engine = {
    open: async () => ({
      revision,
      version: "26.10",
      files: [],
      workflows: [main],
      layout: { state: "absent", message: null },
    }),
    project: async (): Promise<ProjectionResult> => ({
      revision,
      projection: {
        workflow: main,
        nodes: [callNode(renamed ?? "GREET")],
        edges: [],
        statements: [],
      } as unknown as Projection,
      positions: {},
    }),
    declarationForm: async (_p: string, _w: string | null, node: string) => {
      log.push(`form:${node}`);
      return {
        revision: options.formRevision ?? revision,
        target: { path: MODULE, name: "GREET" },
        form,
        choices,
      };
    },
    outline: async () => ({
      revision,
      items: [
        { kind: "featureFlag", name: "nextflow.enable.types" },
        ...(options.outline ?? ["GREET"]).map((name) => ({
          kind: "process",
          name,
        })),
      ],
    }),
    apply: async (
      command: { kind: string; newName?: string },
      rev: number,
      applyOptions: unknown,
    ) => {
      log.push(`${command.kind}@${rev}`);
      applies.push({ command, options: applyOptions });
      if (options.refuse?.includes(command.kind))
        return {
          ok: false,
          revision: rev,
          code: "invalid",
          message: `No ${command.kind}.`,
          path: MODULE,
          problems: [],
          fields: options.fields,
        } satisfies EngineRefusal;
      revision = rev + 1;
      if (command.kind === "renameDeclaration")
        renamed = command.newName ?? null;
      return change(revision);
    },
    undo: async (rev: number, undoOptions?: unknown) => {
      log.push(`undo@${rev}`);
      undos.push(undoOptions);
      revision = rev + 1;
      renamed = null;
      return change(revision);
    },
    history: async () => EMPTY_HISTORY,
    details: async (_p: string, _w: string | null, node: string) => ({
      revision,
      details: { node, diagnostics: [] },
    }),
    readFile: async () => null,
  } as unknown as EngineApi;
  return {
    engine,
    log,
    applies,
    undos,
    bump: () => {
      revision += 1;
    },
  };
}

async function opened(options: Options = {}, readOnly = false) {
  const made = setup(options);
  const canvas = createCanvasStore(
    () => made.engine,
    () => readOnly,
  );
  await canvas.getState().open({ version: "26.10", files: [] });
  const popup = createPopupStore({
    canvas,
    engine: () => made.engine,
    readOnly: () => readOnly,
  });
  const request = { tab: "main.nf#", node: NODE, opener: null };
  return { ...made, canvas, popup, request };
}

const draft = (
  popup: Awaited<ReturnType<typeof opened>>["popup"],
  change: (d: TypedProcessForm) => TypedProcessForm,
) => popup.getState().updateDraft(change);

describe("F-303 popup store", () => {
  it("F-303 UX-40: openPopup reads the form of the node and shows it for editing", async () => {
    const { popup, request, log } = await opened();
    await popup.getState().openPopup(request);
    const s = popup.getState();
    expect(log).toContain(`form:${NODE}`);
    expect(s.status).toBe("editing");
    if (s.status !== "editing") return;
    expect(s.target).toEqual({ path: MODULE, name: "GREET" });
    expect(s.draft).toEqual(form);
    expect(s.choices.types).toEqual(["String"]);
  });

  it("F-303 UX-44 F-209: Apply sends one updateDeclaration labelled Edit process GREET when the name is unchanged", async () => {
    const { popup, request, applies, canvas } = await opened();
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, description: "Says hello." }));
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual(["updateDeclaration"]);
    expect(popup.getState().status).toBe("closed");
    expect(canvas.getState().selected).toBe(NODE);
  });

  it("F-303 UX-44 F-209: Apply with a new name sends update, rename and the folder move under one group with one label", async () => {
    const { popup, request, applies } = await opened();
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, name: "SAY" }));
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual([
      "updateDeclaration",
      "renameDeclaration",
      "moveFile",
    ]);
    expect(applies[1]?.command).toMatchObject({
      path: MODULE,
      name: "GREET",
      newName: "SAY",
    });
    expect(applies[2]?.command).toEqual({
      kind: "moveFile",
      path: "modules/local/greet",
      newPath: "modules/local/say",
    });
    const groups = applies.map((a) => (a.options as { group: string }).group);
    expect(groups[0]).toMatch(/^popup-/);
    expect(new Set(groups).size).toBe(1);
    // every part carries the label: a part with no patches starts no step
    for (const a of applies)
      expect(a.options).toMatchObject({ label: "Edit process SAY" });
    expect(popup.getState().status).toBe("closed");
  });

  it("F-303 point 5: the folder isn't moved when the file declares more than the process, or sits elsewhere", async () => {
    const { popup, request, applies } = await opened({
      outline: ["GREET", "OTHER"],
    });
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, name: "SAY" }));
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual([
      "updateDeclaration",
      "renameDeclaration",
    ]);
  });

  it("F-303 UX-44: a refused rename is undone with discard, and the popup stays open with the message", async () => {
    const { popup, request, undos, log } = await opened({
      refuse: ["renameDeclaration"],
    });
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, name: "SAY" }));
    await popup.getState().applyPopup();
    expect(log.filter((l) => l.startsWith("undo"))).toHaveLength(1);
    expect(undos).toEqual([{ discard: true }]);
    const s = popup.getState();
    expect(s.status).toBe("editing");
    if (s.status !== "editing") return;
    expect(s.message).toBe(
      "Couldn't apply: No renameDeclaration. Nothing was changed.",
    );
    expect(s.draft.name).toBe("SAY");
  });

  it("F-303 AR-24 UX-44: a refused update keeps the popup open with the field problems and undoes nothing", async () => {
    const fields: FieldProblem[] = [
      {
        field: { section: "outputs", row: 0, part: "value" },
        message: "Not an expression.",
      },
    ];
    const { popup, request, undos } = await opened({
      refuse: ["updateDeclaration"],
      fields,
    });
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, description: "x" }));
    await popup.getState().applyPopup();
    const s = popup.getState();
    expect(undos).toEqual([]);
    expect(s.status === "editing" && s.fields).toEqual(fields);
  });

  it("F-303 UX-44: no change closes without applying", async () => {
    const { popup, request, applies } = await opened();
    await popup.getState().openPopup(request);
    await popup.getState().applyPopup();
    expect(applies).toEqual([]);
    expect(popup.getState().status).toBe("closed");
  });

  it("F-303 UX-44: a moved revision refuses as stale and sends nothing", async () => {
    const { popup, request, applies, bump, canvas } = await opened();
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, description: "x" }));
    bump();
    await canvas.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      workflows: [main],
      history: EMPTY_HISTORY,
    });
    await popup.getState().applyPopup();
    expect(applies).toEqual([]);
    const s = popup.getState();
    expect(s.status).toBe("editing");
    expect(s.status === "editing" && s.message).toBe(
      "GREET changed since the popup opened. Close it and open it again.",
    );
  });

  it("F-303 UX-44: Cancel discards the draft", async () => {
    const { popup, request, applies } = await opened();
    await popup.getState().openPopup(request);
    draft(popup, (d) => ({ ...d, description: "x" }));
    popup.getState().closePopup();
    expect(popup.getState().status).toBe("closed");
    expect(applies).toEqual([]);
  });

  it("F-303 F-703: openPopup in read-only does nothing", async () => {
    const { popup, request, log } = await opened({}, true);
    await popup.getState().openPopup(request);
    expect(popup.getState().status).toBe("closed");
    expect(log).toEqual([]);
  });

  it("F-303 UX-40: a node the engine refuses leaves the popup closed and says why", async () => {
    const made = setup();
    const engine = {
      ...made.engine,
      declarationForm: async () => ({
        ok: false,
        revision: 1,
        code: "invalid",
        message: "GREET has code that doesn't parse.",
        path: null,
        problems: [],
      }),
    } as unknown as EngineApi;
    const canvas = createCanvasStore(() => engine);
    await canvas.getState().open({ version: "26.10", files: [] });
    const popup = createPopupStore({
      canvas,
      engine: () => engine,
      readOnly: () => false,
    });
    await popup
      .getState()
      .openPopup({ tab: "main.nf#", node: NODE, opener: null });
    expect(popup.getState().status).toBe("closed");
    expect(popup.getState().refusal).toBe("GREET has code that doesn't parse.");
  });
});
