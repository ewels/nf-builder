import {
  type DeclaredPlugin,
  EMPTY_HISTORY,
  type EngineApi,
  type PluginScopes,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import type { RegistryClient, RegistryIndex } from "@nf-builder/sources";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createPluginStore } from "../src/registry/plugin-store";

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
const declare = (id: string, version: string | null): DeclaredPlugin => ({
  id,
  version,
  range,
});
const spec = (
  id: string,
  version: string,
): Awaited<ReturnType<RegistryClient["plugin"]>> => ({
  format: 1,
  id,
  version,
  requires: null,
  description: "",
  definitions: [
    { type: "ConfigScope", spec: { name: "validation", children: [] } },
    { type: "Function", spec: { name: "validate" } },
  ],
});
const listed = (
  id: string,
  version: string,
  definitions: number,
  projectUrl: string | null = null,
) => ({
  id,
  version,
  requires: null,
  summary: "",
  provider: null,
  projectUrl,
  definitions,
});

function setup() {
  let revision = 1;
  let declared: DeclaredPlugin[] = [];
  const sent: PluginScopes[][] = [];
  const reads: string[] = [];
  let failing = false;
  let projectUrl: string | null = null;
  let scopesFail = false;
  const engine = {
    plugins: async () => ({ revision, plugins: declared }),
    setPluginScopes: async (scopes: PluginScopes[]) => {
      if (scopesFail) throw new Error("Worker is gone.");
      sent.push(scopes);
      return { pluginsKey: "" };
    },
  } as unknown as EngineApi;
  const registry = {
    index: async () =>
      ({
        plugins: [
          listed("nf-schema", "3.1.0", 21, projectUrl),
          listed("nf-ffq", "0.2.0", 0),
        ],
      }) as unknown as RegistryIndex,
    plugin: async (id: string, version: string) => {
      reads.push(`${id}@${version}`);
      if (failing) throw new Error("Spec read failed.");
      return spec(id, version);
    },
  };
  const workspace = createCanvasStore(() => engine);
  const queue: (() => void)[] = [];
  const plugins = createPluginStore({
    engine: () => engine,
    workspace,
    registry: () => registry,
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
  return {
    workspace,
    plugins,
    sent,
    reads,
    settle,
    bump,
    declare: (...d: DeclaredPlugin[]) => {
      declared = d;
    },
    fail: (v: boolean) => {
      failing = v;
    },
    url: (v: string | null) => {
      projectUrl = v;
    },
    failScopes: (v: boolean) => {
      scopesFail = v;
    },
  };
}

describe("plugin store", () => {
  it("F-505 IO-33: the store reads the declared plugin's spec, picks the index version when the declared one differs, skips definitions 0, and sends scopes once per key", async () => {
    const t = setup();
    t.declare(
      declare("nf-schema", "3.1.0"),
      declare("nf-prov", null),
      declare("nf-ffq", "0.2.0"),
    );
    await t.workspace.getState().show(summaryAt(1));
    await t.settle();
    const state = t.plugins.getState();
    expect(state.revision).toBe(1);
    expect(state.declared.map((d) => d.id)).toEqual([
      "nf-schema",
      "nf-prov",
      "nf-ffq",
    ]);
    expect(state.specs.map((s) => [s.id, s.version, s.approximate])).toEqual([
      ["nf-schema", "3.1.0", false],
    ]);
    expect(t.reads).toEqual(["nf-schema@3.1.0"]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.[0]).toMatchObject({ id: "nf-schema", version: "3.1.0" });
    expect(t.sent[0]?.[0]?.nodes).toHaveLength(1);
    expect(state.pluginsKey).toBe("nf-schema@3.1.0");

    // a new revision with the same plugins reads and sends nothing
    await t.bump();
    await t.settle();
    expect(t.plugins.getState().revision).toBe(2);
    expect(t.reads).toHaveLength(1);
    expect(t.sent).toHaveLength(1);

    // another declared version: the index version's spec, marked approximate, same key so no new send
    t.declare(declare("nf-schema", "2.5.1"));
    await t.bump();
    await t.settle();
    expect(
      t.plugins.getState().specs.map((s) => [s.version, s.approximate]),
    ).toEqual([["3.1.0", true]]);
    expect(t.reads).toHaveLength(1);
    expect(t.sent).toHaveLength(1);

    // removed: the scopes are cleared
    t.declare();
    await t.bump();
    await t.settle();
    expect(t.plugins.getState().specs).toEqual([]);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]).toEqual([]);
    expect(t.plugins.getState().pluginsKey).toBe("");
  });

  it("F-505 IO-33: a failed spec read is a failure on that plugin and is read again at the next revision", async () => {
    const t = setup();
    t.fail(true);
    t.declare(declare("nf-schema", "3.1.0"));
    await t.workspace.getState().show(summaryAt(1));
    await t.settle();
    expect(t.plugins.getState().specs).toEqual([]);
    expect(t.plugins.getState().failures).toEqual([
      { id: "nf-schema", message: "Spec read failed." },
    ]);
    t.fail(false);
    await t.bump();
    await t.settle();
    expect(t.plugins.getState().failures).toEqual([]);
    expect(t.plugins.getState().specs).toHaveLength(1);
  });

  it("F-505 FI-04: only an https project URL is kept; http, data, javascript and malformed ones become no link", async () => {
    const cases: [string | null, string | null][] = [
      ["https://example.org/nf-schema", "https://example.org/nf-schema"],
      ["http://example.org/nf-schema", null],
      ["data:text/html,<b>x</b>", null],
      ["javascript:alert(1)", null],
      ["not a url", null],
      [null, null],
    ];
    for (const [given, kept] of cases) {
      const t = setup();
      t.url(given);
      t.declare(declare("nf-schema", "3.1.0"));
      await t.workspace.getState().show(summaryAt(1));
      await t.settle();
      expect(t.plugins.getState().specs[0]?.projectUrl).toBe(kept);
      expect(t.sent[0]?.[0]?.projectUrl).toBe(kept);
    }
  });

  it("F-505 IO-33: the declared list is published even when the worker rejects the scopes", async () => {
    const t = setup();
    t.failScopes(true);
    t.declare(declare("nf-schema", "3.1.0"));
    await t.workspace.getState().show(summaryAt(1));
    await t.settle();
    expect(t.plugins.getState().declared.map((d) => d.id)).toEqual([
      "nf-schema",
    ]);
    expect(t.plugins.getState().revision).toBe(1);
  });
});
