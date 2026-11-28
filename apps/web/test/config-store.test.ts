import {
  type ConfigSchema,
  type ConfigView,
  EMPTY_HISTORY,
  type EngineApi,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createConfigStore } from "../src/config/config-store";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const entry: WorkflowRef = {
  path: "main.nf",
  name: null,
  modelled: true,
  typed: true,
  range,
};
const summaryAt = (revision: number): ProjectSummary => ({
  revision,
  version: "26.10",
  files: [],
  workflows: [entry],
  layout: { state: "absent", message: null },
});
const viewAt = (path: string, marker: number): ConfigView => ({
  path,
  status: "modelled",
  editable: true,
  context: { profile: null, selector: null },
  items: [
    {
      kind: "code",
      key: `code:${marker}`,
      range,
      text: `x${marker}`,
      reason: "value",
      problems: [],
    },
  ],
});
const schema: ConfigSchema = {
  version: "26.10",
  scopes: [],
  forms: { scopes: [], maps: {} },
};

function setup(
  options: { gate?: (call: number) => Promise<void> | undefined } = {},
) {
  const calls: string[] = [];
  let revision = 1;
  let pulls = 0;
  const engine = {
    open: async () => summaryAt(revision),
    project: async () => ({
      revision,
      projection: { workflow: entry, nodes: [], edges: [], statements: [] },
    }),
    history: async () => EMPTY_HISTORY,
    configSchema: async (version: string) => {
      calls.push(`schema ${version}`);
      return schema;
    },
    configView: async (path: string) => {
      const call = ++pulls;
      calls.push(`view ${path}`);
      const at = revision;
      await options.gate?.(call);
      return { revision: at, view: viewAt(path, at) };
    },
  } as unknown as EngineApi;
  const workspace = createCanvasStore(() => engine);
  const queue: (() => void)[] = [];
  const config = createConfigStore({
    engine: () => engine,
    workspace,
    schedule: (fn) => queue.push(fn),
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      while (queue.length > 0) queue.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const bump = async () => {
    revision += 1;
    await workspace.getState().changed({
      revision,
      workflows: [entry],
      files: [{ path: "nextflow.config", text: "x" }],
      remodelled: [],
      history: EMPTY_HISTORY,
    } as never);
  };
  return { workspace, config, calls, settle, bump };
}

describe("config store", () => {
  it("F-601: opening a config tab pulls its view and the schema once; a new revision pulls the view again", async () => {
    const { workspace, config, calls, settle, bump } = setup();
    await workspace.getState().show(summaryAt(1));
    await settle();
    expect(calls.filter((c) => c.startsWith("view"))).toEqual([]);
    await workspace.getState().openFile("nextflow.config");
    expect(config.getState().tabs["nextflow.config"]?.status).toBe("loading");
    await settle();
    const tab = config.getState().tabs["nextflow.config"];
    expect(tab?.status).toBe("ready");
    expect(tab?.revision).toBe(1);
    expect(config.getState().schema).toBe(schema);
    await bump();
    await settle();
    expect(config.getState().tabs["nextflow.config"]?.revision).toBe(2);
    expect(calls.filter((c) => c.startsWith("schema"))).toEqual([
      "schema 26.10",
    ]);
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(2);
  });

  it("F-601: one pull at a time, and a result for an older revision is dropped", async () => {
    const gates: (() => void)[] = [];
    const { workspace, config, calls, settle, bump } = setup({
      gate: (call) =>
        call === 1 ? new Promise((r) => gates.push(r)) : undefined,
    });
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(1);
    await bump();
    await settle();
    // the first pull is still out: nothing else started
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(1);
    for (const g of gates) g();
    await settle();
    const tab = config.getState().tabs["nextflow.config"];
    expect(tab?.revision).toBe(2);
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(2);
  });

  it("F-601 FI-04: select records one key per tab; toggle collapses and expands a card", async () => {
    const { workspace, config, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    config.getState().select("nextflow.config", "scope:/:process");
    expect(config.getState().tabs["nextflow.config"]?.selected).toBe(
      "scope:/:process",
    );
    config.getState().toggle("nextflow.config", "scope:/:process");
    expect(config.getState().tabs["nextflow.config"]?.toggled).toEqual([
      "scope:/:process",
    ]);
    config.getState().toggle("nextflow.config", "scope:/:process");
    expect(config.getState().tabs["nextflow.config"]?.toggled).toEqual([]);
  });

  it("F-601: editInCode switches the tab to Split and records a reveal for the range", async () => {
    const { workspace, config, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    config
      .getState()
      .editInCode("nextflow.config", { ...range, start: 4, end: 9 });
    const tab = workspace
      .getState()
      .tabs.find((t) => t.id === "config:nextflow.config");
    expect(tab?.mode).toBe("split");
    expect(workspace.getState().reveal).toMatchObject({
      path: "nextflow.config",
      start: 4,
      end: 9,
    });
  });

  it("F-601 F-703: while read-only, editInCode neither changes the mode nor asks for the code", async () => {
    const calls = setup();
    const readOnly = createConfigStore({
      engine: () => ({}) as EngineApi,
      workspace: calls.workspace,
      schedule: () => undefined,
      readOnly: () => true,
    });
    await calls.workspace.getState().show(summaryAt(1));
    await calls.workspace.getState().openFile("nextflow.config");
    readOnly.getState().editInCode("nextflow.config", { ...range, end: 3 });
    expect(
      calls.workspace
        .getState()
        .tabs.find((t) => t.id === "config:nextflow.config")?.mode,
    ).toBe("graph");
    expect(calls.workspace.getState().reveal).toBeNull();
  });
});
