import "fake-indexeddb/auto";
import { createEngineService, type LoadProgress } from "@nf-builder/engine";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEngine, getEngine } from "../src/engine/engine-client";
import { exposeEngine } from "../src/engine/expose";
import { openProjectDb } from "../src/workspace/project-db";
import type { WorkspaceStatus } from "../src/workspace/types";
import { createWorkspace } from "../src/workspace/workspace";

const files = [
  { path: "main.nf", text: "workflow {\n}\n" },
  { path: "README.md", text: "# hi\n" },
];
const version = "26.10";

function connected() {
  const { port1, port2 } = new MessageChannel();
  const factory = new IDBFactory();
  exposeEngine(
    createWorkspace({
      engine: createEngineService(),
      openDb: (onClosed) => openProjectDb(factory, onClosed),
    }),
    port1,
  );
  const engine = connectEngine(port2);
  return {
    engine,
    close: () => {
      engine.dispose();
      port1.close();
      port2.close();
    },
  };
}

describe("F-113 engine client", () => {
  it("F-113 ADR-0003: the Comlink client opens a project and receives progress callbacks", async () => {
    const { engine, close } = connected();
    const events: LoadProgress[] = [];
    const summary = await engine.open({ version, files }, (p) =>
      events.push(p),
    );
    expect(summary.files.map((f) => f.path)).toEqual(["README.md", "main.nf"]);
    // progress travels on its own port and may land after the call settles
    await new Promise((r) => setTimeout(r, 50));
    expect(events[0]?.phase).toBe("loading");
    expect(events.filter((e) => e.phase === "parsing")).toHaveLength(2);
    close();
  });

  it("F-202 IO-01: the client forwards readFile and close", async () => {
    const { engine, close } = connected();
    expect(await engine.readFile("README.md")).toBeNull();
    await engine.open({ version, files });
    expect(await engine.readFile("README.md")).toBe("# hi\n");
    await engine.close();
    expect(await engine.readFile("README.md")).toBeNull();
    expect(await engine.diagnostics()).toMatchObject({ code: "no-project" });
    close();
  });

  it("F-206: the facade forwards details", async () => {
    const { engine, close } = connected();
    expect(await engine.details("main.nf", null, "x")).toMatchObject({
      code: "no-project",
    });
    await engine.open({
      version,
      files: [
        {
          path: "main.nf",
          text: "workflow {\n    main:\n    ch = channel.of(1)\n}\n",
        },
      ],
    });
    const projected = await engine.project("main.nf", null);
    const id =
      "projection" in projected ? projected.projection?.nodes[0]?.id : "";
    const result = await engine.details("main.nf", null, id ?? "");
    expect(result).toMatchObject({ details: { node: id } });
    expect(await engine.details("main.nf", null, "nope")).toMatchObject({
      details: null,
    });
    close();
  });

  it("F-202 ADR-0003: watch receives status pushes across Comlink; a second watch releases the first listener", async () => {
    const { engine, close } = connected();
    const first: WorkspaceStatus[] = [];
    const second: WorkspaceStatus[] = [];
    const initial = await engine.watch((s) => void first.push(s));
    expect(initial.storage).toBe("ready");
    const meta = await engine.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(first.at(-1)?.projects.map((p) => p.id)).toEqual([meta.id]);
    const seen = first.length;
    await engine.watch((s) => void second.push(s));
    await engine.renameProject(meta.id, "Renamed");
    await new Promise((r) => setTimeout(r, 50));
    expect(first).toHaveLength(seen);
    expect(second.at(-1)?.projects[0]?.name).toBe("Renamed");
    close();
  });

  it("F-203 ADR-0003: templates crosses the bridge", async () => {
    const { engine, close } = connected();
    const list = await engine.templates(version);
    expect(list.version).toBe(version);
    expect(list.blank.id).toBe("blank");
    expect(list.templates.map((t) => t.id)).toContain("hello-world");
    expect(JSON.stringify(list)).not.toContain("main.nf"); // names and descriptions only, no file text
    await expect(engine.templates("0.0")).rejects.toThrow(/0\.0/);
    close();
  });

  it("F-113: a service error rejects the client call with its message; a refusal crosses as data", async () => {
    const { engine, close } = connected();
    await expect(engine.open({ version: "0.0", files })).rejects.toThrow(
      /No language pack for 0\.0/,
    );
    const refusal = await engine.project("main.nf", null);
    expect(refusal).toMatchObject({ ok: false, code: "no-project" });
    const summary = await engine.open({ version, files });
    const stale = await engine.apply(
      { kind: "replaceFileText", path: "main.nf", text: "workflow {\n}\n" },
      summary.revision + 5,
    );
    expect(stale).toMatchObject({ ok: false, code: "stale" });
    close();
  });

  it("F-209 ADR-0003: undo, redo, history and apply options cross the Comlink bridge", async () => {
    const { engine, close } = connected();
    expect(await engine.history()).toEqual({
      undo: null,
      redo: null,
      undoCount: 0,
      redoCount: 0,
    });
    const summary = await engine.open({ version, files });
    const edit = (text: string) => ({
      kind: "replaceFileText" as const,
      path: "README.md",
      text,
    });
    const one = await engine.apply(edit("# one\n"), summary.revision, {
      group: "g",
      label: "Grouped edit",
    });
    if (!one.ok) throw new Error(one.message);
    const two = await engine.apply(edit("# two\n"), one.revision, {
      group: "g",
    });
    if (!two.ok) throw new Error(two.message);
    expect(two.history).toEqual({
      undo: "Grouped edit",
      redo: null,
      undoCount: 1,
      redoCount: 0,
    });
    const undone = await engine.undo(two.revision);
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.label).toBe("Grouped edit");
    expect(await engine.readFile("README.md")).toBe("# hi\n");
    expect((await engine.history()).redoCount).toBe(1);
    const redone = await engine.redo(undone.revision);
    if (!redone.ok) throw new Error(redone.message);
    expect(await engine.readFile("README.md")).toBe("# two\n");
    expect(await engine.undo(redone.revision - 1)).toMatchObject({
      ok: false,
      code: "stale",
    });
    await engine.undo(redone.revision);
    expect(await engine.undo(redone.revision + 1)).toMatchObject({
      ok: false,
      code: "no-history",
    });
    close();
  });

  it("F-309: the facade forwards applyFix and announces its change to onEngineChange listeners", async () => {
    const { port1, port2 } = new MessageChannel();
    exposeEngine(
      createWorkspace({
        engine: createEngineService(),
        openDb: (onClosed) => openProjectDb(new IDBFactory(), onClosed),
      }),
      port1,
    );
    class PortWorker extends EventTarget {
      constructor() {
        super();
        port2.addEventListener("message", (e) =>
          this.dispatchEvent(new MessageEvent("message", { data: e.data })),
        );
        port2.start();
      }
      postMessage(message: unknown, transfer?: Transferable[]) {
        port2.postMessage(message, transfer ?? []);
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", PortWorker);
    // a fresh module, so the singleton engine of the other tests isn't reused
    vi.resetModules();
    const fresh = await import("../src/engine/engine-client");
    const engine = fresh.getEngine();
    const heard: { revision: number; files: unknown }[] = [];
    const off = fresh.onEngineChange((c) => heard.push(c));
    try {
      const text = "workflow {\n    x = Channel.of(1)\n    x.view()\n}\n";
      const summary = await engine.open({
        version,
        files: [{ path: "main.nf", text }],
      });
      const diagnosed = await engine.diagnostics();
      if (!("diagnostics" in diagnosed)) throw new Error("refused");
      const fix = diagnosed.diagnostics.find((d) => d.fix)?.fix;
      if (!fix) throw new Error("no fix");
      expect(await engine.applyFix(fix, summary.revision + 2)).toMatchObject({
        ok: false,
        code: "stale",
      });
      expect(heard).toHaveLength(0);
      const applied = await engine.applyFix(fix, summary.revision, {
        label: "Fix it",
      });
      if (!applied.ok) throw new Error(applied.message);
      expect(applied.history.undo).toBe("Fix it");
      expect(heard).toHaveLength(1);
      expect(heard[0]?.revision).toBe(applied.revision);
      expect(await engine.readFile("main.nf")).toContain("channel.of");
    } finally {
      off();
      vi.unstubAllGlobals();
      port1.close();
      port2.close();
    }
  });

  it("F-113: importing the client starts no worker", async () => {
    let touched = false;
    const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      get() {
        touched = true;
        return undefined;
      },
    });
    try {
      // a fresh evaluation: the static import above has already run its module body
      vi.resetModules();
      await import("../src/engine/engine-client");
      expect(touched).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "Worker", original);
      else Reflect.deleteProperty(globalThis, "Worker");
    }
  });
});

describe("F-113 engine client failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("F-113: a call rejects when the worker fails to load, and the next getEngine starts a new worker", async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker extends EventTarget {
      terminated = false;
      constructor() {
        super();
        workers.push(this);
      }
      postMessage() {}
      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = getEngine();
    expect(getEngine()).toBe(first);
    const pending = first.palette(version);
    workers[0]?.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow(/engine worker failed/);
    // a call made after the failure rejects too, and the failed worker is gone
    await expect(first.palette(version)).rejects.toThrow(
      /engine worker failed/,
    );
    expect(workers[0]?.terminated).toBe(true);
    const second = getEngine();
    expect(second).not.toBe(first);
    expect(workers).toHaveLength(2);
    workers[1]?.dispatchEvent(new Event("messageerror"));
    await expect(second.palette(version)).rejects.toThrow(/messageerror/);
  });
});
