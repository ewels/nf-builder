import {
  EMPTY_HISTORY,
  type EngineApi,
  type ProjectionResult,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";

const range = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};
const wf: WorkflowRef[] = [
  { path: "main.nf", name: null, modelled: true, typed: true, range },
];
const summary: ProjectSummary = {
  revision: 1,
  version: "26.10",
  files: [],
  workflows: wf,
  layout: { state: "absent", message: null },
};
const A = "main.nf#/A@1";
const B = "main.nf#/B@1";
const C = "main.nf#/C@1";
const changeAt = (revision: number, extra: object = {}) => ({
  ok: true,
  revision,
  files: [{ path: "main.nf", text: "x" }],
  remodelled: ["main.nf"],
  workflows: wf,
  history: EMPTY_HISTORY,
  ...extra,
});
const request = { version: "26.10", files: [] };
const target = { path: "main.nf", workflow: null };

/** A fake engine that records every call; `nodes` are the projection's node ids. */
function setup(
  options: {
    nodes?: () => string[];
    aliases?: { name: string; alias: string; reason: "called" | "taken" }[];
    copyRefusal?: string;
    readOnly?: boolean;
  } = {},
) {
  const calls: { name: string; args: unknown[] }[] = [];
  let revision = 1;
  const note = (name: string, ...args: unknown[]) => calls.push({ name, args });
  const engine = {
    open: async () => summary,
    readFile: async () => null,
    project: async (): Promise<ProjectionResult> => ({
      revision,
      projection: {
        workflow: wf[0],
        nodes: (options.nodes?.() ?? [A, B, C]).map((id) => ({ id })),
        edges: [],
        statements: [],
      } as never,
      positions: { [A]: { x: 10, y: 20 }, [B]: { x: 300, y: 40 } },
    }),
    details: async (_p: string, _w: string | null, node: string) => {
      note("details", node);
      return { revision, details: { node } };
    },
    apply: async (command: unknown, rev: number) => {
      note("apply", command, rev);
      revision = rev + 1;
      return changeAt(revision);
    },
    copy: async (req: unknown) => {
      note("copy", req);
      if (options.copyRefusal !== undefined)
        return {
          ok: false,
          revision: 1,
          code: "invalid",
          message: options.copyRefusal,
          path: null,
          problems: [],
        };
      return {
        revision,
        summary: {
          nodes: 2,
          connections: 1,
          labels: ["A", "B"],
          languageVersion: "26.10",
        },
      };
    },
    planPaste: async (req: unknown) => {
      note("planPaste", req);
      return { revision, aliases: options.aliases ?? [] };
    },
    paste: async (req: unknown, rev: number) => {
      note("paste", req, rev);
      revision = rev + 1;
      return changeAt(revision, { pasted: [A, B] });
    },
    history: async () => EMPTY_HISTORY,
    setLayout: async () => ({
      revision,
      files: [],
      layout: { state: "ok", message: null },
    }),
  } as unknown as EngineApi;
  const store = createCanvasStore(
    () => engine,
    () => options.readOnly === true,
  );
  const names = () => calls.map((c) => c.name);
  return { store, calls, names };
}

describe("F-310 selection", () => {
  it("F-310 UX-26: selectNodes keeps several ids and `selected` is null with two", async () => {
    const { store, names } = setup();
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    expect(store.getState().selection).toEqual([A, B]);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().details).toEqual({ status: "idle" });
    expect(names()).not.toContain("details");
    await store.getState().selectNodes([B]);
    expect(store.getState().selected).toBe(B);
    expect(store.getState().selection).toEqual([B]);
    await store.getState().selectNodes([]);
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().selected).toBeNull();
  });

  it("F-310 UX-26: select replaces a multi-selection, and a change drops ids that are gone", async () => {
    let present = [A, B, C];
    const { store } = setup({ nodes: () => present });
    await store.getState().open(request);
    await store.getState().selectNodes([A, B, C]);
    present = [A, C];
    await store.getState().changed(changeAt(2) as never);
    expect(store.getState().selection).toEqual([A, C]);
    await store.getState().select(C);
    expect(store.getState().selection).toEqual([C]);
  });
});

describe("F-310 delete", () => {
  it("F-310 AR-23: deleteSelection sends one deleteNodes, keeps the viewport and clears the selection", async () => {
    const { store, calls } = setup();
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    const outcome = await store.getState().deleteSelection();
    expect(outcome.ok).toBe(true);
    expect(calls.filter((c) => c.name === "apply")).toEqual([
      {
        name: "apply",
        args: [{ kind: "deleteNodes", target, nodes: [A, B] }, 1],
      },
    ]);
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().clipboardNotice).toBe("Deleted 2 nodes.");
    const content = store.getState().content;
    expect(content.status === "ready" && content.refit).toBe(false);
  });

  it("F-310 ADR-0056: deleteSelection and paste are refused in read-only with no engine call", async () => {
    const { store, names } = setup({ readOnly: true });
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    expect((await store.getState().deleteSelection()).ok).toBe(false);
    expect((await store.getState().paste(null)).ok).toBe(false);
    expect(names()).not.toContain("apply");
    expect(names()).not.toContain("paste");
    expect(names()).not.toContain("planPaste");
    expect(store.getState().selection).toEqual([A, B]);
  });
});

describe("F-310 copy and paste", () => {
  it("F-310 UX-26 AR-30: copySelection sends the nodes with their positions and keeps only the summary; copy works read-only", async () => {
    const { store, calls } = setup({ readOnly: true });
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    expect((await store.getState().copySelection()).ok).toBe(true);
    expect(calls.find((c) => c.name === "copy")?.args).toEqual([
      {
        path: "main.nf",
        workflow: null,
        nodes: [A, B],
        positions: { [A]: { x: 10, y: 20 }, [B]: { x: 300, y: 40 } },
      },
    ]);
    expect(store.getState().clipboard).toEqual({
      nodes: 2,
      connections: 1,
      labels: ["A", "B"],
      languageVersion: "26.10",
    });
    expect(store.getState().clipboardNotice).toBe("Copied 2 nodes.");
  });

  it("F-310: a refused copy says why and keeps the clipboard", async () => {
    const { store } = setup({ copyRefusal: "X can't be copied yet." });
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    expect((await store.getState().copySelection()).ok).toBe(false);
    expect(store.getState().clipboard).toBeNull();
    expect(store.getState().clipboardNotice).toBe(
      "Couldn't copy: X can't be copied yet.",
    );
  });

  it("F-310 UX-26: paste plans, pastes at the point in one call, selects the pasted nodes and says what it did", async () => {
    const { store, calls } = setup();
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    await store.getState().copySelection();
    await store.getState().selectNodes([]);
    const outcome = await store.getState().paste({ x: 5, y: 6 });
    expect(outcome.ok).toBe(true);
    expect(calls.find((c) => c.name === "paste")?.args).toEqual([
      { target, aliases: [], at: { x: 5, y: 6 } },
      1,
    ]);
    expect(store.getState().selection).toEqual([A, B]);
    expect(store.getState().clipboardNotice).toBe(
      "Pasted 2 nodes and 1 connection.",
    );
    const content = store.getState().content;
    expect(content.status === "ready" && content.refit).toBe(false);
  });

  it("F-310 ADR-0039: paste with aliases waits for the dialog; Cancel sends nothing, Paste sends the aliases", async () => {
    const aliases = [{ name: "A", alias: "A_2", reason: "called" as const }];
    const { store, names, calls } = setup({ aliases });
    await store.getState().open(request);
    await store.getState().selectNodes([A, B]);
    await store.getState().copySelection();
    await store.getState().paste(null);
    expect(store.getState().pendingPaste?.aliases).toEqual(aliases);
    expect(names()).not.toContain("paste");
    store.getState().cancelPaste();
    expect(store.getState().pendingPaste).toBeNull();
    expect(names()).not.toContain("paste");
    await store.getState().paste(null);
    await store.getState().confirmPaste();
    expect(store.getState().pendingPaste).toBeNull();
    expect(calls.find((c) => c.name === "paste")?.args[0]).toEqual({
      target,
      aliases,
      at: null,
    });
  });

  it("F-310: paste with no project refuses without calling the engine", async () => {
    const { store, names } = setup();
    expect((await store.getState().paste(null)).ok).toBe(false);
    expect(names()).toEqual([]);
  });
});

describe("F-310 Auto-layout selected nodes", () => {
  it("F-310 F-207 UX-26: a layout run of the selection moves those nodes on screen and keeps the others where they are", async () => {
    const { store } = setup();
    await store.getState().open(request);
    const tab = store.getState().activeTab ?? "";
    await store.getState().placeNodes(
      { tab, revision: 1 },
      {
        positions: {
          [A]: { x: 10, y: 20 },
          [B]: { x: 10, y: 110 },
          [C]: { x: 999, y: 999 },
        },
        saved: { [B]: { x: 10, y: 110 } },
        replace: false,
        notice: null,
      },
    );
    const content = store.getState().content;
    if (content.status !== "ready") throw new Error("not ready");
    expect(content.positions[B]).toEqual({ x: 10, y: 110 });
    expect(content.positions[A]).toEqual({ x: 10, y: 20 });
    // a node with no stored position takes the run's
    expect(content.positions[C]).toEqual({ x: 999, y: 999 });
  });
});
