import {
  type ConfigSchema,
  type ConfigView,
  EMPTY_HISTORY,
  type EngineApi,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
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
  pluginsKey: "",
  scopes: [],
  forms: { scopes: [], maps: {} },
};

function setup(
  options: {
    gate?: (call: number) => Promise<void> | undefined;
    apply?: () => unknown;
  } = {},
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
    apply: async (command: { kind: string }) => {
      calls.push(`apply ${command.kind}`);
      return (
        options.apply?.() ?? {
          ok: true,
          revision: revision + 1,
          files: [],
          remodelled: [],
          workflows: [entry],
          history: EMPTY_HISTORY,
          patches: [],
          inverse: [],
        }
      );
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
  const plugins = createStore<{ pluginsKey: string }>()(() => ({
    pluginsKey: "",
  }));
  const config = createConfigStore({
    engine: () => engine,
    workspace,
    pluginsKey: plugins,
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
  workspace.getState().registerFlush(async () => {
    calls.push("flush");
  });
  return { workspace, config, calls, settle, bump, plugins };
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

  it("F-505 FI-01: a new plugin scopes key pulls the schema and the open views again without a new revision", async () => {
    const { workspace, config, calls, settle, plugins } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(1);
    plugins.setState({ pluginsKey: "nf-schema@3.1.0" });
    await settle();
    expect(calls.filter((c) => c.startsWith("view"))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith("schema"))).toHaveLength(2);
    expect(config.getState().tabs["nextflow.config"]?.status).toBe("ready");
    plugins.setState({ pluginsKey: "nf-schema@3.1.0" });
    await settle();
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

const top = { profile: null, selector: null };

describe("config store edits", () => {
  it("F-601 F-209: set flushes pending code, then sends one setConfigOption through the canvas store", async () => {
    const { workspace, config, calls, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    const before = calls.length;
    const outcome = await config
      .getState()
      .set("nextflow.config", top, ["process", "memory"], {
        kind: "memory",
        amount: 8,
        unit: "GB",
      });
    expect(outcome?.ok).toBe(true);
    expect(calls.slice(before)).toEqual(["flush", "apply setConfigOption"]);
    expect(config.getState().tabs["nextflow.config"]?.notice).toBe(
      "Set process.memory",
    );
  });

  it("F-601: remove, addBlock, addPlugin and removePlugin send their commands", async () => {
    const { workspace, config, calls, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    const before = calls.length;
    const s = config.getState();
    await s.remove("nextflow.config", top, ["docker", "enabled"]);
    await s.addBlock("nextflow.config", top, ["process"]);
    await s.addPlugin("nextflow.config", "nf-schema@2.5.1");
    await s.removePlugin("nextflow.config", "nf-schema@2.5.1");
    expect(calls.slice(before).filter((c) => c.startsWith("apply"))).toEqual([
      "apply removeConfigOption",
      "apply addConfigBlock",
      "apply addConfigPlugin",
      "apply removeConfigPlugin",
    ]);
  });

  it("F-601: a refusal becomes the tab's notice and pulls the view again at the same revision", async () => {
    const refused = {
      ok: false,
      revision: 1,
      code: "does-not-parse",
      message: "nextflow.config has errors that this edit can't work around.",
      path: "nextflow.config",
      problems: [],
    };
    const { workspace, config, calls, settle } = setup({
      apply: () => refused,
    });
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    const views = () => calls.filter((c) => c.startsWith("view")).length;
    const before = views();
    const outcome = await config
      .getState()
      .set("nextflow.config", top, ["cleanup"], {
        kind: "boolean",
        value: true,
      });
    expect(outcome?.ok).toBe(false);
    expect(config.getState().tabs["nextflow.config"]?.notice).toBe(
      refused.message,
    );
    await settle();
    expect(views()).toBe(before + 1);
  });

  it("F-601: a pending row is UI state until its value is committed, and goes when it is committed or discarded", async () => {
    const { workspace, config, settle } = setup();
    await workspace.getState().show(summaryAt(1));
    await workspace.getState().openFile("nextflow.config");
    await settle();
    const row = {
      key: "pending:::cleanup",
      context: top,
      option: ["cleanup"],
      valueKind: "boolean" as const,
    };
    config.getState().addPending("nextflow.config", row);
    config.getState().addPending("nextflow.config", row);
    expect(config.getState().tabs["nextflow.config"]?.pending).toEqual([row]);
    await config.getState().set("nextflow.config", top, ["cleanup"], {
      kind: "boolean",
      value: true,
    });
    expect(config.getState().tabs["nextflow.config"]?.pending).toEqual([]);
    config.getState().addPending("nextflow.config", row);
    config.getState().discardPending("nextflow.config", row.key);
    expect(config.getState().tabs["nextflow.config"]?.pending).toEqual([]);
  });
});
