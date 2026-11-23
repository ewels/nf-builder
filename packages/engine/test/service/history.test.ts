import { join } from "node:path";
import type { EditCommand, Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type EngineApi,
  type EngineRefusal,
  type ProjectChange,
} from "../../src";
import { installedPackVersions } from "../../src/packs";
import { readTree } from "../model/read-tree";

const version = installedPackVersions()[0] as string;
const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const entry = { path: "main.nf", workflow: null };

const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const small = [
  {
    path: "main.nf",
    text: `include { A } from './a.nf'\ninclude { B } from './b.nf'\n\nworkflow {\n    A()\n}\n`,
  },
  { path: "a.nf", text: proc("A") },
  { path: "b.nf", text: proc("B") },
];

const edit = (n: number): EditCommand => ({
  kind: "replaceFileText",
  path: "b.nf",
  text: `${proc("B")}// ${n}\n`,
});

type Change = ProjectChange & { label?: string };
const change = (r: unknown): Change => {
  const x = r as { ok?: boolean; code?: string; message?: string };
  if (x.ok === false) throw new Error(`refused: ${x.code}: ${x.message}`);
  return r as Change;
};
const refusal = (r: unknown): EngineRefusal => {
  const x = r as EngineRefusal;
  if (x.ok !== false) throw new Error("expected a refusal");
  return x;
};

/** Tracks the texts the engine reports, so tests compare the whole project after each change. */
async function open(files: readonly { path: string; text: string }[]) {
  const service = createEngineService();
  const summary = await service.open({ version, files });
  const texts = new Map(files.map((f) => [f.path, f.text]));
  let revision = summary.revision;
  const take = (r: unknown): Change => {
    const c = change(r);
    for (const f of c.files) {
      if (f.text === null) texts.delete(f.path);
      else texts.set(f.path, f.text);
    }
    revision = c.revision;
    return c;
  };
  return {
    service,
    take,
    texts,
    get revision() {
      return revision;
    },
    apply: async (
      command: EditCommand,
      options?: { group?: string; label?: string },
    ) => take(await service.apply(command, revision, options)),
    undo: async () => take(await service.undo(revision)),
    redo: async () => take(await service.redo(revision)),
    snapshot: () => Object.fromEntries([...texts].sort()),
  };
}

const nodeId = async (service: EngineApi, local: string) => {
  const r = await service.project("main.nf", null);
  const p = (r as { projection: Projection }).projection;
  const found = p.nodes.find((n) => n.id.endsWith(`/${local}`));
  if (!found) throw new Error(`no node ${local}`);
  return found;
};
const portOf = async (service: EngineApi, local: string, port: string) => ({
  node: (await nodeId(service, local)).id,
  port,
});

describe("F-209 engine history", () => {
  const start = readTree(join(cases, "f111-start-typed"));
  const goldenSteps: ((s: EngineApi) => Promise<EditCommand>)[] = [
    async () => ({ kind: "addCall", target: entry, callee: "ALIGN" }),
    async (s) => ({
      kind: "connect",
      target: entry,
      from: await portOf(s, "reads", "out"),
      to: await portOf(s, "ALIGN@1", "sample"),
    }),
    async (s) => ({
      kind: "disconnect",
      target: entry,
      port: await portOf(s, "ALIGN@1", "sample"),
    }),
    async (s) => ({
      kind: "connect",
      target: entry,
      from: await portOf(s, "more", "out"),
      to: await portOf(s, "ALIGN@1", "sample"),
    }),
    async (s) => ({
      kind: "connect",
      target: entry,
      from: await portOf(s, "ALIGN@1", "out"),
      to: await portOf(s, "COUNT@1", "aligned"),
    }),
    async (s) => ({
      kind: "deleteNode",
      target: entry,
      node: (await nodeId(s, ".view@1")).id,
    }),
    async () => ({ kind: "addCall", target: entry, callee: "PAIR" }),
    async (s) => ({
      kind: "connect",
      target: entry,
      from: await portOf(s, "more", "out"),
      to: await portOf(s, "PAIR@1", "right"),
    }),
    async (s) => ({
      kind: "connect",
      target: entry,
      from: await portOf(s, "PAIR@1", "b"),
      to: await portOf(s, "COUNT@1", "aligned"),
    }),
    async () => ({ kind: "createProcess", name: "REPORT", caller: "main.nf" }),
    async () => ({ kind: "addCall", target: entry, callee: "REPORT" }),
    async () => ({
      kind: "renameDeclaration",
      path: "modules/local/count/main.nf",
      name: "COUNT",
      newName: "COUNT_LINES",
    }),
  ];

  it("F-209 step 1 AR-23: twelve undos after the f111 golden commands restore every file of f111-start-typed byte for byte, and the created module file is gone", async () => {
    const p = await open(start);
    const base = p.snapshot();
    const mid: Record<string, string>[] = [];
    for (const step of goldenSteps) {
      await p.apply(await step(p.service));
      mid.push(p.snapshot());
    }
    expect(Object.keys(p.snapshot())).toContain("modules/local/report/main.nf");
    for (let i = goldenSteps.length - 1; i >= 0; i--) {
      await p.undo();
      expect(p.snapshot()).toEqual(i === 0 ? base : mid[i - 1]);
    }
    expect(p.snapshot()).toEqual(base);
    expect(Object.keys(p.snapshot())).not.toContain(
      "modules/local/report/main.nf",
    );
    for (const [path, text] of Object.entries(base))
      expect(await p.service.readFile(path)).toBe(text);
    expect(await p.service.readFile("modules/local/report/main.nf")).toBeNull();
    expect((await p.service.history()).undoCount).toBe(0);
  });

  it("F-209 step 2 AR-23: twelve redos then give f111-edits-typed byte for byte", async () => {
    const p = await open(start);
    for (const step of goldenSteps) await p.apply(await step(p.service));
    for (let i = 0; i < 12; i++) await p.undo();
    for (let i = 0; i < 12; i++) await p.redo();
    const expected = Object.fromEntries(
      readTree(join(cases, "f111-edits-typed")).map((f) => [f.path, f.text]),
    );
    expect(p.snapshot()).toEqual(
      Object.fromEntries(Object.entries(expected).sort()),
    );
    for (const [path, text] of Object.entries(expected))
      expect(await p.service.readFile(path)).toBe(text);
  });

  it("F-209 AR-23: each apply adds one step and each undo or redo moves one, each with revision + 1 and the history status in the change", async () => {
    const p = await open(small);
    const r0 = p.revision;
    const a = await p.apply({ kind: "addCall", target: entry, callee: "B" });
    expect(a.revision).toBe(r0 + 1);
    expect(a.history).toEqual({
      undo: "Add call to B",
      redo: null,
      undoCount: 1,
      redoCount: 0,
    });
    const b = await p.apply({
      kind: "replaceFileText",
      path: "a.nf",
      text: `${proc("A")}// x\n`,
    });
    expect(b.history).toMatchObject({ undo: "Edit a.nf", undoCount: 2 });
    const u = await p.undo();
    expect(u.revision).toBe(r0 + 3);
    expect(u.label).toBe("Edit a.nf");
    expect(u.history).toEqual({
      undo: "Add call to B",
      redo: "Edit a.nf",
      undoCount: 1,
      redoCount: 1,
    });
    const r = await p.redo();
    expect(r.revision).toBe(r0 + 4);
    expect(r.label).toBe("Edit a.nf");
    expect(r.history).toMatchObject({ undoCount: 2, redoCount: 0 });
    expect(await p.service.history()).toEqual(r.history);
    await p.undo();
    const c = await p.apply(edit(7));
    expect(c.history).toMatchObject({ undoCount: 2, redoCount: 0 });
  });

  it("F-209 ADR-0043: undo or redo on an older revision is refused as stale and changes nothing; with an empty stack the refusal is no-history", async () => {
    const empty = createEngineService();
    expect(await empty.history()).toEqual({
      undo: null,
      redo: null,
      undoCount: 0,
      redoCount: 0,
    });
    expect(refusal(await empty.undo(0)).code).toBe("no-project");
    expect(refusal(await empty.redo(0)).code).toBe("no-project");

    const p = await open(small);
    const nothing = refusal(await p.service.undo(p.revision));
    expect(nothing.code).toBe("no-history");
    expect(nothing.message).toBe("There is nothing to undo.");
    expect(refusal(await p.service.redo(p.revision)).message).toBe(
      "There is nothing to redo.",
    );
    expect(nothing.revision).toBe(p.revision);
    const a = await p.apply({ kind: "addCall", target: entry, callee: "B" });
    const before = p.snapshot();
    const old = refusal(await p.service.undo(a.revision - 1));
    expect(old.code).toBe("stale");
    expect(refusal(await p.service.redo(a.revision - 1)).code).toBe("stale");
    expect(old.revision).toBe(a.revision);
    expect(await p.service.history()).toEqual(a.history);
    for (const [path, text] of Object.entries(before))
      expect(await p.service.readFile(path)).toBe(text);
  });

  it("F-209 ADR-0004: writeFiles, a raw applyPatches, open and close clear the history; a refused command leaves it unchanged", async () => {
    const p = await open(small);
    await p.apply({ kind: "addCall", target: entry, callee: "B" });
    const refused = await p.service.apply(
      { kind: "addCall", target: entry, callee: "NOPE" },
      p.revision,
    );
    expect((refused as EngineRefusal).ok).toBe(false);
    expect((await p.service.history()).undoCount).toBe(1);

    const written = p.take(
      await p.service.writeFiles([{ path: "extra.nf", text: proc("X") }]),
    );
    expect(written.history).toMatchObject({ undoCount: 0, redoCount: 0 });

    await p.apply(edit(1));
    await p.undo();
    expect((await p.service.history()).redoCount).toBe(1);
    const raw = p.take(
      await p.service.applyPatches(
        [{ kind: "create", path: "n.txt", text: "n" }],
        p.revision,
      ),
    );
    expect(raw.history).toEqual({
      undo: null,
      redo: null,
      undoCount: 0,
      redoCount: 0,
    });

    await p.apply(edit(2));
    await p.service.close();
    expect(await p.service.history()).toEqual({
      undo: null,
      redo: null,
      undoCount: 0,
      redoCount: 0,
    });
    await p.service.open({ version, files: small });
    expect((await p.service.history()).undoCount).toBe(0);
    const q = await open(small);
    await q.apply(edit(3));
    await q.service.open({ version, files: small });
    expect((await q.service.history()).undoCount).toBe(0);
  });

  it("F-209 AR-24 ADR-0039: undoing a ReplaceFileText that repaired a broken file restores the broken text", async () => {
    const p = await open(small);
    const w = change(
      await p.service.writeFiles([{ path: "a.nf", text: "process {" }]),
    );
    p.texts.set("a.nf", "process {");
    const fixed = change(
      await p.service.apply(
        { kind: "replaceFileText", path: "a.nf", text: proc("A") },
        w.revision,
      ),
    );
    expect(fixed.files[0]?.text).toBe(proc("A"));
    const undone = change(await p.service.undo(fixed.revision));
    expect(undone.files).toEqual([{ path: "a.nf", text: "process {" }]);
    expect(await p.service.readFile("a.nf")).toBe("process {");
  });

  it("F-209 F-301: createProcess and addCall with one group are one step; undo removes the module and restores main.nf exactly; redo brings both back with one revision each", async () => {
    const p = await open(small);
    const base = p.snapshot();
    const group = { group: "g", label: "Create and call REPORT" };
    const one = await p.apply(
      { kind: "createProcess", name: "REPORT", caller: "main.nf" },
      group,
    );
    const two = await p.apply(
      { kind: "addCall", target: entry, callee: "REPORT" },
      { group: "g" },
    );
    expect(one.history.undoCount).toBe(1);
    expect(two.history).toMatchObject({
      undo: "Create and call REPORT",
      undoCount: 1,
    });
    const done = p.snapshot();
    const u = await p.undo();
    expect(u.revision).toBe(two.revision + 1);
    expect(p.snapshot()).toEqual(base);
    expect(
      u.files.find((f) => f.path === "modules/local/report/main.nf")?.text,
    ).toBeNull();
    const r = await p.redo();
    expect(r.revision).toBe(u.revision + 1);
    expect(p.snapshot()).toEqual(done);
    // a different group, or none, starts a new step
    const three = await p.apply({
      kind: "replaceFileText",
      path: "b.nf",
      text: `${proc("B")}// y\n`,
    });
    expect(three.history.undoCount).toBe(2);
  });

  it("F-209 ADR-0003: undo, redo and history results survive structuredClone", async () => {
    const p = await open(small);
    const a = await p.apply({ kind: "addCall", target: entry, callee: "B" });
    expect(structuredClone(a)).toEqual(a);
    const u = await p.undo();
    expect(structuredClone(u)).toEqual(u);
    const r = await p.redo();
    expect(structuredClone(r)).toEqual(r);
    const h = await p.service.history();
    expect(structuredClone(h)).toEqual(h);
    const refused = await p.service.redo(p.revision);
    expect(structuredClone(refused)).toEqual(refused);
  });

  it("F-209: the injected history limits bound the steps", async () => {
    const service = createEngineService({
      historyLimits: { steps: 2, units: 1_000_000 },
    });
    const summary = await service.open({ version, files: small });
    let revision = summary.revision;
    for (let i = 0; i < 4; i++) {
      const c = change(
        await service.apply(
          {
            kind: "replaceFileText",
            path: "b.nf",
            text: `${proc("B")}// ${i}\n`,
          },
          revision,
        ),
      );
      revision = c.revision;
    }
    expect((await service.history()).undoCount).toBe(2);
  });
});
