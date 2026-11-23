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

  it("F-207 ADR-0003: setLayout crosses the Comlink bridge, and project() returns the stored positions", async () => {
    const { engine, close } = connected();
    await engine.open({
      version,
      files: [
        {
          path: "main.nf",
          text: "process A {\n    script:\n    'A'\n}\n\nworkflow {\n    A()\n}\n",
        },
      ],
    });
    const position = { "main.nf#/A@1": { x: 5, y: 6 } };
    const change = await engine.setLayout({
      path: "main.nf",
      workflow: null,
      positions: position,
      replace: false,
    });
    expect(change).toMatchObject({
      layout: { state: "ok" },
      files: [{ path: ".nf-builder/layout.json" }],
    });
    expect(await engine.project("main.nf", null)).toMatchObject({
      positions: position,
    });
    const refused = await engine.setLayout({
      path: "main.nf",
      workflow: null,
      positions: { nope: { x: 1, y: 1 } },
      replace: false,
    });
    expect(refused).toMatchObject({ ok: false, code: "invalid" });
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
