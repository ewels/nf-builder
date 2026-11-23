import { NO_RANGE } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  type LayoutDocument,
  matchNodes,
  pairWorkflows,
  RemovedPositions,
} from "../../src/layout";
import { port } from "../edit/helpers";
import { perturbWhitespace } from "../projection/whitespace";
import {
  entry,
  fixtureState,
  seedLayout,
  snapshot,
  step,
  stepPatches,
} from "./helpers";

const COUNT_FILE = "modules/local/count/main.nf";

const VIEWS = (body: string) =>
  `nextflow.enable.types = true\n\ninclude { COUNT } from './modules/local/count/main.nf'\n\nworkflow {\n${body}}\n`;

const entryNodes = (doc: LayoutDocument) =>
  Object.keys(doc.nodes)
    .filter((k) => k.startsWith("main.nf#/"))
    .sort();

describe("F-207 carry", () => {
  it("F-207 AR-11 ADR-0036: a whitespace-only re-parse maps every node to itself", async () => {
    const state = await fixtureState();
    const before = snapshot(state);
    const doc = seedLayout(before);
    expect(entryNodes(doc)).toEqual([
      "main.nf#/.view@1",
      "main.nf#/COUNT@1",
      "main.nf#/channel.fromPath@1",
      "main.nf#/more",
      "main.nf#/reads",
    ]);
    for (const path of ["main.nf", COUNT_FILE]) {
      const source = state.model.file(path)?.source;
      const text = perturbWhitespace(
        source?.text as string,
        source?.ast ?? null,
        207,
        "all",
      );
      expect(text).not.toBe(source?.text);
      const next = step(state, doc, { kind: "replaceFileText", path, text });
      expect(next.doc).toEqual(doc);
      for (const [key, projection] of before.projections) {
        const after = next.after.projections.get(key);
        expect(after).toBeDefined();
        const map = matchNodes(projection, after as typeof projection);
        expect([...map]).toEqual(projection.nodes.map((n) => [n.id, n.id]));
      }
    }
  });

  it("F-207 step 3 ADR-0008: renaming a process carries its unassigned call key (COUNT@1 to TALLY@1); an aliased include's call keeps its key", async () => {
    const state = await fixtureState("f111-start-typed", {
      "other.nf":
        "nextflow.enable.types = true\n\ninclude { COUNT as CNT } from './modules/local/count/main.nf'\n\nworkflow OTHER {\n    CNT(channel.fromPath('x'))\n}\n",
    });
    const before = snapshot(state);
    const doc = seedLayout(before);
    expect(doc.nodes["other.nf#OTHER/CNT@1"]).toBeDefined();
    const next = step(state, doc, {
      kind: "renameDeclaration",
      path: COUNT_FILE,
      name: "COUNT",
      newName: "TALLY",
    });
    expect(next.doc.nodes["main.nf#/TALLY@1"]).toEqual(
      doc.nodes["main.nf#/COUNT@1"],
    );
    expect(next.doc.nodes["main.nf#/COUNT@1"]).toBeUndefined();
    expect(next.doc.nodes["other.nf#OTHER/CNT@1"]).toEqual(
      doc.nodes["other.nf#OTHER/CNT@1"],
    );
    expect(Object.keys(next.doc.nodes)).toHaveLength(
      Object.keys(doc.nodes).length,
    );
    expect(next.after.projections.get("other.nf#OTHER")).toBeDefined();
  });

  it("F-207 ADR-0008: renaming a workflow carries every key of that workflow", async () => {
    const state = await fixtureState("f111-start-typed", {
      "other.nf":
        "nextflow.enable.types = true\n\ninclude { COUNT } from './modules/local/count/main.nf'\n\nworkflow OTHER {\n    xs = channel.of('a')\n    COUNT(channel.fromPath('x'))\n    xs.view()\n}\n",
    });
    const before = snapshot(state);
    const doc = seedLayout(before);
    const next = step(state, doc, {
      kind: "renameDeclaration",
      path: "other.nf",
      name: "OTHER",
      newName: "THAT",
    });
    const moved = Object.entries(doc.nodes).filter(([k]) =>
      k.startsWith("other.nf#OTHER/"),
    );
    expect(moved).toHaveLength(4);
    for (const [k, p] of moved)
      expect(next.doc.nodes[k.replace("#OTHER/", "#THAT/")]).toEqual(p);
    expect(Object.keys(next.doc.nodes).some((k) => k.includes("#OTHER/"))).toBe(
      false,
    );
    expect(Object.keys(next.doc.nodes)).toHaveLength(
      Object.keys(doc.nodes).length,
    );
  });

  it("F-207 F-111: Connect's new variable carries FOO@1 to its variable key; a moved statement keeps every node's position", async () => {
    const state = await fixtureState();
    const doc0 = seedLayout(snapshot(state));
    // ALIGN@1 is new: place it, then connect its output so a variable is introduced
    const added = step(state, doc0, {
      kind: "addCall",
      target: entry,
      callee: "ALIGN",
    });
    const ALIGN = { x: 900, y: 40 };
    const doc1: LayoutDocument = {
      ...added.doc,
      nodes: { ...added.doc.nodes, "main.nf#/ALIGN@1": ALIGN },
    };
    const connected = step(state, doc1, {
      kind: "connect",
      target: entry,
      from: port(state, "ALIGN@1", "out"),
      to: port(state, "COUNT@1", "aligned"),
    });
    const ids = Object.keys(connected.doc.nodes).filter((k) =>
      k.startsWith("main.nf#/"),
    );
    // the ALIGN call now has a variable: its node follows it, and nothing was lost
    expect(ids.some((k) => k.startsWith("main.nf#/ALIGN@"))).toBe(false);
    const variable = ids.find(
      (k) => !doc1.nodes[k] && connected.doc.nodes[k]?.x === ALIGN.x,
    );
    expect(variable).toBeDefined();
    // the call COUNT read its input from is now fed by ALIGN, so that node is gone; every other one kept its position
    expect(connected.doc.nodes["main.nf#/channel.fromPath@1"]).toBeUndefined();
    expect(Object.keys(connected.doc.nodes)).toHaveLength(
      Object.keys(doc1.nodes).length - 1,
    );
    for (const k of Object.keys(doc1.nodes))
      if (k !== "main.nf#/ALIGN@1" && k !== "main.nf#/channel.fromPath@1")
        expect(connected.doc.nodes[k], k).toEqual(doc1.nodes[k]);
    // every projected node of the workflow has its position
    const projection = connected.after.projections.get("main.nf#");
    for (const n of projection?.nodes ?? [])
      expect(connected.doc.nodes[n.id], n.id).toBeDefined();
  });

  it("F-207 F-111: deleting the first of two calls moves the second's entry to the shifted key and removes the deleted one", async () => {
    const state = await fixtureState("f111-start-typed", {
      "main.nf":
        "nextflow.enable.types = true\n\ninclude { COUNT } from './modules/local/count/main.nf'\n\nworkflow {\n    a = channel.of('a')\n    b = channel.of('b')\n    a.view()\n    b.view()\n}\n",
    });
    const before = snapshot(state);
    const doc = seedLayout(before);
    const [first, second] = ["main.nf#/.view@1", "main.nf#/.view@2"];
    expect(doc.nodes[first as string]).toBeDefined();
    const next = step(state, doc, {
      kind: "deleteNode",
      target: entry,
      node: first as string,
    });
    expect(next.doc.nodes[first as string]).toEqual(
      doc.nodes[second as string],
    );
    expect(next.doc.nodes[second as string]).toBeUndefined();
    expect(next.doc.nodes["main.nf#/a"]).toEqual(doc.nodes["main.nf#/a"]);
    expect(next.doc.nodes["main.nf#/b"]).toEqual(doc.nodes["main.nf#/b"]);
  });

  it("F-207 AR-23 F-111: deleting the first of two identical calls keeps the survivor's own position, and undo restores both", async () => {
    const state = await fixtureState("f111-start-typed", {
      "main.nf":
        "nextflow.enable.types = true\n\ninclude { COUNT } from './modules/local/count/main.nf'\n\nworkflow {\n    a = channel.of('a')\n    a.view()\n    a.view()\n}\n",
    });
    const removed = new RemovedPositions();
    const start = seedLayout(snapshot(state));
    const [first, second] = ["main.nf#/.view@1", "main.nf#/.view@2"] as const;
    const del = step(
      state,
      start,
      { kind: "deleteNode", target: entry, node: first },
      removed,
    );
    // the survivor was the second call; it is now the first, and keeps the second's position
    expect(del.doc.nodes[first]).toEqual(start.nodes[second]);
    expect(del.doc.nodes[second]).toBeUndefined();
    const undone = stepPatches(state, del.doc, del.inverse, removed, {
      inserted: [first],
    });
    expect(undone.doc).toEqual(start);
  });

  it("F-207 AR-23: a text edit that adds an identical node is not a restore, so the survivor stays put", async () => {
    const body = "    a = channel.of('a')\n    a.view()\n    a.view()\n";
    const state = await fixtureState("f111-start-typed", {
      "main.nf": VIEWS(body),
    });
    const removed = new RemovedPositions();
    const start = seedLayout(snapshot(state));
    const [first, second] = ["main.nf#/.view@1", "main.nf#/.view@2"] as const;
    const del = step(
      state,
      start,
      { kind: "deleteNode", target: entry, node: first },
      removed,
    );
    const added = step(
      state,
      del.doc,
      {
        kind: "replaceFileText",
        path: "main.nf",
        text: VIEWS(`${body}    a.view()\n`),
      } as never,
      removed,
    );
    expect(added.doc.nodes[first]).toEqual(start.nodes[second]);
  });

  it("F-207 AR-23: deleting two identical calls one at a time and undoing twice restores both positions", async () => {
    const state = await fixtureState("f111-start-typed", {
      "main.nf": VIEWS("    a = channel.of('a')\n    a.view()\n    a.view()\n"),
    });
    const removed = new RemovedPositions();
    const start = seedLayout(snapshot(state));
    const first = "main.nf#/.view@1";
    const d1 = step(
      state,
      start,
      { kind: "deleteNode", target: entry, node: first },
      removed,
    );
    const d2 = step(
      state,
      d1.doc,
      { kind: "deleteNode", target: entry, node: first },
      removed,
    );
    const u2 = stepPatches(state, d2.doc, d2.inverse, removed, {
      inserted: [first],
    });
    const u1 = stepPatches(state, u2.doc, d1.inverse, removed, {
      inserted: [first],
    });
    expect(u1.doc).toEqual(start);
  });

  it("F-207 F-111: AddCall leaves exactly the new node unplaced", async () => {
    const state = await fixtureState();
    const doc = seedLayout(snapshot(state));
    const next = step(state, doc, {
      kind: "addCall",
      target: entry,
      callee: "ALIGN",
    });
    expect(next.doc).toEqual(doc);
    const projection = next.after.projections.get("main.nf#");
    const unplaced = (projection?.nodes ?? [])
      .map((n) => n.id)
      .filter((id) => next.doc.nodes[id] === undefined);
    expect(unplaced).toEqual(["main.nf#/ALIGN@1"]);
  });

  it("F-207 AR-23: undoing a rename, a connect and a delete carries keys back and restores the deleted node's position", async () => {
    const state = await fixtureState("f111-start-typed", {
      "main.nf":
        "nextflow.enable.types = true\n\ninclude { COUNT } from './modules/local/count/main.nf'\n\nworkflow {\n    a = channel.of('a')\n    b = channel.of('b')\n    a.view()\n    b.view()\n    COUNT(channel.fromPath('x'))\n}\n",
    });
    const removed = new RemovedPositions();
    const start = seedLayout(snapshot(state));
    const rename = step(
      state,
      start,
      {
        kind: "renameDeclaration",
        path: COUNT_FILE,
        name: "COUNT",
        newName: "TALLY",
      },
      removed,
    );
    expect(rename.doc.nodes["main.nf#/TALLY@1"]).toEqual(
      start.nodes["main.nf#/COUNT@1"],
    );
    const connect = step(
      state,
      rename.doc,
      {
        kind: "connect",
        target: entry,
        from: port(state, "a", "out"),
        to: port(state, "TALLY@1", "aligned"),
      },
      removed,
    );
    expect(connect.doc.nodes["main.nf#/channel.fromPath@1"]).toBeUndefined();
    const del = step(
      state,
      connect.doc,
      { kind: "deleteNode", target: entry, node: "main.nf#/.view@1" },
      removed,
    );
    expect(Object.keys(del.doc.nodes)).toHaveLength(
      Object.keys(start.nodes).length - 2,
    );
    let doc = del.doc;
    for (const undone of [del, connect, rename])
      doc = stepPatches(state, doc, undone.inverse, removed).doc;
    expect(doc).toEqual(start);
  });

  it("F-207: a ReplaceFileText that edits a code statement keeps its position", async () => {
    const state = await fixtureState("f111-start-typed", {
      "main.nf":
        "nextflow.enable.types = true\n\nworkflow {\n    xs = channel.of('a')\n    println('one')\n    xs.view()\n}\n",
    });
    const before = snapshot(state);
    const doc = seedLayout(before);
    const code = Object.keys(doc.nodes).find((k) => k.includes("/:code@"));
    expect(code).toBeDefined();
    const next = step(state, doc, {
      kind: "replaceFileText",
      path: "main.nf",
      text: "nextflow.enable.types = true\n\nworkflow {\n    xs = channel.of('a')\n    println('two, edited')\n    xs.view()\n}\n",
    });
    expect(next.doc).toEqual(doc);
  });

  it("F-207 ADR-0008: a vanished workflow drops its entries; an unmodelled one keeps them; one vanished and one new workflow in the same file pair up", async () => {
    const wf = (name: string, modelled = true) => ({
      path: "a.nf",
      name,
      modelled,
      typed: null,
      range: NO_RANGE,
    });
    const refs = (...names: string[]) => names.map((n) => wf(n));
    // same name: itself; vanished with no pair: null
    const same = pairWorkflows(refs("A", "B"), refs("A"), new Set(), []);
    expect(same.get("a.nf#A")?.name).toBe("A");
    expect(same.get("a.nf#B")).toBeNull();
    // a rename hint
    const hinted = pairWorkflows(
      refs("A", "B"),
      refs("A", "C", "D"),
      new Set(["a.nf"]),
      [{ path: "a.nf", from: "B", to: "C" }],
    );
    expect(hinted.get("a.nf#B")?.name).toBe("C");
    // one vanished and one new in a changed file
    const lone = pairWorkflows(
      refs("A", "B"),
      refs("A", "Z"),
      new Set(["a.nf"]),
      [],
    );
    expect(lone.get("a.nf#B")?.name).toBe("Z");
    // two vanished: no guess
    const two = pairWorkflows(
      refs("B", "C"),
      refs("Y", "Z"),
      new Set(["a.nf"]),
      [],
    );
    expect(two.get("a.nf#B")).toBeNull();
    expect(two.get("a.nf#C")).toBeNull();
    // not a changed file: no pairing by elimination
    const untouched = pairWorkflows(refs("B"), refs("Z"), new Set(), []);
    expect(untouched.get("a.nf#B")).toBeNull();

    // an unmodelled workflow keeps its entries, a vanished one loses them
    const state = await fixtureState("f111-start-typed", {
      "other.nf":
        "nextflow.enable.types = true\n\nworkflow ONE {\n    xs = channel.of('a')\n    xs.view()\n}\n\nworkflow TWO {\n    ys = channel.of('b')\n    ys.view()\n}\n",
    });
    const doc = seedLayout(snapshot(state));
    const dropped = step(state, doc, {
      kind: "replaceFileText",
      path: "other.nf",
      text: "nextflow.enable.types = true\n\nworkflow ONE {\n    xs = channel.of('a')\n    xs.view()\n}\n",
    });
    expect(
      Object.keys(dropped.doc.nodes).filter((k) => k.includes("#TWO/")),
    ).toEqual([]);
    expect(
      Object.keys(dropped.doc.nodes).filter((k) => k.includes("#ONE/")),
    ).toEqual(Object.keys(doc.nodes).filter((k) => k.includes("#ONE/")));
  });

  it("F-207 ADR-0008: the entries of a workflow the parser couldn't model are kept", async () => {
    const state = await fixtureState("f111-start-typed", {
      "other.nf":
        "nextflow.enable.types = true\n\nworkflow ONE {\n    xs = channel.of('a'\n}\n",
    });
    const before = snapshot(state);
    const broken = before.workflows.find((w) => w.path === "other.nf");
    expect(broken?.modelled).toBe(false);
    const kept = { "other.nf#ONE/xs": { x: 5, y: 6 } };
    const doc: LayoutDocument = {
      version: 1,
      nodes: { ...seedLayout(before).nodes, ...kept },
    };
    const next = step(state, doc, {
      kind: "addCall",
      target: entry,
      callee: "ALIGN",
    });
    expect(next.doc.nodes["other.nf#ONE/xs"]).toEqual({ x: 5, y: 6 });
  });
});
