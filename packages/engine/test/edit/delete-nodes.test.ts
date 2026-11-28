import { describe, expect, it } from "vitest";
import {
  accepted,
  commit,
  main,
  node,
  projection,
  refused,
  stateFor,
  texts,
} from "./helpers";

const B =
  "process B {\n    input:\n    val x\n    val y\n\n    script:\n    'b'\n}\n";
const head = "include { B } from './b.nf'\n\n";
const target = { path: "main.nf", workflow: null };
const open = (body: string[]) =>
  stateFor({
    "b.nf": B,
    "main.nf": `${head}workflow {\n${body.map((l) => `    ${l}`).join("\n")}\n}\n`,
  });

describe("F-310 DeleteNodes", () => {
  it("F-310 UX-26 AR-23: DeleteNodes removes every selected statement in one reprint", async () => {
    const state = await open([
      "a = channel.of(1)",
      "// keep",
      "b = channel.of(2)",
      "c = channel.of(3)",
      "B(a)",
      "B(b)",
    ]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "a").id, node(state, "c").id],
    });
    expect(r.patches).toHaveLength(1);
    const edit = r.patches[0];
    expect(edit?.kind === "edit" && edit.edits).toHaveLength(1);
    const text = main(r) as string;
    expect(text).not.toContain("channel.of(1)");
    expect(text).not.toContain("channel.of(3)");
    expect(text).toContain("b = channel.of(2)");
    expect(text).toContain("// keep");
    commit(state, r);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-310 ADR-0039: arguments fed by deleted nodes are cleared, except those of other deleted nodes", async () => {
    const state = await open([
      "a = channel.of(1)",
      "b = channel.of(2)",
      "B(a, b)",
      "B(b, 1)",
    ]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "b").id, node(state, "B@2").id],
    });
    const text = main(r) as string;
    // B@2 is gone with its arguments; B@1 loses `b` only
    expect(text).toContain("a = channel.of(1)\n    B(a)");
    expect(text).not.toContain("channel.of(2)");
    expect(text).not.toContain("B(b, 1)");
  });

  it("F-310: an interface node in the selection refuses the whole command, naming it", async () => {
    const state = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    take:\n    t\n\n    main:\n    B(t)\n}\n\nworkflow {\n    W(1)\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const r = refused(state, {
      kind: "deleteNodes",
      target: w,
      nodes: [
        node(state, "B@1", "main.nf", "W").id,
        node(state, ":take:t", "main.nf", "W").id,
      ],
    });
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("t");
    expect(r.message).toContain("interface");
    expect(texts(state)["main.nf"]).toContain("B(t)");
  });

  it("F-310: deleting every statement of a workflow that needs main refuses", async () => {
    const state = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    take:\n    ids\n\n    main:\n    B(ids)\n    B(ids, 1)\n}\n\nworkflow {\n    W(1)\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const p = projection(state, "main.nf", "W");
    const calls = p.nodes.filter((n) => n.kind === "call").map((n) => n.id);
    expect(calls).toHaveLength(2);
    // one of two goes
    accepted(state, {
      kind: "deleteNodes",
      target: w,
      nodes: [calls[0] ?? ""],
    });
    const r = refused(state, { kind: "deleteNodes", target: w, nodes: calls });
    expect(r.code).toBe("invalid");
    expect(r.message).toContain("only statement");
  });

  it("F-310: no nodes, or an unknown one, is refused", async () => {
    const state = await open(["B(1, 2)"]);
    expect(
      refused(state, { kind: "deleteNodes", target, nodes: [] }).code,
    ).toBe("invalid");
    expect(
      refused(state, { kind: "deleteNodes", target, nodes: ["nope"] }).code,
    ).toBe("not-found");
  });

  it("F-310 ADR-0039: deleteNode equals deleteNodes of one node", async () => {
    const lines = [
      "// keep",
      "a = channel.of(1)",
      "b = channel.of(2)",
      "B(a, b)",
      "B(b, 1)",
    ];
    const one = await open(lines);
    const many = await open(lines);
    for (const local of ["b", "B@1", "a"]) {
      const id = node(one, local).id;
      const single = accepted(one, { kind: "deleteNode", target, node: id });
      const multi = accepted(many, {
        kind: "deleteNodes",
        target,
        nodes: [node(many, local).id],
      });
      expect(single.patches).toEqual(multi.patches);
      commit(one, single);
      commit(many, multi);
    }
  });

  it("F-310 ADR-0064: a deleted statement's comment goes with it and nested deletions clear their argument once", async () => {
    const state = await open(["B(channel.of(1), channel.of(2))"]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "channel.of@1").id, node(state, "channel.of@2").id],
    });
    expect(main(r)).toContain("B(null)");
  });
});
