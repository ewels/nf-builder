import type {
  EngineApi,
  EngineRefusal,
  Projection,
  ProjectionResult,
  ProjectSummary,
  WorkflowRef,
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
        positions: {},
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
    const change = { revision: 2, files: [], remodelled: [], workflows: wf };
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
    await store
      .getState()
      .changed({ revision: 1, files: [], remodelled: [], workflows: [] });
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
    await store
      .getState()
      .changed({ revision: 2, files: [], remodelled: [], workflows: wf });
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
    await store
      .getState()
      .changed({ revision: 2, files: [], remodelled: [], workflows: wf });
    const d = store.getState().details;
    expect(d.status === "ready" && d.revision).toBe(2);
  });

  it("F-206 UX-30: a refresh that leaves no canvas (unparseable) clears the selection", async () => {
    const options: Parameters<typeof fake>[1] = {};
    const store = createCanvasStore(() => fake(wf, options).engine);
    await store.getState().open(request);
    await store.getState().select("a");
    options.nullFor = "main.nf#";
    await store
      .getState()
      .changed({ revision: 2, files: [], remodelled: [], workflows: wf });
    expect(store.getState().content.status).toBe("unavailable");
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
  });
});
