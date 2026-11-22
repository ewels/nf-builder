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
  createWorkspaceStore,
  defaultWorkflow,
  tabFor,
} from "../src/workspace/workspace-store";

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
    gates?: Map<string, Promise<void>>;
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
        revision: 1,
        projection:
          found === undefined || key === options.nullFor
            ? null
            : projectionOf(found),
      };
    },
  } as unknown as EngineApi;
  return { engine, calls };
}

const request = { version: "26.10", files: [] };

describe("F-205 workspace store", () => {
  it("F-205 UX-20: opening a project opens main.nf's entry workflow as the only tab and loads its projection", async () => {
    const wf = [ref("lib.nf", "LIB"), ref("main.nf", null)];
    const store = createWorkspaceStore(() => fake(wf).engine);
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
    const store = createWorkspaceStore(() => fake([]).engine);
    await store.getState().open(request);
    expect(store.getState().tabs).toEqual([]);
    expect(store.getState().content.status).toBe("empty");
  });

  it("F-205 UX-20: openWorkflow adds a tab once and focuses it; selectTab loads that tab", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    const { engine, calls } = fake(wf);
    const store = createWorkspaceStore(() => engine);
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

  it("F-205: a projection for a superseded tab or revision is ignored", async () => {
    const wf = [ref("main.nf", null), ref("lib.nf", "LIB")];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine } = fake(wf, { gates: new Map([["lib.nf#LIB", gate]]) });
    const store = createWorkspaceStore(() => engine);
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
    const refused = createWorkspaceStore(
      () => fake(wf, { refuse: true }).engine,
    );
    await refused.getState().open(request);
    expect(refused.getState().content).toEqual({
      status: "unavailable",
      message: "No project is open.",
    });
    const nulled = createWorkspaceStore(
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
    const store = createWorkspaceStore(() => fake([]).engine);
    expect(store.getState().portLabels).toBe(true);
    store.getState().setPortLabels(false);
    expect(store.getState().portLabels).toBe(false);
  });
});
