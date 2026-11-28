import { describe, expect, it } from "vitest";
import { accepted, main, node, port, stateFor } from "./helpers";

const B = "process B {\n    input:\n    val x\n\n    script:\n    'b'\n}\n";
const C = "process C {\n    script:\n    'c'\n}\n";
const head = "include { B } from './b.nf'\ninclude { C } from './c.nf'\n\n";
const target = { path: "main.nf", workflow: null };
const open = (body: string[], tail = "") =>
  stateFor({
    "b.nf": B,
    "c.nf": C,
    "main.nf": `${head}workflow {\n${body.map((l) => `    ${l}`).join("\n")}\n${tail}}\n`,
  });

describe("F-310 unread assignment cleanup", () => {
  it("F-310 ADR-0064: delete of the only reader turns `x = P()` into `P()`", async () => {
    const state = await open(["c = C()", "B(c)"]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("workflow {\n    C()\n}");
  });

  it("F-310 ADR-0064: Disconnect of the only reader does the same", async () => {
    const state = await open(["c = C()", "B(c)"]);
    const r = accepted(state, {
      kind: "disconnect",
      target,
      port: port(state, "B@1", "x"),
    });
    expect(main(r)).toContain("workflow {\n    C()\n    B()\n}");
  });

  it("F-310: a name still read by another reader, emit or publish keeps its assignment", async () => {
    const two = await stateFor({
      "b.nf": `${B}\n${B.replace("process B", "process D")}`,
      "c.nf": C,
      "main.nf":
        "include { B; D } from './b.nf'\ninclude { C } from './c.nf'\n\nworkflow {\n    c = C()\n    B(c)\n    D(c)\n}\n",
    });
    const kept = accepted(two, {
      kind: "deleteNodes",
      target,
      nodes: [node(two, "B@1").id],
    });
    expect(main(kept)).toContain("c = C()");
    const emits = await stateFor({
      "b.nf": B,
      "c.nf": C,
      "main.nf": `${head}workflow W {\n    main:\n    c = C()\n    B(c)\n\n    emit:\n    out = c\n}\n\nworkflow {\n    W()\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const r = accepted(emits, {
      kind: "deleteNodes",
      target: w,
      nodes: [node(emits, "B@1", "main.nf", "W").id],
    });
    expect(main(r)).toContain("c = C()");
  });

  it("F-310: an assignment already unread before the command is untouched", async () => {
    const state = await open(["unused = C()", "b = channel.of(1)", "B(b)"]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("unused = C()");
  });

  it("F-310 ADR-0064: a non-call right-hand side is untouched", async () => {
    const state = await open(["b = channel.of(1)", "B(b)"]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("b = channel.of(1)");
  });

  it("F-310: the comment above a cleaned assignment stays", async () => {
    const state = await open(["// the source", "c = C()", "B(c)"]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("// the source\n    C()");
  });

  it("F-310 ADR-0064: a read inside a closure keeps the assignment", async () => {
    const state = await open([
      "c = C()",
      "B(c)",
      "channel.of(1).map { v -> c }",
    ]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("c = C()");
  });

  it("F-310 ADR-0064: a reassigned name that is still read keeps both assignments", async () => {
    const state = await open([
      "c = C()",
      "B(c)",
      "c = channel.of(2)",
      "channel.of(3).map { v -> c }",
    ]);
    const r = accepted(state, {
      kind: "deleteNodes",
      target,
      nodes: [node(state, "B@1").id],
    });
    expect(main(r)).toContain("c = C()");
    expect(main(r)).toContain("c = channel.of(2)");
  });
});
