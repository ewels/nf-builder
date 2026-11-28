import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLints } from "../../src/diagnostics/lints";
import {
  type ConnectionTarget,
  connectionTargets,
} from "../../src/edit/connection-targets";
import { readTree } from "../model/read-tree";
import { port, projection, stateFor, version } from "./helpers";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;
const target = { path: "main.nf", workflow: null };
const lints = await loadLints(version);
const tree = (name: string) =>
  stateFor(
    Object.fromEntries(
      readTree(join(cases, name)).map((f) => [f.path, f.text]),
    ),
  );
const find = (list: readonly ConnectionTarget[], local: string, p: string) => {
  const found = list.find((t) => t.node.endsWith(`/${local}`) && t.port === p);
  if (!found) throw new Error(`no target ${local}:${p}`);
  return found;
};

describe("F-302 connectionTargets", () => {
  it("F-302 step 1 LA-29: Channel<Sample> into a Sample input is ok", async () => {
    const state = await tree("f302-connect-start");
    const list = connectionTargets(
      state,
      lints,
      target,
      port(state, ":params", "input"),
    );
    expect(find(list, "DESCRIBE@1", "sample")).toMatchObject({
      status: "ok",
      message: null,
    });
  });

  it("F-302 step 2 LA-29 LA-32: a Path output into a Sample input is a mismatch, not refused, with the type message", async () => {
    const state = await tree("f302-connect-start");
    const list = connectionTargets(
      state,
      lints,
      target,
      port(state, "TOUCH@1", "out"),
    );
    const sample = find(list, "DESCRIBE@1", "sample");
    expect(sample.status).toBe("mismatch");
    expect(sample.message).toMatch(/Path/);
    expect(sample.message).toMatch(/Sample/);
  });

  it("F-302 UX-25: the source's own inputs and a cycle are refused with Connect's messages", async () => {
    const state = await tree("f302-connect-start");
    const list = connectionTargets(
      state,
      lints,
      target,
      port(state, "DESCRIBE@1", "out"),
    );
    expect(find(list, "DESCRIBE@1", "sample")).toMatchObject({
      status: "refused",
      message: "DESCRIBE can't be connected to itself.",
    });

    const cyc = await stateFor({
      "a.nf":
        "nextflow.enable.types = true\n\nprocess A {\n    input:\n    x: String\n\n    output:\n    file('a')\n\n    script:\n    'a'\n}\n",
      "main.nf":
        "nextflow.enable.types = true\n\ninclude { A } from './a.nf'\n\nworkflow {\n    first = A(channel.of('x'))\n    A(first)\n}\n",
    });
    const targets = connectionTargets(cyc, lints, target, {
      node: projection(cyc).nodes.find((n) => n.id.endsWith("/first"))
        ?.id as string,
      port: "out",
    });
    const second = find(targets, "A@1", "x");
    // A@1 already reads first: rewriting its argument with first's own output is allowed; first's input would be a cycle
    expect(second.status).not.toBe("refused");
    const back = connectionTargets(cyc, lints, target, {
      node: projection(cyc).nodes.find((n) => n.id.endsWith("/A@1"))
        ?.id as string,
      port: "out",
    });
    expect(find(back, "first", "x")).toMatchObject({ status: "refused" });
  });

  it("F-302 LA-29: an unknown source type, a legacy callee and an untyped script are never mismatches", async () => {
    const legacy = await tree("f111-start-legacy");
    for (const node of projection(legacy).nodes)
      for (const out of node.outputs)
        for (const t of connectionTargets(legacy, lints, target, {
          node: node.id,
          port: out.id,
        }))
          expect(t.status, `${node.id} -> ${t.node}:${t.port}`).not.toBe(
            "mismatch",
          );
    const typed = await tree("f111-start-typed");
    for (const node of projection(typed).nodes)
      for (const out of node.outputs)
        if (out.type === null || out.type.element === null)
          for (const t of connectionTargets(typed, lints, target, {
            node: node.id,
            port: out.id,
          }))
            expect(t.status).not.toBe("mismatch");
  });

  it("F-302 LA-14: a Channel<Tuple<A>> output into a two-component legacy tuple input is a mismatch", async () => {
    const legacy = readTree(
      join(cases, "s1-typed-legacy-tuple-arity/modules/local/legacy_count"),
    )[0]?.text as string;
    const make = (types: string) =>
      stateFor({
        "legacy.nf": legacy,
        "main.nf": `nextflow.enable.types = true\n\ninclude { LEGACY_COUNT } from './legacy.nf'\n\nworkflow W {\n    take:\n    t: ${types}\n\n    main:\n    LEGACY_COUNT()\n}\n`,
      });
    const w = { path: "main.nf", workflow: "W" };
    const one = await make("Channel<Tuple<String>>");
    const wrong = connectionTargets(
      one,
      lints,
      w,
      port(one, ":take:t", "out", "main.nf", "W"),
    );
    const found = find(wrong, "LEGACY_COUNT@1", "$1");
    expect(found.status).toBe("mismatch");
    expect(found.message).toMatch(/1 component/);
    expect(found.message).toMatch(/declares 2/);
    const two = await make("Channel<Tuple<String, Path>>");
    const right = connectionTargets(
      two,
      lints,
      w,
      port(two, ":take:t", "out", "main.nf", "W"),
    );
    expect(find(right, "LEGACY_COUNT@1", "$1").status).toBe("ok");
  });

  it("F-302 UX-25: a code node's input is refused with Connect's message", async () => {
    const state = await stateFor({
      "main.nf":
        "workflow {\n    ch = channel.of(1)\n    ch.view()\n    println(ch.toString())\n}\n",
    });
    const code = projection(state).nodes.find((n) => n.kind === "code");
    expect(code, "a code node").toBeDefined();
    const src = projection(state).nodes.find(
      (n) => n.id !== code?.id && n.outputs.length > 0,
    );
    const list = connectionTargets(state, lints, target, {
      node: src?.id as string,
      port: src?.outputs[0]?.id as string,
    });
    const hit = list.filter((t) => t.node === code?.id);
    expect(hit.length).toBeGreaterThan(0);
    for (const t of hit)
      expect(t).toMatchObject({
        status: "refused",
        message: `${code?.label} can't take another argument.`,
      });
  });

  it("F-302 LA-32 UX-25: a call lint skips for its argument count is ok when connecting leaves the count wrong, a mismatch when it makes it right", async () => {
    const make = (n: 1 | 3) =>
      stateFor({
        "main.nf": `nextflow.enable.types = true\n\nprocess T {\n    output:\n    file('t')\n\n    script:\n    't'\n}\n\nprocess P {\n    input:\n    a: String\n    b: String\n    c: String\n\n    output:\n    file('p')\n\n    script:\n    'p'\n}\n\nworkflow {\n    T()\n    ${n === 1 ? "P('x')" : "P('x', 'y', 'z')"}\n}\n`,
      });
    const statuses = async (n: 1 | 3) => {
      const state = await make(n);
      const list = connectionTargets(
        state,
        lints,
        target,
        port(state, "T@1", "out"),
      );
      return Object.fromEntries(
        ["a", "b", "c"].map((p) => [p, find(list, "P@1", p).status]),
      );
    };
    // P('x') has 1 of 3 arguments: replacing a keeps it wrong (lint skips the check); filling c pads to 3, so c is checked
    expect(await statuses(1)).toEqual({ a: "ok", b: "ok", c: "mismatch" });
    // P('x', 'y', 'z') has the right count, so replacing any argument is checked
    expect(await statuses(3)).toEqual({
      a: "mismatch",
      b: "mismatch",
      c: "mismatch",
    });
  });
});
