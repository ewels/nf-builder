import {
  canvasView,
  EMPTY_HISTORY,
  type EngineApi,
  type EngineRefusal,
  type LayoutWrite,
  type Positions,
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
  layout: { state: "absent", message: null },
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
    /** The stored positions `project` answers with. */
    positions?: Positions;
    /** The ids of the projection's nodes (default none); a function is asked at each `project`. */
    nodes?: string[] | (() => string[]);
    /** What `setLayout` answers with (default: the sidecar was written, status ok). */
    setLayout?: (write: LayoutWrite) => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const writes: LayoutWrite[] = [];
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
            : {
                ...projectionOf(found),
                nodes: (typeof options.nodes === "function"
                  ? options.nodes()
                  : (options.nodes ?? [])
                ).map((id) => ({ id })) as never,
              },
        positions: options.positions ?? {},
      };
    },
    setLayout: async (write: LayoutWrite) => {
      writes.push(write);
      return options.setLayout === undefined
        ? {
            revision: 1,
            files: [{ path: ".nf-builder/layout.json", text: "{}" }],
            layout: { state: "ok", message: null },
          }
        : options.setLayout(write);
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
  return { engine, calls, writes };
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

  describe("F-207 positions", () => {
    const wf = [ref("main.nf", null)];
    const stored: Positions = { a: { x: 1, y: 2 }, b: { x: 30, y: 40 } };
    const tab = "main.nf#";

    it("F-207 IO-02: the stored positions of the projection come with it, with no notice", async () => {
      const store = createCanvasStore(
        () => fake(wf, { positions: stored }).engine,
      );
      await store.getState().open(request);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.positions).toEqual(stored);
      expect(c.notice).toBeNull();
    });

    it("F-207 IO-02: an unreadable sidecar's message is the layout notice, and once the file is replaced it says so in the past tense", async () => {
      const store = createCanvasStore(
        () =>
          ({
            ...fake(wf, { positions: stored }).engine,
            open: async () => ({
              ...summaryOf(wf),
              layout: {
                state: "invalid",
                message: "The layout file couldn't be read (x).",
              },
            }),
          }) as unknown as EngineApi,
      );
      await store.getState().open(request);
      expect(store.getState().layoutNotice).toBe(
        "The layout file couldn't be read (x).",
      );
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      expect(store.getState().summary?.layout.state).toBe("ok");
      expect(store.getState().layoutNotice).toBe(
        "The layout file couldn't be read and was replaced.",
      );
      // later saves leave it as it is
      await store.getState().moveNodes({ a: { x: 6, y: 6 } });
      expect(store.getState().layoutNotice).toBe(
        "The layout file couldn't be read and was replaced.",
      );
    });

    it("F-207 IO-02: a notice about entries dropped from the sidecar stays after the next save", async () => {
      const dropped = "2 layout entries couldn't be read and were dropped.";
      const store = createCanvasStore(
        () =>
          ({
            ...fake(wf, { positions: stored }).engine,
            open: async () => ({
              ...summaryOf(wf),
              layout: { state: "ok", message: dropped },
            }),
          }) as unknown as EngineApi,
      );
      await store.getState().open(request);
      expect(store.getState().layoutNotice).toBe(dropped);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      expect(store.getState().layoutNotice).toBe(dropped);
    });

    it("F-207 step 2: a drag updates positions locally and sends one setLayout with rounded coordinates", async () => {
      const { engine, writes } = fake(wf, { positions: stored });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 10.4, y: 20.6 } });
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.positions).toEqual({ a: { x: 10, y: 21 }, b: stored.b });
      expect(writes).toEqual([
        {
          revision: 1,
          path: "main.nf",
          workflow: null,
          positions: { a: { x: 10, y: 21 } },
          replace: false,
        },
      ]);
      // the same place again is no move at all
      await store.getState().moveNodes({ a: { x: 10.2, y: 20.8 } });
      expect(writes).toHaveLength(1);
    });

    it("F-207 IO-02: the sidecar's status from a save is kept on the summary, and a refused save shows a notice", async () => {
      const refusal = {
        ok: false,
        revision: null,
        code: "invalid",
        message: "no such node",
        path: null,
        problems: [],
      };
      let answer: unknown = {
        revision: 1,
        files: [],
        layout: { state: "newer", message: "from a newer nf-builder" },
      };
      const store = createCanvasStore(
        () =>
          fake(wf, { positions: stored, setLayout: async () => answer }).engine,
      );
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      expect(store.getState().summary?.layout).toEqual({
        state: "newer",
        message: "from a newer nf-builder",
      });
      expect(store.getState().layoutNotice).toBe("from a newer nf-builder");
      answer = refusal;
      await store.getState().moveNodes({ a: { x: 6, y: 6 } });
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.notice).toBe("The positions couldn't be saved (no such node).");
    });

    it("F-207 AR-11: a move the engine refuses as stale is dropped quietly, with no notice", async () => {
      const stale = {
        ok: false,
        revision: 2,
        code: "stale",
        message:
          "The project changed (revision 2, not 1). Nothing was changed.",
        path: null,
        problems: [],
      };
      const { engine, writes } = fake(wf, {
        positions: stored,
        setLayout: async () => stale,
      });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.revision).toBe(1);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.notice).toBeNull();
    });

    const staleAnswer = {
      ok: false,
      revision: 2,
      code: "stale",
      message: "The project changed (revision 2, not 1). Nothing was changed.",
      path: null,
      problems: [],
    };
    const change = {
      revision: 2,
      files: [],
      remodelled: [],
      history: EMPTY_HISTORY,
      workflows: wf,
    };
    const NOTICE =
      "Your last move couldn't be saved because the workflow changed. Move the node again.";

    it("F-207 AR-11: a move refused as stale is sent again once after the next refresh, when its nodes are still there", async () => {
      let revision = 1;
      let calls = 0;
      const { engine, writes } = fake(wf, {
        positions: stored,
        nodes: ["a", "b"],
        get revision() {
          return revision;
        },
        setLayout: async () => (++calls === 1 ? staleAnswer : { ...ok() }),
      });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      expect(writes).toHaveLength(1);
      revision = 2;
      await store.getState().changed(change);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual({
        revision: 2,
        path: "main.nf",
        workflow: null,
        positions: { a: { x: 5, y: 5 } },
        replace: false,
      });
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.positions.a).toEqual({ x: 5, y: 5 });
      expect(c.notice).toBeNull();
      // sent once only
      await store.getState().changed({ ...change, revision: 3 });
      expect(writes).toHaveLength(2);
    });

    it("F-207 AR-11: a stale move whose node is gone after the refresh shows a notice and isn't sent again", async () => {
      let present = ["a", "b"];
      const { engine, writes } = fake(wf, {
        positions: stored,
        nodes: () => present,
        revision: 2,
        setLayout: async () => staleAnswer,
      });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      present = ["b"];
      await store.getState().changed(change);
      expect(writes).toHaveLength(1);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.notice).toBe(NOTICE);
    });

    it("F-207 AR-11: a move refused as stale twice shows the notice", async () => {
      const { engine, writes } = fake(wf, {
        positions: stored,
        nodes: ["a", "b"],
        revision: 2,
        setLayout: async () => staleAnswer,
      });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      await store.getState().changed(change);
      expect(writes).toHaveLength(2);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.notice).toBe(NOTICE);
    });

    it("F-207 ADR-0008: a placement keeps the positions the user set while the layout ran", async () => {
      const { engine, writes } = fake(wf, {
        positions: stored,
        nodes: ["a", "b", "c"],
      });
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      // the layout run started here, then the user moved a
      await store.getState().moveNodes({ a: { x: 5, y: 5 } });
      await store.getState().placeNodes(
        { tab, revision: 1 },
        {
          positions: {
            a: { x: 1, y: 2 },
            b: { x: 30, y: 40 },
            c: { x: 9, y: 9 },
          },
          saved: { c: { x: 9, y: 9 } },
          replace: false,
          notice: null,
        },
      );
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.positions).toEqual({
        a: { x: 5, y: 5 },
        b: stored.b,
        c: { x: 9, y: 9 },
      });
      expect(writes.at(-1)?.positions).toEqual({ c: { x: 9, y: 9 } });
    });

    it("F-207 ADR-0008: a placement is stored and saved; with nothing added nothing is sent, and a replace sends the whole set", async () => {
      const { engine, writes } = fake(wf);
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      const at = { tab, revision: 1 };
      await store.getState().placeNodes(at, {
        positions: stored,
        saved: stored,
        replace: false,
        notice: null,
      });
      expect(writes).toHaveLength(1);
      await store.getState().placeNodes(at, {
        positions: stored,
        saved: {},
        replace: false,
        notice: "Automatic layout isn't available (x).",
      });
      expect(writes).toHaveLength(1);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.notice).toBe("Automatic layout isn't available (x).");
      await store.getState().placeNodes(at, {
        positions: stored,
        saved: stored,
        replace: true,
        notice: null,
      });
      expect(writes[1]?.replace).toBe(true);
    });

    it("F-207: a placement for a superseded revision or tab is dropped", async () => {
      const { engine, writes } = fake(wf);
      const store = createCanvasStore(() => engine);
      await store.getState().open(request);
      const placement = {
        positions: stored,
        saved: stored,
        replace: false,
        notice: null,
      };
      await store.getState().placeNodes({ tab, revision: 0 }, placement);
      await store
        .getState()
        .placeNodes({ tab: "other#", revision: 1 }, placement);
      expect(writes).toEqual([]);
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      expect(c.positions).toEqual({});
    });
  });
});

const ok = () => ({
  revision: 1,
  files: [],
  layout: { state: "ok", message: null },
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

  it("F-309 F-209: applyFix runs in the store queue after the registered code-pane flushes, at the given revision, and adopts the result like apply", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, log } = historic(wf, {
      apply: async (r) => changeAt(r + 1, wf),
    });
    const fixes: unknown[][] = [];
    (engine as unknown as Record<string, unknown>).applyFix = async (
      ...args: unknown[]
    ) => {
      log.push(`applyFix@${args[1]}`);
      fixes.push(args);
      return changeAt(3, wf, statusOf(1), { label: "Fix it" });
    };
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    store.getState().registerFlush(async () => {
      log.push("flush");
      await store.getState().apply(command, store.getState().session);
    });
    const fix = { title: "Fix it", path: "main.nf", edits: [] };
    const outcome = await store
      .getState()
      .applyFix(fix, 1, store.getState().session, { label: "Fix it" });
    expect(outcome.ok).toBe(true);
    expect(log).toEqual(["flush", "apply@1", "applyFix@1"]);
    expect(fixes[0]?.[2]).toEqual({ label: "Fix it" });
    expect(store.getState().summary?.revision).toBe(3);
    expect(store.getState().history).toEqual(statusOf(1));
    // a fix from a project that is no longer shown never reaches the engine
    const old = store.getState().session;
    await store.getState().show(summaryOf(wf), "project");
    const refused = await store.getState().applyFix(fix, 1, old);
    expect(refused.ok === false && refused.code).toBe("no-project");
    expect(log.filter((l) => l.startsWith("applyFix"))).toHaveLength(1);
  });

  it("F-309 UX-20: openFile adds one Code-only file tab per path; activating it loads no projection and clears the selection", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, calls } = fake(wf);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().select("main.nf#/x");
    expect(store.getState().selected).not.toBeNull();
    const before = calls.length;
    await store.getState().openFile("modules/local/legacy_count/main.nf");
    await store.getState().openFile("modules/local/legacy_count/main.nf");
    const s = store.getState();
    const files = s.tabs.filter((t) => t.kind === "file");
    expect(files).toEqual([
      {
        id: "file:modules/local/legacy_count/main.nf",
        kind: "file",
        path: "modules/local/legacy_count/main.nf",
        workflow: null,
        label: "legacy_count/main.nf",
        title: "modules/local/legacy_count/main.nf",
        mode: "code",
        readOnly: null,
      },
    ]);
    expect(s.activeTab).toBe(files[0]?.id);
    expect(s.content.status).toBe("empty");
    expect(s.selected).toBeNull();
    expect(calls).toHaveLength(before);
    // back to the workflow tab loads it again; the file tab stays
    await store.getState().selectTab("main.nf#");
    expect(store.getState().content.status).toBe("ready");
    expect(store.getState().tabs.map((t) => t.id)).toEqual([
      "main.nf#",
      "file:modules/local/legacy_count/main.nf",
    ]);
    // another file name is the label as it is
    await store.getState().openFile("nextflow.config");
    expect(store.getState().tabs.at(-1)?.label).toBe("nextflow.config");
  });

  it("F-309 UX-20: openFile on a .nf file that has a workflow opens that workflow's canvas tab instead", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    await store.getState().openFile("lib.nf");
    expect(store.getState().activeTab).toBe("lib.nf#LIB");
    expect(store.getState().tabs.some((t) => t.kind === "file")).toBe(false);
    expect(store.getState().content.status).toBe("ready");
  });

  it("F-309: a change with a file tab active re-projects nothing", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, calls } = fake(wf);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().openFile("conf/base.config");
    const before = calls.length;
    await store.getState().changed({
      revision: 2,
      workflows: wf,
      files: [{ path: "conf/base.config" }],
      history: EMPTY_HISTORY,
    } as never);
    expect(calls).toHaveLength(before);
    expect(store.getState().activeTab).toBe("file:conf/base.config");
    expect(store.getState().summary?.revision).toBe(2);
  });

  it("F-309 UX-20 F-209: a change that deletes a file closes its file tab, and the previous tab takes over when it was active", async () => {
    const wf = [ref("main.nf", null)];
    const store = createCanvasStore(() => fake(wf).engine);
    await store.getState().open(request);
    await store.getState().openFile("modules/a.nf");
    await store.getState().openFile("modules/b.nf");
    const change = (files: { path: string; text: string | null }[]) =>
      ({
        revision: 2,
        workflows: wf,
        files,
        history: EMPTY_HISTORY,
      }) as never;
    // a background file tab goes without moving the active one
    await store
      .getState()
      .changed(change([{ path: "modules/a.nf", text: null }]));
    expect(store.getState().tabs.map((t) => t.id)).toEqual([
      "main.nf#",
      "file:modules/b.nf",
    ]);
    expect(store.getState().activeTab).toBe("file:modules/b.nf");
    // an edited (not deleted) file keeps its tab
    await store
      .getState()
      .changed(change([{ path: "modules/b.nf", text: "x" }]));
    expect(store.getState().tabs).toHaveLength(2);
    // the active file tab goes: the previous tab, with its canvas, takes over
    await store
      .getState()
      .changed(change([{ path: "modules/b.nf", text: null }]));
    expect(store.getState().tabs.map((t) => t.id)).toEqual(["main.nf#"]);
    expect(store.getState().activeTab).toBe("main.nf#");
    expect(store.getState().content.status).toBe("ready");
  });

  it("F-210 UX-20: closeTab closes a file tab and activates its previous neighbour, else the next, else none; workflow tabs stay", async () => {
    const wf = [ref("main.nf", null)];
    const { engine, calls } = fake(wf);
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store.getState().openFile("a.config");
    await store.getState().openFile("b.config");
    await store.getState().openFile("c.config");
    // a background tab goes without moving the active one
    await store.getState().closeTab("file:a.config");
    expect(store.getState().activeTab).toBe("file:c.config");
    // the active tab goes: the previous tab takes over
    await store.getState().closeTab("file:c.config");
    expect(store.getState().activeTab).toBe("file:b.config");
    // a workflow tab can't be closed here
    await store.getState().closeTab("main.nf#");
    expect(store.getState().tabs.map((t) => t.id)).toEqual([
      "main.nf#",
      "file:b.config",
    ]);
    await store.getState().closeTab("file:b.config");
    expect(store.getState().activeTab).toBe("main.nf#");
    expect(store.getState().content.status).toBe("ready");
    // the first tab goes when it is active: the next takes over, and with none left nothing is active
    await store.getState().openFile("d.config");
    await store.getState().selectTab("file:d.config");
    await store.getState().closeTab("file:d.config");
    expect(store.getState().activeTab).toBe("main.nf#");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("F-210 IO-02: a .nf-builder/ file tab is read-only, any other is not", async () => {
    const store = createCanvasStore(() => fake([ref("main.nf", null)]).engine);
    await store.getState().open(request);
    await store.getState().openFile(".nf-builder/layout.json");
    await store.getState().openFile("README.md");
    const byPath = Object.fromEntries(
      store.getState().tabs.map((t) => [t.path, t.readOnly]),
    );
    expect(byPath).toEqual({
      "main.nf": null,
      ".nf-builder/layout.json": "managed",
      "README.md": null,
    });
  });

  it("F-309 AR-30: revealCode and focusOn record requests with rising sequence numbers, holding offsets and ids, never text", async () => {
    const store = createCanvasStore(() => fake([ref("main.nf", null)]).engine);
    await store.getState().open(request);
    expect(store.getState().reveal).toBeNull();
    store.getState().revealCode("main.nf", { start: 3, end: 9 });
    store.getState().revealCode("main.nf", { start: 3, end: 9 });
    expect(store.getState().reveal).toEqual({
      path: "main.nf",
      start: 3,
      end: 9,
      seq: 2,
    });
    store.getState().focusOn("main.nf#/x");
    store.getState().focusOn("main.nf#/x");
    expect(store.getState().focusNode).toEqual({ id: "main.nf#/x", seq: 4 });
    // sequence numbers keep rising across projects
    await store.getState().show(summaryOf([ref("main.nf", null)]));
    expect(store.getState().reveal).toBeNull();
    store.getState().revealCode("main.nf", { start: 0, end: 1 });
    expect(store.getState().reveal?.seq).toBe(5);
  });
});

describe("F-703 read-only canvas store", () => {
  const wf = [ref("main.nf", null)];
  const stored: Positions = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };

  it("F-703 UX-04 AR-24 AR-23: read-only apply, undo and redo are refused with code read-only without calling the engine", async () => {
    const { engine, log } = historic(wf, {});
    const store = createCanvasStore(
      () => engine,
      () => true,
    );
    await store.getState().open(request);
    const outcomes = [
      await store.getState().apply(command),
      await store.getState().undo(),
      await store.getState().redo(),
    ];
    for (const o of outcomes) {
      expect(o.ok).toBe(false);
      if (o.ok) continue;
      expect(o.code).toBe("read-only");
      expect(o.message).toBe(
        "Editing needs a larger screen or a wider window.",
      );
    }
    expect(log).toEqual([]);
  });

  it("F-703 UX-04 F-309: a read-only quick fix is refused with code read-only without calling the engine", async () => {
    const calls: string[] = [];
    const engine = {
      ...fake(wf).engine,
      applyFix: async () => {
        calls.push("applyFix");
        return changeAt(2, wf);
      },
    } as unknown as EngineApi;
    const store = createCanvasStore(
      () => engine,
      () => true,
    );
    await store.getState().open(request);
    const outcome = await store
      .getState()
      .applyFix({ title: "x", path: "main.nf", edits: [] }, 1);
    expect(outcome.ok === false && outcome.code).toBe("read-only");
    expect(calls).toEqual([]);
  });

  it("F-703 UX-04 F-207: read-only placements are shown but never saved, and moves are ignored", async () => {
    const { engine, writes } = fake(wf, {
      positions: stored,
      nodes: ["a", "b", "c"],
    });
    const store = createCanvasStore(
      () => engine,
      () => true,
    );
    await store.getState().open(request);
    await store.getState().moveNodes({ a: { x: 50, y: 50 } });
    await store.getState().placeNodes(
      { tab: "main.nf#", revision: 1 },
      {
        positions: { c: { x: 9, y: 9 } },
        saved: { c: { x: 9, y: 9 } },
        replace: false,
        notice: null,
      },
    );
    const c = store.getState().content;
    if (c.status !== "ready") throw new Error("not ready");
    expect(c.positions).toEqual({ ...stored, c: { x: 9, y: 9 } });
    expect(writes).toEqual([]);
  });

  it("F-703 F-209: flushEdits awaits every registered code-pane flush, and one failing flush doesn't stop the others", async () => {
    const store = createCanvasStore(() => fake(wf).engine);
    const done: string[] = [];
    store.getState().registerFlush(async () => {
      throw new Error("boom");
    });
    store.getState().registerFlush(async () => {
      await new Promise((r) => setTimeout(r, 5));
      done.push("b");
    });
    await expect(store.getState().flushEdits()).resolves.toBeUndefined();
    expect(done).toEqual(["b"]);
  });

  it("F-703: once editable again, apply reaches the engine", async () => {
    const { engine, log } = historic(wf, {
      apply: async (r) => changeAt(r + 1, wf),
    });
    let readOnly = true;
    const store = createCanvasStore(
      () => engine,
      () => readOnly,
    );
    await store.getState().open(request);
    await store.getState().apply(command);
    expect(log).toEqual([]);
    readOnly = false;
    const outcome = await store.getState().apply(command);
    expect(outcome.ok).toBe(true);
    expect(log).toEqual(["apply@1"]);
  });
});

describe("F-301 addFromPalette", () => {
  const wf = [ref("main.nf", null)];
  const NODE = "main.nf#/NEW_PROCESS@1";
  const callNode = (id: string) => ({
    id,
    kind: "call",
    label: id.slice(id.indexOf("/") + 1, id.indexOf("@")),
    callee: { status: "unparsed" },
    inputs: [],
    outputs: [],
  });

  /** A fake engine where an addCall makes the node appear and bumps the revision. */
  function adding(
    options: {
      refuseCall?: boolean;
      name?: string;
      fresh?: EngineRefusal;
    } = {},
  ) {
    const name = options.name ?? "NEW_PROCESS";
    const log: string[] = [];
    const applies: { command: { kind: string }; options: unknown }[] = [];
    const writes: LayoutWrite[] = [];
    let revision = 1;
    let called = false;
    const engine = {
      open: async () => summaryOf(wf),
      project: async (): Promise<ProjectionResult> => ({
        revision,
        projection: {
          ...projectionOf(wf[0] as WorkflowRef),
          nodes: called ? [callNode(`main.nf#/${name}@1`)] : [],
        } as never,
        positions: {},
      }),
      freshName: async (request: { kind: string; caller: string }) => {
        log.push(`fresh:${request.kind}:${request.caller}`);
        return (
          options.fresh ?? {
            revision,
            name,
            path: `modules/local/${name.toLowerCase()}/main.nf`,
          }
        );
      },
      apply: async (
        command: { kind: string },
        rev: number,
        applyOptions: unknown,
      ) => {
        log.push(`${command.kind}@${rev}`);
        applies.push({ command, options: applyOptions });
        if (options.refuseCall && command.kind === "addCall")
          return {
            ok: false,
            revision: rev,
            code: "refused",
            message: "Already called.",
            path: "main.nf",
            problems: [],
          };
        revision = rev + 1;
        if (command.kind === "addCall") called = true;
        return changeAt(revision, wf);
      },
      undo: async (rev: number) => {
        log.push(`undo@${rev}`);
        revision = rev + 1;
        called = false;
        return changeAt(revision, wf, statusOf(0, 1), { label: "x" });
      },
      history: async () => EMPTY_HISTORY,
      setLayout: async (write: LayoutWrite) => {
        log.push("setLayout");
        writes.push(write);
        return {
          revision: write.revision,
          files: [{ path: ".nf-builder/layout.json", text: "{}" }],
          layout: { state: "ok", message: null },
        };
      },
      details: async (_p: string, _w: string | null, node: string) => {
        log.push(`details:${node}`);
        return { revision, details: { node, diagnostics: [] } };
      },
    } as unknown as EngineApi;
    return { engine, log, applies, writes };
  }
  const where = { x: 400, y: 300 };

  it("F-301 UX-15 AR-23: addFromPalette asks for a fresh name, then applies create and addCall under one group with the step label", async () => {
    const { engine, log, applies } = adding();
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const out = await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(out).toEqual({
      ok: true,
      name: "NEW_PROCESS",
      path: "modules/local/new_process/main.nf",
      node: NODE,
    });
    expect(log.slice(0, 3)).toEqual([
      "fresh:process:main.nf",
      "createProcess@1",
      "addCall@2",
    ]);
    expect(applies.map((a) => a.command)).toEqual([
      { kind: "createProcess", name: "NEW_PROCESS", caller: "main.nf" },
      {
        kind: "addCall",
        target: { path: "main.nf", workflow: null },
        callee: "NEW_PROCESS",
      },
    ]);
    const [first, second] = applies.map((a) => a.options as { group: string });
    expect(first?.group).toMatch(/^palette-/);
    expect(second?.group).toBe(first?.group);
    expect(first).toMatchObject({ label: "Add process NEW_PROCESS" });
    expect(store.getState().selected).toBe(NODE);
  });

  it("F-301 UX-15: a workflow item creates a workflow and labels the step", async () => {
    const { engine, applies } = adding({ name: "NEW_WORKFLOW" });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store
      .getState()
      .addFromPalette({ item: "workflow", tab: "main.nf#", at: null });
    expect(applies[0]?.command.kind).toBe("createWorkflow");
    expect(applies[0]?.options).toMatchObject({
      label: "Add workflow NEW_WORKFLOW",
    });
  });

  it("F-301 ADR-0052: the new node's position is in content.positions in the same update as the projection, and setLayout is called with it", async () => {
    const { engine, writes } = adding();
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const seen: { has: boolean; placed: boolean }[] = [];
    store.subscribe((state) => {
      if (state.content.status !== "ready") return;
      const has = state.content.projection.nodes.some((n) => n.id === NODE);
      seen.push({ has, placed: state.content.positions[NODE] !== undefined });
    });
    await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(seen.some((s) => s.has)).toBe(true);
    expect(seen.filter((s) => s.has && !s.placed)).toEqual([]);
    const c = store.getState().content;
    if (c.status !== "ready") throw new Error("not ready");
    const at = c.positions[NODE] as { x: number; y: number };
    // the centre of the estimated box is the drop point
    const box = canvasView(c.projection, { portLabels: true }).nodes[0];
    expect(at).toEqual({
      x: Math.round(where.x - (box?.width ?? 0) / 2),
      y: Math.round(where.y - (box?.height ?? 0) / 2),
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.positions).toEqual({ [NODE]: at });
    expect(writes[0]?.replace).toBe(false);
  });

  it("F-301 UX-15: a placed add sets refit false; a later change sets it true again", async () => {
    const { engine } = adding();
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const refit = () => {
      const c = store.getState().content;
      if (c.status !== "ready") throw new Error("not ready");
      return c.refit;
    };
    expect(refit()).toBe(true);
    await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(refit()).toBe(false);
    await store.getState().changed({
      revision: 9,
      files: [],
      workflows: wf,
      history: EMPTY_HISTORY,
    } as never);
    expect(refit()).toBe(true);
  });

  it("F-301: with at null no placement is recorded", async () => {
    const { engine, writes } = adding();
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: null });
    const c = store.getState().content;
    if (c.status !== "ready") throw new Error("not ready");
    expect(c.positions[NODE]).toBeUndefined();
    expect(c.refit).toBe(true);
    expect(writes).toEqual([]);
  });

  it("F-301 AR-23: when addCall is refused after create, the store undoes once and returns the refusal", async () => {
    const { engine, log } = adding({ refuseCall: true });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const out = await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(log.slice(1)).toEqual(["createProcess@1", "addCall@2", "undo@2"]);
    expect(out).toEqual({
      ok: false,
      message: "Couldn't add NEW_PROCESS: Already called. Nothing was changed.",
    });
    expect(store.getState().selected).toBeNull();
  });

  it("F-301: addFromPalette refuses with no project, a file tab, an older session or an item with no action, and calls no engine method", async () => {
    const { engine, log } = adding();
    const store = createCanvasStore(() => engine);
    const add = (item: string, tab = "main.nf#", session?: number) =>
      store.getState().addFromPalette({ item, tab, at: where }, session);
    expect(await add("process")).toEqual({
      ok: false,
      message: "Open or create a project to add components.",
    });
    await store.getState().open(request);
    await store.getState().openFile("README.md");
    expect(await add("process", "file:README.md")).toEqual({
      ok: false,
      message: "Open a workflow tab to add components to it.",
    });
    expect(await add("channel:fromPath")).toEqual({
      ok: false,
      message: "That item can't be added from the palette yet.",
    });
    expect(await add("process", "main.nf#", 0)).toMatchObject({ ok: false });
    expect(log).toEqual([]);
  });

  it("F-301 F-703 UX-04: a read-only add is refused with the read-only message and calls no engine method", async () => {
    const { engine, log } = adding();
    const store = createCanvasStore(
      () => engine,
      () => true,
    );
    await store.getState().open(request);
    const out = await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(out).toEqual({
      ok: false,
      message: "Editing needs a larger screen or a wider window.",
    });
    expect(log).toEqual([]);
  });

  it("F-301 AR-23: a refused fresh name returns its message and applies nothing", async () => {
    const { engine, log } = adding({
      fresh: {
        ok: false,
        revision: null,
        code: "not-found",
        message: "No such file.",
        path: null,
        problems: [],
      },
    });
    const store = createCanvasStore(() => engine);
    await store.getState().open(request);
    const out = await store
      .getState()
      .addFromPalette({ item: "process", tab: "main.nf#", at: where });
    expect(out).toEqual({ ok: false, message: "No such file." });
    expect(log).toEqual(["fresh:process:main.nf"]);
  });
});
