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
const open = (body: string[], extra = "") =>
  stateFor({
    "b.nf": B,
    "main.nf": `${head}${extra}workflow {\n${body.map((l) => `    ${l}`).join("\n")}\n}\n`,
  });

describe("F-111 DeleteNode", () => {
  it("F-111 AR-21: DeleteNode removes the node's statement and clears direct arguments it fed", async () => {
    const state = await open([
      "// keep",
      "a = channel.of(1)",
      "b = channel.of(2)",
      "B(a, b)",
      "B(b, 1)",
    ]);
    const r = accepted(state, {
      kind: "deleteNode",
      target,
      node: node(state, "b").id,
    });
    const text = main(r) as string;
    expect(text).not.toContain("channel.of(2)");
    expect(text).toContain("B(a)\n    B(null, 1)");
    expect(text).toContain("// keep");
    commit(state, r);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    expect(projection(state).nodes.some((n) => n.id.endsWith("/b"))).toBe(
      false,
    );
  });

  it("F-111: DeleteNode on a nested node clears its argument; take, emit, params and output nodes are refused", async () => {
    const state = await open(["B(channel.of(1), 2)"]);
    const r = accepted(state, {
      kind: "deleteNode",
      target,
      node: node(state, "channel.of@1").id,
    });
    expect(main(r)).toContain("B(null, 2)");
    const roles = await stateFor({
      "b.nf": B,
      "main.nf": `nextflow.enable.types = true\n\nparams {\n    reads: String\n}\n\nworkflow {\n    main:\n    d = params.reads\n    publish:\n    res = d\n}\n\noutput {\n    res {\n        path 'x'\n    }\n}\n`,
    });
    for (const n of projection(roles).nodes.filter((x) =>
      ["params", "output"].includes(x.kind),
    ))
      expect(
        refused(roles, { kind: "deleteNode", target, node: n.id }).code,
        n.kind,
      ).toBe("invalid");
    const w = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    take:\n    t\n\n    main:\n    B()\n\n    emit:\n    out = t\n}\n`,
    });
    for (const local of [":take:t", ":emit:out"])
      expect(
        refused(w, {
          kind: "deleteNode",
          target: { path: "main.nf", workflow: "W" },
          node: node(w, local, "main.nf", "W").id,
        }).code,
        local,
      ).toBe("invalid");
    expect(
      refused(state, { kind: "deleteNode", target, node: "nope" }).code,
    ).toBe("not-found");
  });

  it("F-111 AR-21: DeleteNode of the only statement in main drops the empty main section when the workflow stays valid, and refuses when it would not", async () => {
    const ok = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    take:\n    ids\n\n    main:\n    B(ids)\n\n    emit:\n    ids\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const r = accepted(ok, {
      kind: "deleteNode",
      target: w,
      node: node(ok, "B@1", "main.nf", "W").id,
    });
    expect(main(r)).toContain(
      "workflow W {\n    take:\n    ids\n\n    emit:\n    ids\n}",
    );
    commit(ok, r);
    expect(ok.model.file("main.nf")?.source.problems).toEqual([]);
    // take with nothing after it doesn't parse, so the delete is refused
    const takeOnly = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    take:\n    ids\n\n    main:\n    B(ids)\n}\n`,
    });
    const refusal = refused(takeOnly, {
      kind: "deleteNode",
      target: w,
      node: node(takeOnly, "B@1", "main.nf", "W").id,
    });
    expect(refusal.code).toBe("invalid");
    expect(refusal.message).toContain("only statement");
    expect(texts(takeOnly)["main.nf"]).toContain("B(ids)");
    // a workflow with no sections but main becomes empty
    const bare = await stateFor({
      "b.nf": B,
      "main.nf": `${head}workflow W {\n    B()\n}\n\nworkflow {\n    W()\n}\n`,
    });
    const e = accepted(bare, {
      kind: "deleteNode",
      target: w,
      node: node(bare, "B@1", "main.nf", "W").id,
    });
    commit(bare, e);
    expect(bare.model.file("main.nf")?.source.problems).toEqual([]);
  });
});
