import { describe, expect, it } from "vitest";
import {
  accepted,
  commit,
  node,
  port,
  projection,
  refused,
  stateFor,
  texts,
} from "./helpers";

const flag = "nextflow.enable.types = true\n\n";
const B = `${flag}process B {\n    input:\n    x: String\n    y: String\n\n    output:\n    file('b')\n\n    script:\n    'b'\n}\n`;
const C = `${flag}process C {\n    input:\n    x: String\n\n    output:\n    file('c')\n\n    script:\n    'c'\n}\n`;
const procs = { "b.nf": B, "c.nf": C };
const head = `${flag}include { B } from './b.nf'\ninclude { C } from './c.nf'\n\n`;
const target = { path: "main.nf", workflow: null };
const wf = (body: string[]) =>
  `${head}workflow {\n${body.map((l) => `    ${l}`).join("\n")}\n}\n`;
const open = (body: string[]) => stateFor({ ...procs, "main.nf": wf(body) });
const connect = (
  state: Awaited<ReturnType<typeof open>>,
  from: [string, string],
  to: [string, string],
) => ({
  kind: "connect" as const,
  target,
  from: port(state, ...from),
  to: port(state, ...to),
});
const main = (r: { files: readonly { path: string; text: string | null }[] }) =>
  r.files.find((f) => f.path === "main.nf")?.text;

describe("F-111 Connect", () => {
  it("F-111 UX-25 AR-21: Connect rewrites the argument feeding an input port", async () => {
    const state = await open([
      "reads = channel.of('a')",
      "more = channel.of('b')",
      "B(channel.of('x'), reads)",
    ]);
    // inline -> reference
    const first = accepted(
      state,
      connect(state, ["reads", "out"], ["B@1", "x"]),
    );
    expect(main(first)).toBe(
      wf([
        "reads = channel.of('a')",
        "more = channel.of('b')",
        "B(reads, reads)",
      ]),
    );
    commit(state, first);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    // reference -> reference
    const second = accepted(
      state,
      connect(state, ["more", "out"], ["B@1", "y"]),
    );
    expect(main(second)).toContain("B(reads, more)");
    // a nested node is replaced
    const nested = await open([
      "reads = channel.of('a')",
      "B(reads.map { it }, reads)",
    ]);
    const third = accepted(
      nested,
      connect(nested, ["reads", "out"], ["B@1", "x"]),
    );
    expect(main(third)).toContain("B(reads, reads)");
    expect(main(third)).not.toContain("map");
  });

  it("F-111 UX-25: Connect to a missing argument pads earlier positions with null", async () => {
    const state = await open(["reads = channel.of('a')", "B()"]);
    const r = accepted(state, connect(state, ["reads", "out"], ["B@1", "y"]));
    expect(main(r)).toContain("B(null, reads)");
    commit(state, r);
    expect(projection(state).edges).toHaveLength(1);
  });

  it("F-111 AR-10: Connect from an unassigned node assigns it to a new variable", async () => {
    const state = await open([
      "of_ch = channel.of(0)",
      "B()",
      "// make",
      "channel.of(1) // tail",
    ]);
    const r = accepted(
      state,
      connect(state, ["channel.of@1", "out"], ["B@1", "x"]),
    );
    const text = main(r) as string;
    // fresh name, the statement moved above the call, comments kept
    expect(text).toMatch(
      /of_ch_2 = channel\.of\(1\) \/\/ tail\n {4}B\(of_ch_2\)/,
    );
    expect(text).toContain("// make");
    commit(state, r);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
    expect(projection(state).edges.some((e) => e.variable === "of_ch_2")).toBe(
      true,
    );
    // a call gets its callee name in lower case
    const calls = await open(["C(1)", "B()"]);
    const c = accepted(calls, connect(calls, ["C@1", "out"], ["B@1", "x"]));
    expect(main(c)).toContain("c = C(1)\n    B(c)");
  });

  it("F-111 LA-14: Connect from a multi-output call reads the output by name", async () => {
    const state = await stateFor({
      ...procs,
      "p.nf":
        "nextflow.enable.types = true\n\nprocess P {\n    output:\n    a: Path = file('a')\n    b: Path = file('b')\n\n    script:\n    'p'\n}\n",
      "main.nf": `nextflow.enable.types = true\n\ninclude { P } from './p.nf'\ninclude { C } from './c.nf'\n\nworkflow {\n    r = P()\n    C()\n}\n`,
    });
    const outs = node(state, "r").outputs.map((o) => o.id);
    expect(outs.length).toBeGreaterThan(1);
    const r = accepted(
      state,
      connect(state, ["r", outs[1] as string], ["C@1", "x"]),
    );
    expect(main(r)).toContain(`C(r.${outs[1]})`);
    commit(state, r);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-111: Connect from take and params nodes reads the take and params.<name>", async () => {
    const state = await stateFor({
      ...procs,
      "main.nf": `nextflow.enable.types = true\n\ninclude { C } from './c.nf'\n\nparams {\n    reads: String\n}\n\nworkflow W {\n    take:\n    t: String\n\n    main:\n    C()\n    C()\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const a = accepted(state, {
      kind: "connect",
      target: w,
      from: port(state, ":take:t", "out", "main.nf", "W"),
      to: port(state, "C@1", "x", "main.nf", "W"),
    });
    expect(main(a)).toContain("C(t)");
    // the params node is only in the entry workflow's projection when it reads params; use a code-free check
    const params = projection(state, "main.nf", "W").nodes.find(
      (n) => n.kind === "params",
    );
    if (params) {
      const b = accepted(state, {
        kind: "connect",
        target: w,
        from: { node: params.id, port: "reads" },
        to: port(state, "C@1", "x", "main.nf", "W"),
      });
      expect(main(b)).toContain("C(params.reads)");
    }
  });

  it("F-111: Connect moves a later source statement before the target, and refuses a cycle or a reassignment", async () => {
    const moved = await open(["x = C(1)", "y = B(x)", "z = C(2)"]);
    const m = accepted(moved, connect(moved, ["z", "out"], ["x", "x"]));
    expect(main(m)).toContain("z = C(2)\n    x = C(z)\n    y = B(x)");
    commit(moved, m);
    expect(moved.model.file("main.nf")?.source.problems).toEqual([]);
    // y reads x, which is assigned between the target and y: moving y above x would break it
    const cycle = await open(["x = C(1)", "y = B(x)"]);
    const c = refused(cycle, connect(cycle, ["y", "out"], ["x", "x"]));
    expect(c.code).toBe("invalid");
    expect(c.message).toMatch(/cycle|depends/);
    const reassigned = await open([
      "x = channel.of(1)",
      "x = channel.of(2)",
      "C()",
    ]);
    const r = refused(
      reassigned,
      connect(reassigned, ["x", "out"], ["C@1", "x"]),
    );
    expect(r.code).toBe("invalid");
    expect(texts(reassigned)["main.nf"]).toContain("x = channel.of(1)");
  });

  it("F-111: Connect refuses a nested source and self-connection", async () => {
    const state = await open(["B(channel.of(1), 2)", "C()"]);
    const nested = refused(
      state,
      connect(state, ["channel.of@1", "out"], ["C@1", "x"]),
    );
    expect(nested.code).toBe("invalid");
    const self = refused(state, connect(state, ["B@1", "out"], ["B@1", "x"]));
    expect(self.code).toBe("invalid");
    const role = refused(
      state,
      connect(state, ["B@1", "out"], ["channel.of@1", "out"]),
    );
    expect(role.code).toBe("not-found"); // a factory has no input ports
    const missing = refused(state, {
      kind: "connect",
      target,
      from: { node: "nope", port: "out" },
      to: port(state, "C@1", "x"),
    });
    expect(missing.code).toBe("not-found");
  });

  it("F-111 F-302: Disconnect removes the last argument and replaces an earlier one with null; the code parses", async () => {
    const state = await open([
      "reads = channel.of('a')",
      "B(reads, reads)",
      "C(reads)",
    ]);
    const disconnect = (local: string, portId: string) => ({
      kind: "disconnect" as const,
      target,
      port: port(state, local, portId),
    });
    const last = accepted(state, disconnect("B@1", "y"));
    expect(main(last)).toContain("B(reads)");
    const early = accepted(state, disconnect("B@1", "x"));
    expect(main(early)).toContain("B(null, reads)");
    const only = accepted(state, disconnect("C@1", "x"));
    expect(main(only)).toContain("C()");
    commit(state, early);
    expect(state.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-111: Disconnect refuses a chain's receiver, emit and publish values, and a port with no argument", async () => {
    const state = await stateFor({
      ...procs,
      "main.nf": `${head}workflow W {\n    take:\n    t\n\n    main:\n    t.map { it }\n    B()\n\n    emit:\n    out = t\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const disconnect = (local: string, portId: string) =>
      refused(state, {
        kind: "disconnect",
        target: w,
        port: port(state, local, portId, "main.nf", "W"),
      });
    expect(disconnect(".map@1", "in").code).toBe("invalid");
    expect(disconnect(":emit:out", "in").code).toBe("invalid");
    expect(disconnect("B@1", "x").code).toBe("invalid");
    expect(disconnect("B@1", "nope").code).toBe("not-found");
  });
});
