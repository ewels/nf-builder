import {
  canvasView,
  createEngineService,
  type ElkGraphIn,
  type ElkGraphOut,
  elkGraph,
  elkPositions,
  installedPackVersions,
  type Projection,
} from "@nf-builder/engine";
import ELK from "elkjs/lib/elk.bundled.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeElk, runElk } from "../src/layout/elk-client";

const PREFIX = "../../../tools/oracle/cases/f111-start-typed/";
const raw = import.meta.glob<string>(
  "../../../tools/oracle/cases/f111-start-typed/**/*",
  { query: "?raw", import: "default", eager: true },
);
const FIXTURE = Object.entries(raw).map(([path, text]) => ({
  path: path.slice(PREFIX.length),
  text,
}));

async function entryProjection(): Promise<Projection> {
  const service = createEngineService();
  await service.open({
    version: installedPackVersions()[0] as string,
    files: FIXTURE,
  });
  const result = await service.project("main.nf", null);
  if (!("projection" in result) || result.projection === null)
    throw new Error("no projection");
  return result.projection;
}

/** A Worker that answers ELK's protocol with the bundled (in-thread) ELK. */
class FakeElkWorker {
  static made: FakeElkWorker[] = [];
  static failWith: string | null = null;
  onmessage: ((answer: { data: unknown }) => void) | null = null;
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>();
  terminated = false;
  readonly #inner = new ELK();

  constructor(readonly url: string) {
    FakeElkWorker.made.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), fn]);
  }

  fire(type: string, event: unknown) {
    for (const fn of this.#listeners.get(type) ?? []) fn(event);
  }

  postMessage(msg: {
    id: number;
    cmd: string;
    graph?: ElkGraphIn;
    layoutOptions?: Record<string, string>;
  }) {
    if (FakeElkWorker.failWith !== null) {
      queueMicrotask(() =>
        this.fire("error", { message: FakeElkWorker.failWith }),
      );
      return;
    }
    if (msg.cmd === "register") {
      this.onmessage?.({ data: { id: msg.id, data: [] } });
      return;
    }
    // biome-ignore lint/suspicious/noExplicitAny: the bundled ELK's types want its own node type
    void this.#inner.layout(msg.graph as any).then((data) => {
      this.onmessage?.({ data: { id: msg.id, data } });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  disposeElk();
  FakeElkWorker.made = [];
  FakeElkWorker.failWith = null;
  vi.unstubAllGlobals();
});

describe("F-207 ELK client", () => {
  it("F-207 ADR-0008: ELK lays out the f111-start-typed entry workflow deterministically, with no overlaps and every edge left to right", async () => {
    const view = canvasView(await entryProjection(), { portLabels: true });
    expect(view.nodes.length).toBeGreaterThan(3);
    const graph = elkGraph(view);
    const layout = async () =>
      elkPositions(
        (await new ELK().layout(
          // biome-ignore lint/suspicious/noExplicitAny: the bundled ELK's types want its own node type
          structuredClone(graph) as any,
        )) as ElkGraphOut,
      );
    const first = await layout();
    expect(await layout()).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(
      view.nodes.map((n) => n.id).sort(),
    );
    const boxes = view.nodes.map((n) => ({ n, p: first[n.id] }));
    for (const a of boxes)
      for (const b of boxes) {
        if (a.n.id >= b.n.id || !a.p || !b.p) continue;
        const apart =
          a.p.x + a.n.width <= b.p.x ||
          b.p.x + b.n.width <= a.p.x ||
          a.p.y + a.n.height <= b.p.y ||
          b.p.y + b.n.height <= a.p.y;
        expect(apart, `${a.n.id} and ${b.n.id} overlap`).toBe(true);
      }
    expect(view.edges.length).toBeGreaterThan(0);
    for (const e of view.edges) {
      const s = view.nodes.find((n) => n.id === e.source);
      const t = view.nodes.find((n) => n.id === e.target);
      const sp = first[e.source];
      const tp = first[e.target];
      if (!s || !t || !sp || !tp) throw new Error("edge end missing");
      expect(sp.x + s.width, `${e.source} to ${e.target}`).toBeLessThanOrEqual(
        tp.x,
      );
    }
  });

  it("F-207 QA-01 ADR-0003: no worker starts until ELK is first asked for, and one worker serves every later call", async () => {
    vi.stubGlobal("Worker", FakeElkWorker);
    expect(FakeElkWorker.made).toHaveLength(0);
    const graph = elkGraph(
      canvasView(await entryProjection(), { portLabels: true }),
    );
    expect(FakeElkWorker.made).toHaveLength(0);
    const out = await runElk(graph);
    expect(Object.keys(elkPositions(out)).length).toBe(graph.children.length);
    await runElk(graph);
    expect(FakeElkWorker.made).toHaveLength(1);
    expect(FakeElkWorker.made[0]?.url).toMatch(/elk-worker/);
  });

  it("F-207 ADR-0008: a worker error rejects the call, and the next call starts a new worker; disposeElk terminates the worker", async () => {
    vi.stubGlobal("Worker", FakeElkWorker);
    const graph = elkGraph(
      canvasView(await entryProjection(), { portLabels: true }),
    );
    FakeElkWorker.failWith = "could not load";
    await expect(runElk(graph)).rejects.toThrow(/could not load/);
    expect(FakeElkWorker.made[0]?.terminated).toBe(true);
    FakeElkWorker.failWith = null;
    await runElk(graph);
    expect(FakeElkWorker.made).toHaveLength(2);
    disposeElk();
    expect(FakeElkWorker.made[1]?.terminated).toBe(true);
    disposeElk(); // harmless twice
  });

  it("F-207: a Worker constructor that throws rejects the call instead of throwing", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by policy");
        }
      },
    );
    await expect(
      runElk({ id: "root", layoutOptions: {}, children: [], edges: [] }),
    ).rejects.toThrow(/blocked by policy/);
  });
});
