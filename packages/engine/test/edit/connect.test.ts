import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EditState } from "../../src/edit/apply";
import {
  connect as connectPatches,
  planConnect,
} from "../../src/edit/commands/connect";
import { EditRefusal } from "../../src/edit/refusal";
import { readTree } from "../model/read-tree";
import {
  accepted,
  commit,
  main,
  node,
  port,
  projection,
  refused,
  stateFor,
  texts,
} from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
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
  state: EditState,
  from: [string, string],
  to: [string, string],
) => ({
  kind: "connect" as const,
  target,
  from: port(state, ...from),
  to: port(state, ...to),
});

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

  it("F-111 UX-25: Connect from a take node reads the take, and from a params node reads params.<name>", async () => {
    const state = await stateFor({
      ...procs,
      "main.nf": `nextflow.enable.types = true\n\ninclude { C } from './c.nf'\n\nworkflow W {\n    take:\n    t: String\n\n    main:\n    C()\n    C()\n}\n`,
    });
    const w = { path: "main.nf", workflow: "W" };
    const a = accepted(state, {
      kind: "connect",
      target: w,
      from: port(state, ":take:t", "out", "main.nf", "W"),
      to: port(state, "C@1", "x", "main.nf", "W"),
    });
    expect(main(a)).toContain("C(t)");
    // the entry workflow's projection has a params node once it reads params
    const entry = await stateFor({
      ...procs,
      "main.nf": `nextflow.enable.types = true\n\ninclude { C } from './c.nf'\n\nparams {\n    reads: String\n}\n\nworkflow {\n    C()\n    d = params.reads\n    println(d)\n}\n`,
    });
    const params = projection(entry).nodes.find((n) => n.kind === "params");
    expect(params).toBeDefined();
    const b = accepted(entry, {
      kind: "connect",
      target,
      from: { node: params?.id as string, port: "reads" },
      to: port(entry, "C@1", "x"),
    });
    expect(main(b)).toContain("C(params.reads)");
    commit(entry, b);
    expect(entry.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-111 UX-25: Connect into a bare emit writes `name = value`, into a named emit replaces the value, and into a publish target sets its value", async () => {
    const w = { path: "main.nf", workflow: "W" };
    const inEmit = (
      state: EditState,
      local: string,
      from: [string, string],
    ) => ({
      kind: "connect" as const,
      target: w,
      from: port(state, ...from, "main.nf", "W"),
      to: port(state, local, "in", "main.nf", "W"),
    });
    for (const [label, flagLine] of [
      ["typed", flag],
      ["legacy", ""],
    ] as const) {
      const bare = await stateFor({
        "main.nf": `${flagLine}workflow W {\n    take:\n    t\n\n    main:\n    x = t.map { v -> v }\n\n    emit:\n    x\n}\n`,
      });
      const a = accepted(bare, inEmit(bare, ":emit:x", [":take:t", "out"]));
      expect(main(a), label).toContain("emit:\n    x = t\n");
      commit(bare, a);
      expect(bare.model.file("main.nf")?.source.problems, label).toEqual([]);
      const named = await stateFor({
        "main.nf": `${flagLine}workflow W {\n    take:\n    t\n\n    main:\n    x = t.map { v -> v }\n\n    emit:\n    out = x\n}\n`,
      });
      const b = accepted(named, inEmit(named, ":emit:out", [":take:t", "out"]));
      expect(main(b), label).toContain("emit:\n    out = t\n");
    }
    // a lone expression keeps its port name (`out`)
    const lone = await stateFor({
      "main.nf":
        "workflow W {\n    take:\n    t\n\n    main:\n    x = t.map { v -> v }\n\n    emit:\n    x.map { v -> v }\n}\n",
    });
    const l = accepted(lone, inEmit(lone, ":emit:out", [":take:t", "out"]));
    expect(main(l)).toContain("emit:\n    out = t\n");
    // a publish target
    const pub = await stateFor({
      ...procs,
      "main.nf": `${head}workflow {\n    main:\n    a = channel.of('a')\n    b = channel.of('b')\n    publish:\n    res = a\n}\n\noutput {\n    res {\n        path 'x'\n    }\n}\n`,
    });
    const p = accepted(pub, {
      kind: "connect",
      target,
      from: port(pub, "b", "out"),
      to: { node: node(pub, ":output").id, port: "res" },
    });
    expect(main(p)).toContain("publish:\n    res = b\n");
    commit(pub, p);
    expect(pub.model.file("main.nf")?.source.problems).toEqual([]);
  });

  it("F-111 UX-25: a new variable never shadows a built-in name", async () => {
    const state = await stateFor({
      "p.nf": `${flag}process PARAMS {\n    output:\n    file('x')\n\n    script:\n    'x'\n}\n`,
      "c.nf": C,
      "main.nf": `${flag}include { PARAMS } from './p.nf'\ninclude { C } from './c.nf'\n\nworkflow {\n    PARAMS()\n    C()\n}\n`,
    });
    const r = accepted(
      state,
      connect(state, ["PARAMS@1", "out"], ["C@1", "x"]),
    );
    expect(main(r)).not.toMatch(/\bparams = /);
    expect(main(r)).toContain("params_2 = PARAMS()\n    C(params_2)");
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

describe("F-302 planConnect", () => {
  it("F-302 UX-25 AR-21: planConnect refuses exactly what connect refuses, with the same message", async () => {
    for (const start of ["f111-start-typed", "f111-start-legacy"]) {
      const state = await stateFor(
        Object.fromEntries(
          readTree(join(cases, start)).map((f) => [f.path, f.text]),
        ),
      );
      const { nodes } = projection(state);
      let pairs = 0;
      let refusals = 0;
      for (const from of nodes)
        for (const out of from.outputs)
          for (const to of nodes)
            for (const input of to.inputs) {
              const command = {
                kind: "connect" as const,
                target,
                from: { node: from.id, port: out.id },
                to: { node: to.id, port: input.id },
              };
              const planned = attempt(() => planConnect(state, command));
              const applied = attempt(() => connectPatches(state, command));
              pairs++;
              if (planned !== null) {
                refusals++;
                expect(applied, `${from.id} -> ${to.id}:${input.id}`).toBe(
                  planned,
                );
              } else if (applied !== null) {
                // only the reprint finds it: nothing in these trees
                expect.fail(`${from.id} -> ${to.id}:${input.id}: ${applied}`);
              }
            }
      expect(pairs, start).toBeGreaterThan(5);
      expect(refusals, start).toBeGreaterThan(0);
    }
  });
});

/** The message of the refusal `run` throws, or null. */
function attempt(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof EditRefusal) return `${e.code}: ${e.message}`;
    throw e;
  }
}
