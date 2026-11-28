import {
  EMPTY_HISTORY,
  type EngineRefusal,
  type FileSummary,
  type ProjectFiles,
  type ProjectSummary,
  type WorkflowRef,
} from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { createCanvasStore } from "../src/canvas/canvas-store";
import { createFilesStore } from "../src/files/files-store";

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
const file = (path: string, problems = 0): FileSummary => ({
  path,
  language: "nextflow",
  status: problems === 0 ? "modelled" : "partial",
  problems,
});
const FILES = [
  file("main.nf"),
  file("modules/local/a/main.nf"),
  file("README.md"),
];
const summary = (): ProjectSummary => ({
  revision: 1,
  version: "26.10",
  files: FILES,
  workflows: [entry],
  layout: { state: "absent", message: null },
});

interface Pending {
  readonly resolve: (v: ProjectFiles | EngineRefusal) => void;
}

/** A fake engine whose `listFiles` replies when the test says so. */
function setup() {
  const pending: Pending[] = [];
  const calls: string[] = [];
  let outcome: () => unknown = () => ({
    ok: false,
    revision: null,
    code: "invalid",
    message: "No.",
    path: null,
    problems: [],
  });
  const engine = {
    open: async () => summary(),
    project: async () => ({
      revision: 1,
      projection: { workflow: entry, nodes: [], edges: [], statements: [] },
    }),
    history: async () => EMPTY_HISTORY,
    listFiles: () =>
      new Promise<ProjectFiles | EngineRefusal>((resolve) => {
        pending.push({ resolve });
      }),
    apply: async (command: unknown, _revision: number, options: unknown) => {
      calls.push(
        `${JSON.stringify(command)} ${JSON.stringify(options ?? null)}`,
      );
      return outcome();
    },
  } as never;
  const canvas = createCanvasStore(() => engine);
  const listeners = new Set<() => void>();
  const files = createFilesStore({
    engine: () => engine,
    canvas,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
  const reply = (list: readonly FileSummary[] = FILES, registry = []) => {
    const next = pending.shift();
    if (!next) throw new Error("no pending pull");
    next.resolve({ revision: 1, files: list, registry });
    return new Promise((r) => setTimeout(r, 0));
  };
  const show = () => canvas.getState().show(summary());
  const change = () => {
    for (const fn of listeners) fn();
  };
  const setOutcome = (fn: () => unknown) => {
    outcome = fn;
  };
  return { files, canvas, pending, calls, reply, show, change, setOutcome };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("F-210 files store", () => {
  it("F-210 UX-16: showing a project pulls once; a change while visible pulls again, coalesced to one queued pull; a change while hidden pulls when the panel is shown", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    expect(t.pending).toHaveLength(0); // no project yet
    await t.show();
    await tick();
    expect(t.pending).toHaveLength(1);
    expect(t.files.getState().status).toBe("loading");
    // changes during the pull are one queued pull, not three
    t.change();
    t.change();
    t.change();
    expect(t.pending).toHaveLength(1);
    await t.reply();
    expect(t.pending).toHaveLength(1);
    await t.reply();
    expect(t.files.getState().status).toBe("ready");
    expect(t.pending).toHaveLength(0);
    // hidden: a change pulls nothing; showing pulls
    t.files.getState().setVisible(false);
    t.change();
    await tick();
    expect(t.pending).toHaveLength(0);
    t.files.getState().setVisible(true);
    expect(t.pending).toHaveLength(1);
    await t.reply();
    // showing again without a change doesn't pull
    t.files.getState().setVisible(false);
    t.files.getState().setVisible(true);
    expect(t.pending).toHaveLength(0);
  });

  it("F-210 UX-16: a reply for an older request or another session is dropped", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    const stale = t.pending[0];
    // another project shows while the first pull is out
    await t.show();
    await tick();
    stale?.resolve({ revision: 1, files: [file("old.nf")], registry: [] });
    await tick();
    expect(t.files.getState().files).toEqual([]);
    // the queued pull for the new session answers
    t.pending.shift();
    await t.reply([file("new.nf")]);
    expect(t.files.getState().files.map((f) => f.path)).toEqual(["new.nf"]);
  });

  it("F-210 UX-16: a refusal shows as unavailable with its message", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    t.pending.shift()?.resolve({
      ok: false,
      code: "internal",
      message: "boom",
    } as EngineRefusal);
    await tick();
    expect(t.files.getState().status).toBe("unavailable");
    expect(t.files.getState().message).toBe("boom");
  });

  it("F-210 UX-16: expand, collapse, select and reveal; folders that vanish leave the expanded set; the target folder follows the selection", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    await t.reply();
    const s = () => t.files.getState();
    expect(s().targetFolder()).toBe("");
    s().expand("modules");
    s().toggle("modules/local");
    expect([...s().expanded].sort()).toEqual(["modules", "modules/local"]);
    s().collapse("modules");
    expect([...s().expanded]).toEqual(["modules/local"]);
    // a folder selected is the target; a file's folder otherwise
    s().select("modules/local/a");
    expect(s().targetFolder()).toBe("modules/local/a");
    s().select("modules/local/a/main.nf");
    expect(s().targetFolder()).toBe("modules/local/a");
    s().select("README.md");
    expect(s().targetFolder()).toBe("");
    // reveal expands every ancestor and selects
    s().reveal("modules/local/a/main.nf");
    expect(s().selected).toBe("modules/local/a/main.nf");
    expect([...s().expanded].sort()).toEqual([
      "modules",
      "modules/local",
      "modules/local/a",
    ]);
    // the folder goes: it leaves the expanded set and the selection falls back to the parent
    t.change();
    await t.reply([file("main.nf"), file("README.md")]);
    expect([...s().expanded]).toEqual([]);
    expect(s().selected).toBeNull();
  });

  it("F-210 UX-16 UX-52: open dispatches to openWorkflow or openFile by openTarget", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    await t.reply();
    await t.files.getState().open("README.md");
    expect(t.canvas.getState().activeTab).toBe("file:README.md");
    expect(t.files.getState().selected).toBe("README.md");
    await t.files.getState().open("main.nf");
    expect(t.canvas.getState().activeTab).toBe("main.nf#");
  });

  it("F-210 AR-30: the store never holds file text", async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    await t.reply();
    const text = (v: unknown): boolean =>
      typeof v === "object" && v !== null
        ? Object.entries(v).some(([k, x]) => k === "text" || text(x))
        : false;
    const { files, registry } = t.files.getState();
    expect(text(files)).toBe(false);
    expect(text(registry)).toBe(false);
    expect(Object.keys(t.files.getState())).not.toContain("text");
  });

  it('F-210 AR-23 UX-16: createFile and createFolder send createFile through canvas apply with the session, label a folder "Create folder <path>", and return a refusal message', async () => {
    const t = setup();
    t.files.getState().setVisible(true);
    await t.show();
    await tick();
    await t.reply();
    // a refusal comes back as its message and changes nothing
    expect(await t.files.getState().createFile("notes.txt")).toBe("No.");
    expect(t.files.getState().selected).toBeNull();
    t.setOutcome(() => ({
      ok: true,
      revision: 2,
      workflows: [entry],
      files: [{ path: "x", text: "" }],
      history: EMPTY_HISTORY,
    }));
    t.files.getState().select("modules");
    expect(await t.files.getState().createFile("notes.txt")).toBeNull();
    expect(t.calls[1]).toBe(
      '{"kind":"createFile","path":"modules/notes.txt"} null',
    );
    const s = t.files.getState();
    expect(s.selected).toBe("modules/notes.txt");
    expect(s.expanded.has("modules")).toBe(true);
    expect(s.notice).toEqual({
      tone: "status",
      text: "Created modules/notes.txt.",
    });
    // the new file opens in a code tab
    expect(t.canvas.getState().activeTab).toBe("file:modules/notes.txt");
    expect(await t.files.getState().createFolder("assets/raw/")).toBeNull();
    expect(t.calls[2]).toBe(
      '{"kind":"createFile","path":"modules/assets/raw/.gitkeep"} {"label":"Create folder modules/assets/raw"}',
    );
    expect(t.files.getState().selected).toBe("modules/assets/raw");
    expect(t.files.getState().notice?.text).toBe(
      "Created folder modules/assets/raw.",
    );
  });
});
