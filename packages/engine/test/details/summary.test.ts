import type { GraphNode } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { workflowSummary } from "../../src/details/summary";
import { base, call, flow, port, projection } from "./helpers";

describe("F-206 workflow summary", () => {
  it("F-206 UX-31: takes and emits with types, calls in projection order, and each registry module once with its calls", () => {
    const take: GraphNode = {
      ...base("t", "reads", [], [port("out", flow("channel", "Path"))]),
      kind: "take",
      name: "reads",
    };
    const emit: GraphNode = {
      ...base("e", "bam", [port("in", flow("channel", "Bam"))], []),
      kind: "emit",
      name: "bam",
    };
    const p = projection(
      [
        take,
        call("a", { name: "FASTQC", module: "nf-core/fastqc" }),
        call("b", { name: "LOCAL", typed: true }),
        call("c", { name: "FASTQC_2", module: "nf-core/fastqc" }),
        call("d", { name: "ALIGN", module: "nf-core/bwa" }),
        call("u", { name: "GONE", status: "unresolved", kind: null }),
        emit,
      ],
      [],
      "WF",
    );
    const s = workflowSummary(p);
    expect([s.name, s.path, s.typed, s.entry]).toEqual([
      "WF",
      "main.nf",
      true,
      false,
    ]);
    expect(s.takes).toEqual([
      { node: "t", name: "reads", type: "Channel<Path>" },
    ]);
    expect(s.emits).toEqual([{ node: "e", name: "bam", type: "Channel<Bam>" }]);
    expect(s.params).toEqual([]);
    expect(s.outputs).toEqual([]);
    expect(s.calls.map((c) => c.node)).toEqual(["a", "b", "c", "d", "u"]);
    expect(s.calls[1]).toMatchObject({
      name: "LOCAL",
      callee: "LOCAL",
      kindLabel: "Typed process",
      module: null,
      status: "modelled",
    });
    expect(s.calls[4]?.status).toBe("unresolved");
    expect(s.modules).toEqual([
      { module: "nf-core/fastqc", calls: ["FASTQC", "FASTQC_2"] },
      { module: "nf-core/bwa", calls: ["ALIGN"] },
    ]);
    expect(structuredClone(s)).toEqual(s);
  });

  it("F-206 UX-31: the entry workflow summary lists parameters and published outputs", () => {
    const params: GraphNode = {
      ...base(
        "p",
        "params",
        [],
        [port("input", flow("plain", "Path")), port("depth", null)],
      ),
      kind: "params",
    };
    const output: GraphNode = {
      ...base("o", "output", [port("bam", flow("channel", "Bam"))], []),
      kind: "output",
    };
    const s = workflowSummary(projection([params, call("a"), output]));
    expect(s.name).toBe("Entry workflow");
    expect(s.entry).toBe(true);
    expect(s.takes).toEqual([]);
    expect(s.emits).toEqual([]);
    expect(s.params).toEqual([
      { node: "p", name: "input", type: "Path" },
      { node: "p", name: "depth", type: null },
    ]);
    expect(s.outputs).toEqual([
      { node: "o", name: "bam", type: "Channel<Bam>" },
    ]);
  });
});
