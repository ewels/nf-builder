import type {
  EditCommand,
  FileText,
  Projection,
  TextPatch,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  type ApplyOutcome,
  createEngineService,
  type EngineRefusal,
  type LoadProgress,
  loadPalette,
  type ModelEvent,
  type ProjectChange,
  type ProjectionResult,
} from "../../src";
import { installedPackVersions } from "../../src/packs";

const version = installedPackVersions()[0] as string;
const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const mainText = [
  "include { A } from './a.nf'",
  "",
  proc("B"),
  "workflow {",
  "    A()",
  "}",
  "",
].join("\n");
const files = [
  { path: "main.nf", text: mainText },
  { path: "a.nf", text: proc("A") },
  { path: "README.md", text: "# hello\n" },
];
const target = { path: "main.nf", workflow: null };
const addB: EditCommand = { kind: "addCall", target, callee: "B" };
const replaceA = (text: string): EditCommand => ({
  kind: "replaceFileText",
  path: "a.nf",
  text,
});

const opened = async (trace?: (e: ModelEvent) => void) => {
  const service = createEngineService({ trace });
  const summary = await service.open({ version, files });
  return { service, summary };
};
const ok = (r: ApplyOutcome | ProjectChange | EngineRefusal) => {
  if ("ok" in r && r.ok === false)
    throw new Error(`refused: ${r.code}: ${r.message}`);
  return r as ProjectChange & { patches: TextPatch[]; inverse: TextPatch[] };
};
const nodes = (r: ProjectionResult | EngineRefusal) => {
  if (!("projection" in r)) throw new Error(`refused: ${r.code}`);
  return (r.projection as Projection).nodes;
};
const texts = (change: { files: readonly FileText[] }) =>
  Object.fromEntries(change.files.map((f) => [f.path, f.text]));

describe("F-113 engine service", () => {
  it("F-113 QA-03 ADR-0029: open reports loading, one parsing event per file in order, then modelling, and returns a summary of every file", async () => {
    const events: LoadProgress[] = [];
    const service = createEngineService();
    const summary = await service.open({ version, files }, (p) =>
      events.push(p),
    );
    expect(events[0]).toEqual({
      phase: "loading",
      done: 0,
      total: 3,
      path: null,
    });
    const parsing = events.filter((e) => e.phase === "parsing");
    expect(parsing.map((e) => e.done)).toEqual([1, 2, 3]);
    expect(parsing.map((e) => e.path).sort()).toEqual([
      "README.md",
      "a.nf",
      "main.nf",
    ]);
    expect(parsing.every((e) => e.total === 3)).toBe(true);
    const modelling = events.filter((e) => e.phase === "modelling");
    expect(modelling).toEqual([
      { phase: "modelling", done: 3, total: 3, path: null },
    ]);
    expect(events.at(-1)?.phase).toBe("modelling");
    expect(summary.version).toBe(version);
    expect(summary.files.map((f) => [f.path, f.language, f.status])).toEqual([
      ["README.md", "markdown", "plain"],
      ["a.nf", "nextflow", "modelled"],
      ["main.nf", "nextflow", "modelled"],
    ]);
    expect(summary.workflows.map((w) => [w.path, w.name])).toEqual([
      ["main.nf", null],
    ]);
  });

  it("F-113 AR-04: apply re-parses only the files the command changed and re-models them and their dependants", async () => {
    const events: ModelEvent[] = [];
    const { service, summary } = await opened((e) => events.push(e));
    events.length = 0;
    const r = ok(
      await service.apply(
        replaceA(proc("A").replace("'A'", "'A2'")),
        summary.revision,
      ),
    );
    expect(events.filter((e) => e.kind === "parse")).toEqual([
      { kind: "parse", path: "a.nf" },
    ]);
    expect(r.remodelled).toEqual(["a.nf", "main.nf"]);
    expect(r.files.map((f) => f.path)).toEqual(["a.nf"]);
  });

  it("F-113 AR-04 ADR-0004: writeFiles creates, changes and deletes files without the AR-24 guard", async () => {
    const { service, summary } = await opened();
    const broken = await service.writeFiles([
      { path: "a.nf", text: "process {" },
      { path: "extra.nf", text: proc("X") },
      { path: "README.md", text: null },
    ]);
    const change = ok(broken);
    expect(change.revision).toBe(summary.revision + 1);
    expect(change.remodelled).toEqual(["a.nf", "extra.nf", "main.nf"]);
    const diagnostics = await service.diagnostics();
    expect("diagnostics" in diagnostics).toBe(true);
    const projected = await service.project("main.nf", null);
    expect("projection" in projected).toBe(true);
  });

  it("F-113 AR-23: applyPatches with a command's inverse restores the exact bytes", async () => {
    const { service, summary } = await opened();
    const applied = ok(await service.apply(addB, summary.revision));
    expect(texts(applied)["main.nf"]).not.toBe(mainText);
    const undone = ok(
      await service.applyPatches(applied.inverse, applied.revision),
    );
    expect(texts(undone)).toEqual({ "main.nf": mainText });
    expect(undone.revision).toBe(applied.revision + 1);
    expect(undone.inverse).toEqual(applied.patches);
  });

  it("F-113 AR-20 AR-24: a refused command changes nothing", async () => {
    const { service, summary } = await opened();
    const refused = await service.apply(
      replaceA("process {"),
      summary.revision,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("does-not-parse");
    expect(refused.message.length).toBeGreaterThan(0);
    expect(refused.revision).toBe(summary.revision);
    const again = ok(await service.apply(addB, summary.revision));
    expect(again.revision).toBe(summary.revision + 1);
    expect(texts(again)["main.nf"]).toContain("B()");
  });

  it("F-113 AR-10: project returns the current projection and reflects an applied AddCall", async () => {
    const { service, summary } = await opened();
    const before = await service.project("main.nf", null);
    expect(nodes(before).filter((n) => n.kind === "call")).toHaveLength(1);
    const applied = ok(await service.apply(addB, summary.revision));
    const after = await service.project("main.nf", null);
    expect(nodes(after).filter((n) => n.kind === "call")).toHaveLength(2);
    expect("revision" in after && after.revision).toBe(applied.revision);
    const missing = await service.project("main.nf", "NOPE");
    expect(missing).toEqual({ revision: applied.revision, projection: null });
    expect(applied.workflows.map((w) => w.name)).toEqual([null]);
  });

  it("F-112 F-113 AR-05: diagnostics() returns the pack lint codes and is recomputed after a change", async () => {
    const service = createEngineService();
    const legacy = (receiver: string) =>
      `workflow {\n    ${receiver}.of(1).view()\n}\n`;
    const summary = await service.open({
      version,
      files: [{ path: "main.nf", text: legacy("Channel") }],
    });
    const codes = (r: Awaited<ReturnType<typeof service.diagnostics>>) => {
      if (!("diagnostics" in r)) throw new Error(`refused: ${r.code}`);
      return r.diagnostics.map((d) => d.code);
    };
    const before = await service.diagnostics();
    expect(codes(before)).toContain("deprecated-channel");
    expect("revision" in before && before.revision).toBe(summary.revision);
    const applied = ok(
      await service.apply(
        {
          kind: "replaceFileText",
          path: "main.nf",
          text: legacy("channel"),
        },
        summary.revision,
      ),
    );
    const after = await service.diagnostics();
    expect(codes(after)).not.toContain("deprecated-channel");
    expect("revision" in after && after.revision).toBe(applied.revision);
  });

  it("F-113: a command or patch list built on an older revision is refused as stale", async () => {
    const { service, summary } = await opened();
    const first = ok(await service.apply(addB, summary.revision));
    const stale = await service.apply(addB, summary.revision);
    expect(stale.ok === false && stale.code).toBe("stale");
    const staleUndo = await service.applyPatches(
      first.inverse,
      summary.revision,
    );
    expect(staleUndo.ok === false && staleUndo.code).toBe("stale");
    const check = await service.project("main.nf", null);
    expect(nodes(check).filter((n) => n.kind === "call")).toHaveLength(2);
  });

  it("F-113: calls run one at a time in arrival order", async () => {
    const service = createEngineService();
    const opening = service.open({ version, files });
    const applying = service.apply(addB, 1);
    const [summary, outcome] = await Promise.all([opening, applying]);
    expect(summary.revision).toBe(1);
    expect(outcome.ok).toBe(true);
  });

  it("F-113: without an open project, apply, applyPatches, writeFiles, project and diagnostics answer no-project", async () => {
    const service = createEngineService();
    const results = [
      await service.apply(addB, 0),
      await service.applyPatches([], 0),
      await service.writeFiles([]),
      await service.project("main.nf", null),
      await service.diagnostics(),
    ];
    for (const r of results) {
      expect(r).toMatchObject({
        ok: false,
        code: "no-project",
        revision: null,
      });
    }
  });

  it("F-113 ADR-0028: palette(version) equals loadPalette(version)", async () => {
    const service = createEngineService();
    expect(await service.palette(version)).toEqual(await loadPalette(version));
    await expect(service.palette("0.0")).rejects.toThrow();
  });

  it("F-113 ADR-0003: every result survives structuredClone unchanged", async () => {
    const service = createEngineService();
    const results: unknown[] = [];
    results.push(await service.palette(version));
    const summary = await service.open({ version, files });
    results.push(summary);
    const applied = await service.apply(addB, summary.revision);
    results.push(applied);
    results.push(
      await service.apply(
        replaceA("process {"),
        applied.ok ? applied.revision : 0,
      ),
    );
    results.push(
      await service.applyPatches(
        applied.ok ? applied.inverse : [],
        applied.ok ? applied.revision : 0,
      ),
    );
    results.push(await service.writeFiles([{ path: "n.nf", text: "x" }]));
    results.push(await service.project("main.nf", null));
    results.push(await service.diagnostics());
    for (const r of results) expect(structuredClone(r)).toEqual(r);
  });

  it("F-113: a failing open rejects and the next open works", async () => {
    const service = createEngineService();
    await expect(service.open({ version: "0.0", files })).rejects.toThrow();
    const summary = await service.open({ version, files });
    expect(summary.files).toHaveLength(3);
    expect(summary.revision).toBeGreaterThan(0);
  });

  it("F-113 AR-24: a throw after a write has started is an internal refusal that moves the revision on and does not claim nothing changed", async () => {
    const { service, summary } = await opened();
    const refused = await service.writeFiles([
      { path: "extra.nf", text: proc("X") },
      {
        path: "bad.nf",
        get text(): string {
          throw new Error("boom");
        },
      },
    ]);
    expect(refused).toMatchObject({ ok: false, code: "internal" });
    if (!("ok" in refused) || refused.ok) throw new Error("expected a refusal");
    expect(refused.message).not.toMatch(/Nothing was changed/);
    expect(refused.message).toMatch(/partly changed/);
    expect(refused.revision).toBe(summary.revision + 1);
    // the old revision is stale, and the first write is in the model
    expect(await service.apply(addB, summary.revision)).toMatchObject({
      code: "stale",
    });
    const diagnostics = await service.diagnostics();
    expect("diagnostics" in diagnostics && diagnostics.revision).toBe(
      summary.revision + 1,
    );
    const next = ok(await service.apply(addB, summary.revision + 1));
    expect(next.revision).toBe(summary.revision + 2);
  });
  it("F-202 IO-01: readFile returns the current text after writeFiles and apply, and null for a missing path or with no project", async () => {
    const empty = createEngineService();
    expect(await empty.readFile("README.md")).toBeNull();
    const { service } = await opened();
    expect(await service.readFile("README.md")).toBe("# hello\n");
    expect(await service.readFile("nope.nf")).toBeNull();
    ok(await service.writeFiles([{ path: "README.md", text: "two\n" }]));
    expect(await service.readFile("README.md")).toBe("two\n");
    ok(await service.apply(replaceA(proc("Z")), 2));
    expect(await service.readFile("a.nf")).toBe(proc("Z"));
    ok(await service.writeFiles([{ path: "README.md", text: null }]));
    expect(await service.readFile("README.md")).toBeNull();
  });

  it("F-202: readFile runs in the serial queue, after earlier calls", async () => {
    const { service } = await opened();
    const writing = service.writeFiles([{ path: "README.md", text: "late\n" }]);
    const reading = service.readFile("README.md");
    await writing;
    expect(await reading).toBe("late\n");
  });

  it("F-202: close drops the open project; later calls answer no-project", async () => {
    const { service } = await opened();
    await service.close();
    expect(await service.readFile("README.md")).toBeNull();
    for (const r of [
      await service.apply(addB, 1),
      await service.writeFiles([]),
      await service.project("main.nf", null),
      await service.diagnostics(),
    ])
      expect(r).toMatchObject({
        ok: false,
        code: "no-project",
        revision: null,
      });
    await service.close();
    const summary = await service.open({ version, files });
    expect(summary.revision).toBeGreaterThan(1);
  });
});
