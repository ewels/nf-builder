import { describe, expect, it } from "vitest";
import {
  accepted,
  commit,
  main,
  port,
  projection,
  refused,
  stateFor,
} from "./helpers";

const proc = (name: string, inputs: string[], outputs: string[]) =>
  `process ${name} {\n    input:\n${inputs.map((i) => `    ${i}\n`).join("")}\n    output:\n${outputs.map((o) => `    ${o}\n`).join("")}\n    script:\n    '${name}'\n}\n`;
// G: a tuple input, a path input; one named and one unnamed output
const G = proc(
  "G",
  ["tuple val(meta), path(reads)", "path x"],
  ["tuple val(meta), path('o.txt'), emit: named", "path 'u.txt'"],
);
const U = proc("U", ["path x"], ["path 'u.txt'"]);
const V = proc("V", ["path x"], ["path 'v.txt'"]);
const head =
  "include { G } from './g.nf'\ninclude { U } from './u.nf'\ninclude { V } from './v.nf'\n\n";
const target = { path: "main.nf", workflow: null };
const open = (body: string[]) =>
  stateFor({
    "g.nf": G,
    "u.nf": U,
    "v.nf": V,
    "main.nf": `${head}workflow {\n${body.map((l) => `    ${l}`).join("\n")}\n}\n`,
  });
const link = (
  state: Awaited<ReturnType<typeof open>>,
  from: [string, string],
  to: [string, string],
) => ({
  kind: "connect" as const,
  target,
  from: port(state, ...from),
  to: port(state, ...to),
});
/** Edges from a node (by local id) to another, as `from.port -> to.port`. */
const edgesBetween = (
  state: Awaited<ReturnType<typeof open>>,
  from: string,
  to: string,
) =>
  projection(state)
    .edges.filter(
      (e) => e.from.node.endsWith(`/${from}`) && e.to.node.endsWith(`/${to}`),
    )
    .map((e) => `${e.from.port} -> ${e.to.port}`);
const legacyAfter = (state: Awaited<ReturnType<typeof open>>) => {
  const file = state.model.file("main.nf");
  expect(file?.source.problems).toEqual([]);
  expect(file?.source.text).not.toContain("enable.types");
};

describe("F-111 Connect between legacy processes", () => {
  it("F-111 LA-21 AR-22: Connect into the first legacy input replaces the argument and keeps the script legacy", async () => {
    const state = await open(["a = channel.of(1)", "G(channel.of(2), a)"]);
    const r = accepted(state, link(state, ["a", "out"], ["G@1", "$1"]));
    expect(main(r)).toContain("G(a, a)");
    commit(state, r);
    legacyAfter(state);
  });

  it("F-111 LA-21 UX-25: Connect into a later legacy input pads the earlier positions with null", async () => {
    const state = await open(["a = channel.of(1)", "G()"]);
    const r = accepted(state, link(state, ["a", "out"], ["G@1", "x"]));
    expect(main(r)).toContain("G(null, a)");
    commit(state, r);
    legacyAfter(state);
    expect(projection(state).edges).toHaveLength(1);
  });

  it("F-111 LA-21 AR-22: Connect from a legacy emit name reads the named output of the assigned call", async () => {
    const state = await open(["G(channel.of(1), channel.of(2))", "U()"]);
    const r = accepted(state, link(state, ["G@1", "named"], ["U@1", "x"]));
    expect(main(r)).toContain(
      "g = G(channel.of(1), channel.of(2))\n    U(g.named)",
    );
    commit(state, r);
    legacyAfter(state);
    expect(edgesBetween(state, "g", "U@1")).toEqual(["named -> x"]);
  });

  it("F-111 LA-21 AR-22: Connect from an unnamed output of a multi-output process reads it as CALLEE.out[n]", async () => {
    const state = await open(["G(channel.of(1), channel.of(2))", "U()"]);
    const r = accepted(state, link(state, ["G@1", "[1]"], ["U@1", "x"]));
    expect(main(r)).toContain("U(G.out[1])");
    commit(state, r);
    legacyAfter(state);
    expect(edgesBetween(state, "G@1", "U@1")).toEqual(["[1] -> x"]);
  });

  it("F-111 LA-21 AR-22: Connect from a lone unnamed output reads the assigned call itself", async () => {
    const state = await open(["U(channel.of(1))", "V()"]);
    const r = accepted(state, link(state, ["U@1", "out"], ["V@1", "x"]));
    expect(main(r)).toContain("u = U(channel.of(1))\n    V(u)");
    commit(state, r);
    legacyAfter(state);
    expect(edgesBetween(state, "u", "V@1")).toEqual(["out -> x"]);
  });

  it("F-111 LA-21 AR-22: Connect moves a legacy call above a consumer that comes first", async () => {
    const state = await open(["V()", "U(channel.of(1))"]);
    const r = accepted(state, link(state, ["U@1", "out"], ["V@1", "x"]));
    expect(main(r)).toMatch(/u = U\(channel\.of\(1\)\)\n {4}V\(u\)/);
    commit(state, r);
    legacyAfter(state);
  });

  it("F-111 LA-21 AR-22: Disconnect removes a legacy argument, and nulls an earlier one that has later arguments", async () => {
    const state = await open(["G(channel.of(1), channel.of(2))"]);
    const first = accepted(state, {
      kind: "disconnect",
      target,
      port: port(state, "G@1", "$1"),
    });
    expect(main(first)).toContain("G(null, channel.of(2))");
    const last = accepted(state, {
      kind: "disconnect",
      target,
      port: port(state, "G@1", "x"),
    });
    expect(main(last)).toContain("G(channel.of(1))");
    commit(state, last);
    legacyAfter(state);
    expect(edgesBetween(state, "channel.of@1", "G@1")).toEqual(["out -> $1"]);
  });

  it("F-111 LA-21 AR-22: Connect refuses a pipe-fed legacy port, and Disconnect says it has nothing to remove", async () => {
    const state = await open(["a = channel.of(1)", "channel.of(2) | U"]);
    const input = projection(state)
      .nodes.find((n) => n.label === "U")
      ?.inputs.find((p) => p.id === "x");
    expect(input?.argument).toBeNull();
    const r = refused(state, link(state, ["a", "out"], ["U@1", "x"]));
    expect(r.code).toBe("invalid");
    expect(r.message.length).toBeGreaterThan(0);
    const d = refused(state, {
      kind: "disconnect",
      target,
      port: port(state, "U@1", "x"),
    });
    expect(d.code).toBe("invalid");
  });
});
