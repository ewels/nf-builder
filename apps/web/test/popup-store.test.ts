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
import { canApply, createPopupStore } from "../src/popup/popup-store";

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
  /** What the engine's parseDeclaration gives for a code text (F-304); default: the form with the name found in the text. */
  parse?: (text: string) => Promise<unknown> | unknown;
}

const CODE = "process GREET {\n    cpus 1\n}";
const parsedOf = (text: string) => ({
  revision: 1,
  name: /process (\w+)/.exec(text)?.[1] ?? "GREET",
  form: { ...form, description: text.includes("bad") ? "bad" : "parsed" },
  choices,
});
const bad = (message: string) => ({
  ok: false,
  revision: 1,
  code: "does-not-parse",
  message,
  path: null,
  problems: [
    {
      source: "internal",
      message,
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
    },
  ],
});

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
        text: CODE,
        span: { start: 10, end: 10 + CODE.length },
      };
    },
    parseDeclaration: async (request: { text: string }) => {
      log.push(`parse:${request.text.length}`);
      return (options.parse ?? parsedOf)(request.text);
    },
    formatDeclaration: async (request: { text: string }) => {
      log.push("format");
      return { revision, text: `${request.text}\n// formatted` };
    },
    declarationText: async (request: { base: string | null }) => {
      log.push(`render:${request.base === null ? "form" : "base"}`);
      return { revision, text: `${request.base ?? CODE}\n// rendered` };
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

describe("F-304 popup store: Code tab", () => {
  const typeCode = async (
    popup: Awaited<ReturnType<typeof opened>>["popup"],
    text: string,
  ) => {
    popup.getState().editCode(text);
    await popup.getState().flushCode();
  };
  const open = async (options: Options = {}) => {
    const made = await opened(options);
    await made.popup.getState().openPopup(made.request);
    return made;
  };
  const code = (popup: Awaited<ReturnType<typeof opened>>["popup"]) => {
    const s = popup.getState();
    if (s.status !== "editing") throw new Error(`popup is ${s.status}`);
    return s;
  };

  it("F-304 UX-43: the popup opens on the Configure tab with the declaration's text, or on Code when asked", async () => {
    const made = await opened();
    await made.popup.getState().openPopup(made.request);
    expect(code(made.popup).section).toBe("configure");
    expect(code(made.popup).code.text).toBe(CODE);
    expect(code(made.popup).code.touched).toBe(false);
    await made.popup.getState().openPopup({ ...made.request, section: "code" });
    expect(code(made.popup).section).toBe("code");
  });

  it("F-304 step 1 UX-44: a Code edit then Configure shows the parsed form", async () => {
    const { popup } = await open();
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE}\n// edited`);
    expect(code(popup).code.check).toBe("valid");
    await popup.getState().showSection("configure");
    expect(code(popup).section).toBe("configure");
    expect(code(popup).draft.description).toBe("parsed");
  });

  it("F-304 UX-44: untouched Code keeps F-303's Apply (one updateDeclaration)", async () => {
    const { popup, applies } = await open();
    await popup.getState().showSection("code");
    await popup.getState().showSection("configure");
    draft(popup, (d) => ({ ...d, description: "Says hello." }));
    await popup.getState().showSection("code");
    // the text shown is the form rendered over the declaration, display only
    expect(code(popup).code.text).toBe(`${CODE}\n// rendered`);
    expect(code(popup).code.touched).toBe(false);
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual(["updateDeclaration"]);
  });

  it("F-304 step 2 UX-44: an invalid check disables Apply and Configure; fixing it enables both", async () => {
    const { popup } = await open({
      parse: (text) =>
        text.includes("bad") ? bad("Unexpected token.") : parsedOf(text),
    });
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE} bad`);
    expect(code(popup).code.check).toBe("invalid");
    expect(code(popup).code.message).toBe("Unexpected token.");
    expect(code(popup).code.problems).toHaveLength(1);
    expect(canApply(code(popup))).toBe(false);
    await popup.getState().showSection("configure");
    expect(code(popup).section).toBe("code");
    await typeCode(popup, CODE);
    expect(code(popup).code.check).toBe("valid");
    expect(canApply(code(popup))).toBe(true);
    await popup.getState().showSection("configure");
    expect(code(popup).section).toBe("configure");
  });

  it("F-304 UX-44: an older check result is dropped", async () => {
    const waiting: ((value: unknown) => void)[] = [];
    const { popup } = await open({
      parse: (text) =>
        text.endsWith("first")
          ? new Promise((resolve) => waiting.push(() => resolve(bad("Old."))))
          : parsedOf(text),
    });
    await popup.getState().showSection("code");
    popup.getState().editCode(`${CODE} first`);
    const first = popup.getState().flushCode();
    popup.getState().editCode(CODE);
    await popup.getState().flushCode();
    waiting.forEach((w) => {
      w(null);
    });
    await first;
    expect(code(popup).code.check).toBe("valid");
    expect(code(popup).code.message).toBeNull();
  });

  it("F-304 UX-44: Configure edits after a Code edit are rendered over the code text before Apply", async () => {
    const { popup, applies, log } = await open();
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE}\n// mine`);
    await popup.getState().showSection("configure");
    draft(popup, (d) => ({ ...d, description: "Changed." }));
    await popup.getState().showSection("code");
    expect(log).toContain("render:base");
    expect(code(popup).code.text).toBe(`${CODE}\n// mine\n// rendered`);
    expect(code(popup).code.check).toBe("valid");
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual(["replaceDeclaration"]);
    expect(applies[0]?.command).toMatchObject({
      text: `${CODE}\n// mine\n// rendered`,
    });
  });

  it("F-304 UX-44 AR-23: Apply after a Code edit sends one replaceDeclaration; a new name renames first and moves the folder", async () => {
    const { popup, applies } = await open();
    await popup.getState().showSection("code");
    const text = CODE.replace("GREET", "SAY");
    await typeCode(popup, text);
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual([
      "renameDeclaration",
      "replaceDeclaration",
      "moveFile",
    ]);
    expect(applies[1]?.command).toMatchObject({ name: "SAY", text });
    expect(popup.getState().status).toBe("closed");
  });

  it("F-304 UX-44: a rename made in Configure after a Code edit is applied as replace, rename and folder move, and counts as a change", async () => {
    const { popup, applies } = await open();
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE}\n// mine`);
    await popup.getState().showSection("configure");
    draft(popup, (d) => ({ ...d, name: "SAY" }));
    await popup.getState().showSection("code");
    // the rename is still pending after the render, and survives a trip back to Configure
    await popup.getState().showSection("configure");
    expect(code(popup).draft.name).toBe("SAY");
    await popup.getState().applyPopup();
    expect(applies.map((a) => a.command.kind)).toEqual([
      "replaceDeclaration",
      "renameDeclaration",
      "moveFile",
    ]);
    expect(applies[0]?.command).toMatchObject({ name: "GREET" });
    expect(applies[1]?.command).toMatchObject({
      name: "GREET",
      newName: "SAY",
    });
    expect(new Set(applies.map((a) => JSON.stringify(a.options))).size).toBe(1);
    expect(popup.getState().status).toBe("closed");
  });

  it("F-304 UX-44: a refused Code Apply keeps the popup open with the message", async () => {
    const { popup } = await open({ refuse: ["replaceDeclaration"] });
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE}\n// x`);
    await popup.getState().applyPopup();
    expect(code(popup).message).toBe(
      "Couldn't apply: No replaceDeclaration. Nothing was changed.",
    );
    expect(code(popup).code.text).toBe(`${CODE}\n// x`);
  });

  it("F-304 UX-43: Format puts the formatted text in the draft and marks it touched", async () => {
    const { popup } = await open();
    await popup.getState().showSection("code");
    await popup.getState().formatCode();
    expect(code(popup).code.text).toBe(`${CODE}\n// formatted`);
    expect(code(popup).code.touched).toBe(true);
    expect(code(popup).code.check).toBe("valid");
  });

  it("F-304 UX-44: Cancel and close discard the code draft", async () => {
    const { popup, applies } = await open();
    await popup.getState().showSection("code");
    await typeCode(popup, `${CODE}\n// x`);
    popup.getState().closePopup();
    expect(popup.getState().status).toBe("closed");
    expect(applies).toEqual([]);
  });

  it("F-304 UX-44 ADR 0066: Esc asks before discarding an edited code draft, and closes at once when unedited", async () => {
    const { popup } = await open();
    await popup.getState().showSection("code");
    popup.getState().requestClose();
    expect(popup.getState().status).toBe("closed");
    await popup.getState().openPopup({
      tab: "main.nf#",
      node: NODE,
      opener: null,
      section: "code",
    });
    await typeCode(popup, `${CODE}\n// x`);
    popup.getState().requestClose();
    expect(popup.getState().status).toBe("editing");
    expect(code(popup).discarding).toBe(true);
    popup.getState().keepEditing();
    expect(code(popup).discarding).toBe(false);
    popup.getState().requestClose();
    popup.getState().closePopup();
    expect(popup.getState().status).toBe("closed");
  });

  it("F-304 F-209: flushCode only runs the pending check and applies nothing", async () => {
    const { popup, applies, log } = await open();
    await popup.getState().showSection("code");
    popup.getState().editCode(`${CODE}\n// y`);
    expect(code(popup).code.check).toBe("checking");
    await popup.getState().flushCode();
    expect(code(popup).code.check).toBe("valid");
    expect(applies).toEqual([]);
    expect(log.filter((l) => l.startsWith("parse"))).toHaveLength(1);
  });
});
