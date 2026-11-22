import { createEngineService, type LoadProgress } from "@nf-builder/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEngine, getEngine } from "../src/engine/engine-client";
import { exposeEngine } from "../src/engine/expose";

const files = [
  { path: "main.nf", text: "workflow {\n}\n" },
  { path: "README.md", text: "# hi\n" },
];
const version = "26.10";

function connected() {
  const { port1, port2 } = new MessageChannel();
  exposeEngine(createEngineService(), port1);
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
