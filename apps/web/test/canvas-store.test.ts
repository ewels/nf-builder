import {
  EMPTY_HISTORY,
  type EngineApi,
  type EngineRefusal,
  type Projection,
  type ProjectionResult,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import {
  createCanvasStore,
  defaultWorkflow,
  tabFor,
} from "../src/canvas/canvas-store";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const ref = (path: string, name: string | null): WorkflowRef => ({
  path,
  name,
  modelled: true,
  typed: true,
  range,
});
const projectionOf = (workflow: WorkflowRef): Projection => ({
  workflow,
  nodes: [],
  edges: [],
  statements: [],
});
const summaryOf = (workflows: WorkflowRef[], revision = 1): ProjectSummary => ({
  revision,
  version: "26.10",
  files: [],
  workflows,
});

/** A fake engine; `project` answers from `answers` or waits on `gates`. */
function fake(
  workflows: WorkflowRef[],
  options: {
    refuse?: boolean;
    nullFor?: string;
    /** The revision the engine answers with (default 1); change it between calls to simulate an edit. */
    revision?: number;
    gates?: Map<string, Promise<void>>;
    details?: (node: string) => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const engine = {
    open: async () => summaryOf(workflows),
    project: async (
      path: string,
      workflow: string | null,
    ): Promise<ProjectionResult | EngineRefusal> => {
      const key = `${path}#${workflow ?? ""}`;
      calls.push(key);
      await options.gates?.get(key);
      if (options.refuse)
        return {
          ok: false,
          revision: null,
          code: "no-project",
          message: "No project is open.",
          path: null,
          problems: [],
        };
      const found = workflows.find(
        (w) => w.path === path && w.name === workflow,
      );
      return {
        revision: options.revision ?? 1,
        projection:
          found === undefined || key === options.nullFor
            ? null
            : projectionOf(found),
      };
    },
    details: async (_path: string, _workflow: string | null, node: string) =>
      options.details === undefined
        ? {
            revision: options.revision ?? 1,
            details: {
              node,
              declaration: {
                path: null,
                line: null,
                description: null,
                directives: [],
                topics: [],
                operators: [],
                preview: null,
              },
              diagnostics: [],
            },
          }
        : options.details(node),
  } as unknown as EngineApi;
  return { engine, calls };
}

const request = { version: "26.10", files: [] };

describe("F-205 canvas store", () => {
  it("F-205 UX-20: opening a project opens main.nf's entry workflow as the only tab and loads its projection", async () => {
    const wf = [ref("lib.nf", "LIB"), ref("main.nf", null)];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    const s = store.getState();
    expect(s.tabs.map((t) => t.id)).toEqual(["main.nf#"]);
    expect(s.activeTab).toBe("main.nf#");
    expect(s.content.status).toBe("ready");
    expect(s.summary?.revision).toBe(1);
  });

  it("F-205 UX-20: the default tab falls back to another entry workflow, then the first named one; none gives no tab", () => {
    expect(
      defaultWorkflow([ref("a.nf", "A"), ref("sub/x.nf", null)])?.path,
    ).toBe("sub/x.nf");
    expect(defaultWorkflow([ref("a.nf", "A"), ref("b.nf", "B")])?.name).toBe(
      "A",
    );
    expect(defaultWorkflow([])).toBeNull();
  });

  it("F-205 UX-20: a project with no workflow has no tab and no canvas", async () => {
    const store = createCanvasStore(() => fake([]).engine);
    await store.getState().open(request);
    expect(store.getState().tabs).toEqual([]);
    expect(store.getState().content.status).toBe("empty");
  });

  it("F-205 UX-20: openWorkflow adds a tab once and focuses it; selectTab loads that tab", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    const { engine, calls } = fake(wf);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().openWorkflow("lib.nf", "LIB");
    await store.getState().openWorkflow("lib.nf", "LIB");
    expect(store.getState().tabs.map((t) => t.id)).toEqual([
      "main.nf#",
      "lib.nf#LIB",
    ]);
    expect(store.getState().activeTab).toBe("lib.nf#LIB");
    await store.getState().selectTab("main.nf#");
    const s = store.getState();
    expect(s.activeTab).toBe("main.nf#");
    expect(
      s.content.status === "ready" && s.content.projection.workflow.name,
    ).toBe(null);
    expect(calls.at(-1)).toBe("main.nf#");
  });

  it("F-205: a projection for a superseded tab is ignored", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine } = fake(wf, { gates: new Map([["lib.nf#LIB", gate]]) });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const slow = store.getState().openWorkflow("lib.nf", "LIB");
    await store.getState().selectTab("main.nf#");
    release();
    await slow;
    const s = store.getState();
    expect(s.activeTab).toBe("main.nf#");
    expect(
      s.content.status === "ready" && s.content.projection.workflow.path,
    ).toBe("main.nf");
  });

  it("F-205 IO-14: a refusal or a null projection shows an unavailable message", async () => {
    const wf = [ref("main.nf", null)];
    const refused = createCanvasStore(() => fake(wf, { refuse: true }).engine);
    await refused.getState().open(request);
    expect(refused.getState().content).toEqual({
      status: "unavailable",
      message: "No project is open.",
    });
    const nulled = createCanvasStore(
      () => fake(wf, { nullFor: "main.nf#" }).engine,
    );
    await nulled.getState().open(request);
    const content = nulled.getState().content;
    expect(content.status).toBe("unavailable");
    expect(content.status === "unavailable" && content.message).toContain(
      "could not be parsed",
    );
  });

  it("F-205 UX-20: entry tabs are labelled with the file name, named workflows with their name", () => {
    expect(tabFor(ref("pipelines/main.nf", null)).label).toBe("main.nf");
    expect(tabFor(ref("modules/x.nf", "PREPARE")).label).toBe("PREPARE");
    expect(tabFor(ref("main.nf", null)).id).toBe("main.nf#");
  });

  it("F-205 UX-21: the port labels setting is session state, on by default", () => {
    const store = createCanvasStore(() => fake([]).engine);
    expect(store.getState().portLabels).toBe(true);
    store.getState().setPortLabels(false);
    expect(store.getState().portLabels).toBe(false);
  });

  it("F-205 UX-20: show opens the default workflow without calling the engine's open; the hook's open is unsaved", async () => {
    const wf = [ref("main.nf", null)];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().show(summaryOf(wf));
    expect(store.getState().source).toBe("project");
    expect(store.getState().content.status).toBe("ready");
    await store.getState().open(request);
    expect(store.getState().source).toBe("unsaved");
  });

  it("F-205 F-202 UX-20: projectGone resets a stored project's canvas but leaves a hook-opened one", async () => {
    const wf = [ref("main.nf", null)];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    store.getState().projectGone();
    expect(store.getState().summary).not.toBeNull();
    await store.getState().show(summaryOf(wf));
    store.getState().projectGone();
    const s = store.getState();
    expect([s.summary, s.tabs, s.activeTab, s.source]).toEqual([
      null,
      [],
      null,
      null,
    ]);
    expect(s.content.status).toBe("empty");
  });

  it("F-205 F-202: a projection still in flight when the project goes is dropped", async () => {
    const wf = [ref("main.nf", null)];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createCanvasStore(
      () => fake(wf, { gates: new Map([["main.nf#", gate]]) }).engine,
    );
    const pending = store.getState().show(summaryOf(wf));
    store.getState().projectGone();
    release();
    await pending;
    expect(store.getState().content.status).toBe("empty");
  });

  it("F-205 F-113: a change re-projects the active tab without a loading state, and opens main.nf in a blank project", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, calls } = fake(wf);
    const store = createCanvasStore(() => engine);
    await store.getState().show(summaryOf([]));
    expect(store.getState().tabs).toEqual([]);
    const change = {
      revision: 2,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: wf,
    };
    await store.getState().changed(change);
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["main.nf#"]);
    expect(store.getState().content.status).toBe("ready");
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.content.status));
    await store.getState().changed({ ...change, revision: 3 });
    expect(seen).not.toContain("loading");
    expect(calls).toEqual(["main.nf#", "main.nf#"]);
    expect(store.getState().summary?.revision).toBe(3);
  });

  it("F-205: a change with no project shown does nothing", async () => {
    const store = createCanvasStore(() => fake([]).engine);
    await store.getState().changed({
      revision: 1,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: [],
    });
    expect(store.getState().summary).toBeNull();
  });
});

describe("F-208 view mode per tab", () => {
  it("F-208 UX-27 AR-30: tabs open in Graph mode; setMode changes only that tab, and selecting a tab keeps its mode", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    await store.getState().openWorkflow("lib.nf", "LIB");
    const modes = () => store.getState().tabs.map((t) => t.mode);
    expect(modes()).toEqual(["graph", "graph"]);
    store.getState().setMode("lib.nf#LIB", "code");
    expect(modes()).toEqual(["graph", "code"]);
    store.getState().setMode("main.nf#", "split");
    await store.getState().selectTab("lib.nf#LIB");
    expect(modes()).toEqual(["split", "code"]);
    await store.getState().selectTab("main.nf#");
    expect(modes()).toEqual(["split", "code"]);
    // an unknown tab changes nothing
    store.getState().setMode("none#", "code");
    expect(modes()).toEqual(["split", "code"]);
  });
});

/** A fake whose `apply` answers from `outcome`, recording the revisions it was called with. */
function applying(workflows: WorkflowRef[], outcome: unknown) {
  const base = fake(workflows);
  const revisions: number[] = [];
  const engine = {
    ...base.engine,
    apply: async (_command: unknown, revision: number) => {
      revisions.push(revision);
      return outcome;
    },
  } as unknown as EngineApi;
  return { engine, revisions, calls: base.calls };
}

const command = {
  kind: "replaceFileText",
  path: "main.nf",
  text: "workflow {}\n",
} as const;

describe("F-208 apply", () => {
  it("F-208 step 2: apply sends the command at the current revision, then adopts the new revision, records the changed paths and reloads the active projection", async () => {
    const wf = [ref("main.nf", null)];
    const change = {
      ok: true,
      revision: 2,
      files: [{ path: "main.nf", text: "x" }],
      remodelled: ["main.nf"],
      workflows: wf,
      patches: [],
      inverse: [],
    };
    const { engine, revisions, calls } = applying(wf, change);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    expect(store.getState().lastChange).toBeNull();
    const outcome = await store.getState().apply(command);
    expect(outcome.ok).toBe(true);
    expect(revisions).toEqual([1]);
    expect(store.getState().summary?.revision).toBe(2);
    expect(store.getState().lastChange).toEqual({
      revision: 2,
      paths: ["main.nf"],
    });
    expect(calls).toEqual(["main.nf#", "main.nf#"]);
  });

  it("F-208 step 2 AR-24: a refused command leaves the revision and projection unchanged", async () => {
    const wf = [ref("main.nf", null)];
    const refusal = {
      ok: false,
      revision: 1,
      code: "does-not-parse",
      message: "no",
      path: "main.nf",
      problems: [],
    };
    const { engine, calls } = applying(wf, refusal);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const before = store.getState().content;
    const outcome = await store.getState().apply(command);
    expect(outcome).toEqual(refusal);
    expect(store.getState().summary?.revision).toBe(1);
    expect(store.getState().content).toBe(before);
    expect(store.getState().lastChange).toBeNull();
    expect(calls).toEqual(["main.nf#"]);
  });

  it("F-208: a refusal reporting a newer revision adopts it and reloads the projection", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, calls } = applying(wf, {
      ok: false,
      revision: 5,
      code: "stale",
      message: "stale",
      path: null,
      problems: [],
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().apply(command);
    expect(store.getState().summary?.revision).toBe(5);
    expect(calls).toEqual(["main.nf#", "main.nf#"]);
  });

  it("F-208: with no project apply answers no-project", async () => {
    const store = createCanvasStore(() => fake([]).engine);
    const outcome = await store.getState().apply(command);
    expect(outcome.ok === false && outcome.code).toBe("no-project");
  });

  it("F-208 ADR-0004 IO-01: show and projectGone start a new session, and an apply from an old one never reaches the engine", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, revisions } = applying(wf, { ok: true });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const first = store.getState().session;
    await store.getState().show(summaryOf(wf), "project");
    const second = store.getState().session;
    expect(second).toBeGreaterThan(first);
    const stale = await store.getState().apply(command, first);
    expect(stale.ok === false && stale.code).toBe("no-project");
    expect(revisions).toEqual([]);
    store.getState().projectGone();
    expect(store.getState().session).toBeGreaterThan(second);
    await store.getState().show(summaryOf(wf), "project");
    await store.getState().apply(command, store.getState().session);
    expect(revisions).toEqual([1]);
  });
});

describe("F-206 selection", () => {
  const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];

  it("F-206 UX-30 AR-30: selecting a node stores it and loads its details", async () => {
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
    const pending = store.getState().select("main.nf#/a");
    expect(store.getState().selected).toBe("main.nf#/a");
    expect(store.getState().details).toEqual({
      status: "loading",
      node: "main.nf#/a",
    });
    await pending;
    const d = store.getState().details;
    expect(d.status === "ready" && [d.node, d.revision]).toEqual([
      "main.nf#/a",
      1,
    ]);
  });

  it("F-206 UX-31: clearing the selection drops pending details", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createCanvasStore(
      () =>
        fake(wf, {
          details: async (node) => {
            await gate;
            return { revision: 1, details: { node } };
          },
        }).engine,
    );
    await store.getState().open(request);
    const pending = store.getState().select("main.nf#/a");
    await store.getState().select(null);
    release();
    await pending;
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
  });

  it("F-206 UX-30: a details result for an older selection, tab or revision is ignored or marked unavailable; a null result clears the selection", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createCanvasStore(
      () =>
        fake(wf, {
          details: async (node) => {
            if (node === "slow") await gate;
            if (node === "gone") return { revision: 1, details: null };
            if (node === "old") return { revision: 0, details: { node } };
            if (node === "refused")
              return { ok: false, code: "no-project", message: "No project." };
            return { revision: 1, details: { node } };
          },
        }).engine,
    );
    await store.getState().open(request);
    const slow = store.getState().select("slow");
    await store.getState().select("fast");
    release();
    await slow;
    expect(store.getState().selected).toBe("fast");
    const fastDetails = store.getState().details;
    expect(fastDetails.status === "ready" && fastDetails.node).toBe("fast");
    await store.getState().select("old");
    expect(store.getState().details).toEqual({
      status: "unavailable",
      node: "old",
      message: "The project changed. Select the node again.",
    });
    await store.getState().select("refused");
    expect(store.getState().details).toEqual({
      status: "unavailable",
      node: "refused",
      message: "No project.",
    });
    await store.getState().select("gone");
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
    // a tab switch while a request is in flight drops the result
    const again = store.getState().select("slow");
    await store.getState().openWorkflow("lib.nf", "LIB");
    await again;
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
  });

  it("F-206 UX-30 UX-31: opening a project, opening a workflow or switching tabs clears the selection", async () => {
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    await store.getState().select("a");
    await store.getState().openWorkflow("lib.nf", "LIB");
    expect(store.getState().selected).toBeNull();
    await store.getState().select("b");
    await store.getState().selectTab("main.nf#");
    expect(store.getState().selected).toBeNull();
    await store.getState().select("c");
    await store.getState().open(request);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
  });

  it("F-206 UX-30: a refresh keeps the selection and loads its details again at the new revision", async () => {
    const options: Parameters<typeof fake>[1] = {};
    const store = createCanvasStore(() => fake(wf, options).engine);
    await store.getState().open(request);
    await store.getState().select("a");
    options.revision = 2;
    await store.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: wf,
    });
    expect(store.getState().selected).toBe("a");
    const d = store.getState().details;
    expect(d.status === "ready" && d.revision).toBe(2);
  });

  it("F-206 UX-30: details at a newer revision than the canvas show loading, not a stale-selection message", async () => {
    const options: Parameters<typeof fake>[1] = {};
    const store = createCanvasStore(() => fake(wf, options).engine);
    await store.getState().open(request);
    options.revision = 2;
    await store.getState().select("a");
    expect(store.getState().selected).toBe("a");
    expect(store.getState().details).toEqual({ status: "loading", node: "a" });
    await store.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: wf,
    });
    const d = store.getState().details;
    expect(d.status === "ready" && d.revision).toBe(2);
  });

  it("F-206 UX-30: a refresh that leaves no canvas (unparseable) clears the selection", async () => {
    const options: Parameters<typeof fake>[1] = {};
    const store = createCanvasStore(() => fake(wf, options).engine);
    await store.getState().open(request);
    await store.getState().select("a");
    options.nullFor = "main.nf#";
    await store.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: wf,
    });
    expect(store.getState().content.status).toBe("unavailable");
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
  });
});

const statusOf = (undoCount: number, redoCount = 0) => ({
  undo: undoCount > 0 ? "Edit main.nf" : null,
  redo: redoCount > 0 ? "Edit main.nf" : null,
  undoCount,
  redoCount,
});

/** A fake whose `apply`, `undo`, `redo` and `history` answer from scripts, logging every call in order. */
function historic(
  workflows: WorkflowRef[],
  script: {
    apply?: (revision: number, options: unknown) => Promise<unknown>;
    undo?: (revision: number) => Promise<unknown>;
    redo?: (revision: number) => Promise<unknown>;
    history?: () => Promise<unknown>;
  },
) {
  const base = fake(workflows);
  const log: string[] = [];
  const engine = {
    ...base.engine,
    apply: async (_c: unknown, revision: number, options: unknown) => {
      log.push(`apply@${revision}`);
      return script.apply?.(revision, options);
    },
    undo: async (revision: number) => {
      log.push(`undo@${revision}`);
      return script.undo?.(revision);
    },
    redo: async (revision: number) => {
      log.push(`redo@${revision}`);
      return script.redo?.(revision);
    },
    history: async () => {
      log.push("history");
      return script.history?.() ?? EMPTY_HISTORY;
    },
  } as unknown as EngineApi;
  return { engine, log, calls: base.calls };
}

const changeAt = (
  revision: number,
  workflows: WorkflowRef[],
  history = statusOf(1),
  extra: object = {},
) => ({
  ok: true,
  revision,
  files: [{ path: "main.nf", text: "x" }],
  remodelled: ["main.nf"],
  workflows,
  history,
  ...extra,
});

describe("F-209 history", () => {
  it("F-209 AR-23: undo and redo send the store's revision, adopt the new revision and history, record the changed paths and reload the active projection", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log, calls } = historic(wf, {
      undo: async (r) =>
        changeAt(r + 1, wf, statusOf(0, 1), { label: "Edit main.nf" }),
      redo: async (r) =>
        changeAt(r + 1, wf, statusOf(1), { label: "Edit main.nf" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    expect(store.getState().history).toEqual(EMPTY_HISTORY);
    const undone = await store.getState().undo();
    expect(undone.ok).toBe(true);
    expect(log).toEqual(["undo@1"]);
    expect(store.getState().summary?.revision).toBe(2);
    expect(store.getState().history).toEqual(statusOf(0, 1));
    expect(store.getState().lastChange).toEqual({
      revision: 2,
      paths: ["main.nf"],
    });
    expect(store.getState().historyNotice).toBe("Undone: Edit main.nf");
    expect(calls).toEqual(["main.nf#", "main.nf#"]);
    await store.getState().redo();
    expect(log).toEqual(["undo@1", "redo@2"]);
    expect(store.getState().history).toEqual(statusOf(1));
    expect(store.getState().historyNotice).toBe("Redone: Edit main.nf");
  });

  it("F-209: apply, undo and redo run one at a time, each at the revision the previous one produced", async () => {
    const wf = [ref("main.nf", null)];
    const gate: { open: () => void } = { open: () => undefined };
    const held = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const { engine, log } = historic(wf, {
      apply: async (r) => {
        await held;
        return changeAt(r + 1, wf);
      },
      undo: async (r) => changeAt(r + 1, wf, statusOf(0, 1), { label: "x" }),
      redo: async (r) => changeAt(r + 1, wf, statusOf(1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const all = Promise.all([
      store.getState().apply(command),
      store.getState().undo(),
      store.getState().redo(),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual(["apply@1"]);
    gate.open();
    await all;
    expect(log).toEqual(["apply@1", "undo@2", "redo@3"]);
    expect(store.getState().summary?.revision).toBe(4);
  });

  it("F-209 F-208: undo and redo first await the registered code-pane flushes, and a flush that apply queues does not deadlock", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {
      apply: async (r) => changeAt(r + 1, wf),
      undo: async (r) => changeAt(r + 1, wf, statusOf(0, 1), { label: "x" }),
      redo: async (r) => changeAt(r + 1, wf, statusOf(1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const unregister = store.getState().registerFlush(async () => {
      log.push("flush");
      await store.getState().apply(command, store.getState().session);
    });
    await store.getState().undo();
    expect(log).toEqual(["flush", "apply@1", "undo@2"]);
    unregister();
    await store.getState().redo();
    expect(log).toEqual(["flush", "apply@1", "undo@2", "redo@3"]);
  });

  it("F-209 ADR-0004 IO-01: an undo or redo from a project that is no longer shown never reaches the engine", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {});
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const first = store.getState().session;
    await store.getState().show(summaryOf(wf), "project");
    const a = await store.getState().undo(first);
    const b = await store.getState().redo(first);
    expect(a.ok === false && a.code).toBe("no-project");
    expect(b.ok === false && b.code).toBe("no-project");
    expect(log).toEqual([]);
    const none = createCanvasStore(() => engine);
    const c = await none.getState().undo();
    expect(c.ok === false && c.code).toBe("no-project");
  });

  it("F-209: a stale or no-history refusal adopts a newer revision, refreshes the history, sets the notice and isn't retried", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log, calls } = historic(wf, {
      undo: async () => ({
        ok: false,
        revision: 4,
        code: "stale",
        message: "The project changed.",
        path: null,
        problems: [],
      }),
      redo: async () => ({
        ok: false,
        revision: 4,
        code: "no-history",
        message: "There is nothing to redo.",
        path: null,
        problems: [],
      }),
      history: async () => statusOf(2),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const outcome = await store.getState().undo();
    expect(outcome.ok === false && outcome.code).toBe("stale");
    expect(log).toEqual(["undo@1", "history"]);
    expect(store.getState().summary?.revision).toBe(4);
    expect(store.getState().history).toEqual(statusOf(2));
    expect(store.getState().historyNotice).toBe("The project changed.");
    expect(calls).toEqual(["main.nf#", "main.nf#"]);
    await store.getState().redo();
    expect(store.getState().historyNotice).toBe("There is nothing to redo.");
    expect(log.filter((l) => l.startsWith("undo"))).toHaveLength(1);
  });

  it("F-209 AR-23: a worker failure on undo or redo becomes an internal refusal and a notice, not a rejection", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {
      undo: async () => {
        throw new Error("worker died");
      },
      redo: async (r) => changeAt(r + 1, wf, statusOf(1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const outcome = await store.getState().undo();
    expect(outcome.ok === false && outcome.code).toBe("internal");
    expect(store.getState().historyNotice).toBe("worker died");
    // the queue still works afterwards
    const next = await store.getState().redo();
    expect(next.ok).toBe(true);
    expect(log).toContain("redo@1");
  });

  it("F-209 ADR-0004 IO-01: a key press made while a flush is pending does not act on a project opened meanwhile", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {
      undo: async (r) => changeAt(r + 1, wf, statusOf(0, 1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.getState().registerFlush(() => gate);
    const pending = store.getState().undo();
    await store.getState().show(summaryOf(wf), "project");
    release();
    const outcome = await pending;
    expect(outcome.ok === false && outcome.code).toBe("no-project");
    expect(log.filter((l) => l.startsWith("undo"))).toEqual([]);
  });

  it("F-209 AR-23: an internal refusal from apply refreshes the history", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {
      apply: async () => ({
        ok: false,
        revision: 3,
        code: "internal",
        message: "boom",
        path: null,
        problems: [],
      }),
      history: async () => EMPTY_HISTORY,
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().changed({
      revision: 1,
      files: [],
      remodelled: [],
      history: statusOf(2),
      workflows: wf,
    });
    expect(store.getState().history.undoCount).toBe(2);
    await store.getState().apply(command);
    expect(log).toEqual(["apply@1", "history"]);
    expect(store.getState().summary?.revision).toBe(3);
    expect(store.getState().history).toEqual(EMPTY_HISTORY);
  });

  it("F-209 F-301: apply passes group and label to the engine; opening a project resets the history and notice", async () => {
    const wf = [ref("main.nf", null)];
    const seen: unknown[] = [];
    const { engine } = historic(wf, {
      apply: async (r, options) => {
        seen.push(options);
        return changeAt(r + 1, wf, statusOf(1));
      },
      undo: async (r) => changeAt(r + 1, wf, statusOf(0, 1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store
      .getState()
      .apply(command, undefined, { group: "g", label: "Add module" });
    expect(seen).toEqual([{ group: "g", label: "Add module" }]);
    expect(store.getState().history.undoCount).toBe(1);
    await store.getState().undo();
    expect(store.getState().historyNotice).not.toBeNull();
    await store.getState().show(summaryOf(wf), "project");
    expect(store.getState().history).toEqual(EMPTY_HISTORY);
    expect(store.getState().historyNotice).toBeNull();
  });

  it("F-209 F-207: undoing a workflow rename keeps its tab, which follows the name back", async () => {
    const before = [ref("main.nf", null), ref("lib.nf", "OLD")];
    const after = [ref("main.nf", null), ref("lib.nf", "NEW")];
    const { engine } = historic(before, {
      undo: async (r) =>
        changeAt(r + 1, before, statusOf(0, 1), { label: "x" }),
      redo: async (r) => changeAt(r + 1, after, statusOf(1), { label: "x" }),
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().openWorkflow("lib.nf", "OLD");
    store.getState().setMode("lib.nf#OLD", "split");
    // the engine now holds the renamed workflow
    await store.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      history: statusOf(1),
      workflows: after,
    });
    const tabs = () => store.getState().tabs.map((t) => [t.id, t.mode]);
    expect(tabs()).toEqual([
      ["main.nf#", "graph"],
      ["lib.nf#NEW", "split"],
    ]);
    expect(store.getState().activeTab).toBe("lib.nf#NEW");
    await store.getState().undo();
    expect(tabs()).toEqual([
      ["main.nf#", "graph"],
      ["lib.nf#OLD", "split"],
    ]);
    expect(store.getState().activeTab).toBe("lib.nf#OLD");
  });

  it("F-209 F-207: a rename onto an id that a stale tab already holds leaves one tab with that id, keeping the renamed tab's mode", async () => {
    const before = [ref("main.nf", null), ref("lib.nf", "OLD")];
    const after = [ref("main.nf", null), ref("lib.nf", "NEW")];
    const { engine } = historic(before, {});
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().openWorkflow("lib.nf", "OLD");
    store.getState().setMode("lib.nf#OLD", "split");
    await store.getState().openWorkflow("lib.nf", "NEW");
    await store.getState().selectTab("lib.nf#OLD");
    await store.getState().changed({
      revision: 2,
      files: [],
      remodelled: [],
      history: statusOf(1),
      workflows: after,
    });
    const tabs = store.getState().tabs.map((t) => [t.id, t.mode]);
    expect(tabs).toEqual([
      ["main.nf#", "graph"],
      ["lib.nf#NEW", "split"],
    ]);
    expect(store.getState().activeTab).toBe("lib.nf#NEW");
  });
});
