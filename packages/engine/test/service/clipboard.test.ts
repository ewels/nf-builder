import type { Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  createEngineService,
  type EngineApi,
  type EngineRefusal,
  type ProjectChange,
} from "../../src";
import { parseLayout } from "../../src/layout";
import { installedPackVersions } from "../../src/packs";
import { blankFiles, caseFiles, entry } from "../clipboard/fixtures";

const version = installedPackVersions()[0] as string;

type Changed = ProjectChange & { pasted?: readonly string[]; label?: string };
const ok = <T>(r: T | EngineRefusal): T => {
  const x = r as EngineRefusal;
  if (x.ok === false) throw new Error(`refused: ${x.code}: ${x.message}`);
  return r as T;
};
const refusal = (r: unknown): EngineRefusal => {
  const x = r as EngineRefusal;
  if (x.ok !== false) throw new Error("expected a refusal");
  return x;
};

/** An open project with the texts the engine reports tracked after every change. */
async function open(service: EngineApi, files: Record<string, string>) {
  const summary = await service.open({
    version,
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
  });
  const texts = new Map(Object.entries(files));
  let revision = summary.revision;
  const take = (c: Changed): Changed => {
    for (const f of c.files)
      if (f.text === null) texts.delete(f.path);
      else texts.set(f.path, f.text);
    revision = c.revision;
    return c;
  };
  const projection = async (path = "main.nf", workflow: string | null = null) =>
    ok(await service.project(path, workflow)) as {
      projection: Projection;
      positions: Record<string, { x: number; y: number }>;
    };
  const id = async (local: string, path = "main.nf") => {
    const found = (await projection(path)).projection.nodes.find((n) =>
      n.id.endsWith(`/${local}`),
    );
    if (!found) throw new Error(`no node ${local}`);
    return found.id;
  };
  return {
    texts,
    take,
    projection,
    id,
    get revision() {
      return revision;
    },
    snapshot: () => Object.fromEntries([...texts].sort()),
  };
}

const sorted = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).sort());

/** Copies MAKE and SIZE from f310-copy-source, with positions, and closes the project. */
async function copied(service: EngineApi) {
  const source = await open(service, caseFiles("f310-copy-source"));
  const make = await source.id("make");
  const size = await source.id("SIZE@1");
  const { summary } = ok(
    await service.copy({
      path: "main.nf",
      workflow: null,
      nodes: [make, size],
      positions: { [make]: { x: 100, y: 50 }, [size]: { x: 400, y: 80 } },
    }),
  );
  return summary;
}

describe("F-310 engine clipboard", () => {
  it("F-310 UX-26: copy, close, open another project, paste: files, includes, calls and connection match oracle case f310-paste-across byte for byte", async () => {
    const service = createEngineService();
    expect(await service.clipboard()).toBeNull();
    const summary = await copied(service);
    expect(summary).toEqual({
      nodes: 2,
      connections: 1,
      labels: ["MAKE", "SIZE"],
      languageVersion: version,
    });
    await service.close();
    expect(await service.clipboard()).toEqual(summary);
    const target = await open(service, blankFiles());
    const plan = ok(await service.planPaste({ target: entry }));
    expect(plan.aliases).toEqual([]);
    const pasted = ok(
      await service.paste(
        { target: entry, aliases: [], at: null },
        plan.revision,
      ),
    ) as Changed;
    target.take(pasted);
    expect(target.snapshot()).toEqual(sorted(caseFiles("f310-paste-across")));
    expect(pasted.pasted).toHaveLength(2);
    expect(pasted.history).toMatchObject({
      undo: "Paste 2 nodes",
      undoCount: 1,
    });
    for (const [path, text] of Object.entries(target.snapshot()))
      expect(await service.readFile(path)).toBe(text);
  });

  it("F-310 AR-23: the paste is one undo step and undo restores exact bytes", async () => {
    const service = createEngineService();
    await copied(service);
    const target = await open(service, blankFiles());
    const before = target.snapshot();
    ok(await service.planPaste({ target: entry }));
    target.take(
      ok(
        await service.paste(
          { target: entry, aliases: [], at: null },
          target.revision,
        ),
      ) as Changed,
    );
    expect((await service.history()).undoCount).toBe(1);
    target.take(ok(await service.undo(target.revision)) as Changed);
    expect(target.snapshot()).toEqual(before);
    expect(await service.readFile("modules/local/make/main.nf")).toBeNull();
    const redone = target.take(
      ok(await service.redo(target.revision)) as Changed,
    );
    expect(redone.files.map((f) => f.path)).toContain("main.nf");
    expect(target.snapshot()).toEqual(sorted(caseFiles("f310-paste-across")));
  });

  it("F-310 ADR-0039 F-111: pasting into a workflow that calls the processes needs the aliases, and paste writes them", async () => {
    const service = createEngineService();
    await copied(service);
    const target = await open(service, caseFiles("f310-copy-source"));
    const plan = ok(await service.planPaste({ target: entry }));
    expect(plan.aliases.map((a) => [a.name, a.alias, a.reason])).toEqual([
      ["MAKE", "MAKE_2", "called"],
      ["SIZE", "SIZE_2", "called"],
    ]);
    // a paste that doesn't confirm the aliases is refused
    const unconfirmed = refusal(
      await service.paste(
        { target: entry, aliases: [], at: null },
        plan.revision,
      ),
    );
    expect(unconfirmed.message).toContain("new names");
    expect(target.snapshot()).toEqual(sorted(caseFiles("f310-copy-source")));
    target.take(
      ok(
        await service.paste(
          { target: entry, aliases: plan.aliases, at: null },
          plan.revision,
        ),
      ) as Changed,
    );
    const main = target.texts.get("main.nf") as string;
    expect(main).toContain("include { MAKE as MAKE_2 } from");
    expect(main).toContain("make_2 = MAKE_2()\n    SIZE_2(make_2)");
  });

  it("F-310 ADR-0060: a refused part rolls back with no redo step and no file changed", async () => {
    const service = createEngineService();
    const files = {
      "main.nf":
        "include { P } from './modules/local/p/main.nf'\ninclude { W } from './subworkflows/local/w/main.nf'\n\nworkflow {\n    P()\n    W()\n}\n",
      "modules/local/p/main.nf": "process P {\n    script:\n    'p'\n}\n",
      "subworkflows/local/w/main.nf":
        "workflow W {\n    main:\n    println('w')\n}\n",
    };
    const p = await open(service, files);
    ok(
      await service.copy({
        path: "main.nf",
        workflow: null,
        nodes: [await p.id("P@1"), await p.id("W@1")],
        positions: {},
      }),
    );
    // W can't call itself: the earlier parts (the include and the call of P) are rolled back
    const target = { path: "subworkflows/local/w/main.nf", workflow: "W" };
    const before = p.snapshot();
    const plan = ok(await service.planPaste({ target }));
    const r = refusal(
      await service.paste(
        { target, aliases: plan.aliases, at: null },
        plan.revision,
      ),
    );
    expect(r.message).toMatch(/^Couldn't paste: .*Nothing was changed\.$/);
    expect(r.revision).toBeGreaterThan(plan.revision);
    for (const [path, text] of Object.entries(before))
      expect(await service.readFile(path)).toBe(text);
    expect(await service.history()).toEqual({
      undo: null,
      redo: null,
      undoCount: 0,
      redoCount: 0,
    });
  });

  it("F-310 ADR-0052: positions of pasted nodes are written before the change is announced", async () => {
    const service = createEngineService();
    await copied(service);
    const target = await open(service, blankFiles());
    const pasted = target.take(
      ok(
        await service.paste(
          { target: entry, aliases: [], at: { x: 1000, y: 500 } },
          target.revision,
        ),
      ) as Changed,
    );
    const sidecar = pasted.files.find(
      (f) => f.path === ".nf-builder/layout.json",
    );
    expect(sidecar?.text).toBeTruthy();
    const parsed = parseLayout(sidecar?.text ?? "");
    if (!parsed.ok) throw new Error("layout unreadable");
    const [make, size] = pasted.pasted as readonly string[];
    // the centre of the copied nodes' offsets lands on `at`
    expect(parsed.document.nodes[make as string]).toEqual({ x: 850, y: 485 });
    expect(parsed.document.nodes[size as string]).toEqual({ x: 1150, y: 515 });
    const { positions } = await target.projection();
    expect(positions[make as string]).toEqual({ x: 850, y: 485 });
    expect(pasted.pasted).toEqual([
      await target.id("make"),
      await target.id("SIZE@1"),
    ]);
  });

  /** Pastes MAKE and SIZE at a point into a project that already has one placed node. */
  async function pastedAt() {
    const service = createEngineService();
    await copied(service);
    const target = await open(service, caseFiles("f310-delete-start"));
    const keep = await target.id("make");
    const placed = ok(
      await service.setLayout({
        revision: target.revision,
        path: "main.nf",
        workflow: null,
        positions: { [keep]: { x: 7, y: 9 } },
        replace: true,
      }),
    );
    for (const f of placed.files) target.texts.set(f.path, f.text as string);
    const plan = ok(await service.planPaste({ target: entry }));
    const pasted = target.take(
      ok(
        await service.paste(
          { target: entry, aliases: plan.aliases, at: { x: 1000, y: 500 } },
          plan.revision,
        ),
      ) as Changed,
    );
    const layout = () =>
      parseLayout(target.snapshot()[".nf-builder/layout.json"] as string);
    return { service, target, keep, pasted, layout };
  }

  const nodesOf = (l: ReturnType<typeof parseLayout>) => {
    if (!l.ok) throw new Error(`invalid sidecar: ${l.message}`);
    return l.document.nodes;
  };

  it("F-310 ADR-0052: paste at a point, move a node, undo: the sidecar stays valid, the moved node keeps its move and the pasted keys go", async () => {
    const { service, target, keep, pasted, layout } = await pastedAt();
    const pastedIds = pasted.pasted as readonly string[];
    expect(pastedIds).toHaveLength(2);
    for (const id of pastedIds) expect(nodesOf(layout())[id]).toBeDefined();
    const moved = ok(
      await service.setLayout({
        revision: target.revision,
        path: "main.nf",
        workflow: null,
        positions: { [keep]: { x: 70, y: 90 } },
        replace: false,
      }),
    );
    for (const f of moved.files) target.texts.set(f.path, f.text as string);
    const undone = target.take(
      ok(await service.undo(target.revision)) as Changed,
    );
    expect(undone.history.redo).toBe("Paste 2 nodes");
    const nodes = nodesOf(layout());
    expect(Object.keys(nodes)).toEqual([keep]);
    expect(nodes[keep]).toEqual({ x: 70, y: 90 });
    const redone = target.take(
      ok(await service.redo(target.revision)) as Changed,
    );
    expect(redone.history.undo).toBe("Paste 2 nodes");
    const back = nodesOf(layout());
    expect(back[keep]).toEqual({ x: 70, y: 90 });
    for (const id of pastedIds) expect(back[id]).toBeDefined();
  });

  it("F-310 ADR-0052: paste at a point then undo with no move leaves the other keys as they were", async () => {
    const { service, target, keep, layout } = await pastedAt();
    target.take(ok(await service.undo(target.revision)) as Changed);
    expect(nodesOf(layout())).toEqual({ [keep]: { x: 7, y: 9 } });
  });

  it("F-310 UX-26: paste with no point writes no sidecar entries", async () => {
    const service = createEngineService();
    await copied(service);
    const target = await open(service, blankFiles());
    const pasted = ok(
      await service.paste(
        { target: entry, aliases: [], at: null },
        target.revision,
      ),
    ) as Changed;
    target.take(pasted);
    expect(target.snapshot()[".nf-builder/layout.json"]).toBeUndefined();
  });

  it("F-310 ADR-0052: undo of a multi-node delete restores the sidecar byte for byte", async () => {
    const service = createEngineService();
    const p = await open(service, caseFiles("f310-delete-start"));
    const ids = [
      await p.id("make"),
      await p.id("SIZE@1"),
      await p.id("STAMP@1"),
    ];
    const layout = ok(
      await service.setLayout({
        revision: p.revision,
        path: "main.nf",
        workflow: null,
        positions: {
          [ids[0] as string]: { x: 10, y: 20 },
          [ids[1] as string]: { x: 300, y: 40 },
          [ids[2] as string]: { x: 300, y: 200 },
        },
        replace: true,
      }),
    );
    for (const f of layout.files) p.texts.set(f.path, f.text as string);
    const before = p.snapshot();
    expect(before[".nf-builder/layout.json"]).toBeTruthy();
    p.take(
      ok(
        await service.apply(
          {
            kind: "deleteNodes",
            target: entry,
            nodes: [ids[1] as string, ids[2] as string],
          },
          p.revision,
        ),
      ) as Changed,
    );
    expect(p.snapshot()).not.toEqual(before);
    p.take(ok(await service.undo(p.revision)) as Changed);
    expect(p.snapshot()).toEqual(before);
  });

  it("F-310 AR-30: the clipboard survives close and nothing but a summary leaves the engine", async () => {
    const service = createEngineService();
    await copied(service);
    await service.close();
    const summary = await service.clipboard();
    expect(JSON.stringify(summary)).not.toContain("process MAKE");
    expect(refusal(await service.planPaste({ target: entry })).code).toBe(
      "no-project",
    );
  });

  it("F-310: copy and paste refuse with nothing copied or no project", async () => {
    const service = createEngineService();
    expect(
      refusal(
        await service.copy({
          path: "main.nf",
          workflow: null,
          nodes: [],
          positions: {},
        }),
      ).code,
    ).toBe("no-project");
    await open(service, blankFiles());
    const r = refusal(await service.planPaste({ target: entry }));
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("Nothing has been copied");
  });
});
