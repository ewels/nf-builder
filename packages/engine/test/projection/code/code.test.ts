import type { CodeNode, GraphNode, Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { formatFlowType } from "../../../src/projection/types";
import { projectorForFiles } from "../open";

const LEGACY_PREAMBLE = `process FOO {
    input:
    val x

    script:
    """
    echo \${x}
    """
}
`;

async function project(
  body: string,
  options: { typed?: boolean; takes?: string; header?: string } = {},
): Promise<Projection> {
  const flag = options.typed ? "nextflow.enable.types = true\n\n" : "";
  const text = `${flag}${options.header ?? LEGACY_PREAMBLE}
workflow W {
    take:
    ${options.takes ?? "ch"}

    main:
${body
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
}
`;
  const projector = await projectorForFiles({ "main.nf": text });
  const projection = projector.project("main.nf", "W");
  if (projection === null) throw new Error("no projection");
  return projection;
}
const node = (p: Projection, id: string): GraphNode => {
  const found = p.nodes.find((n) => n.id === id);
  if (found === undefined)
    throw new Error(`no ${id}; have ${p.nodes.map((n) => n.id).join(", ")}`);
  return found;
};
const code = (p: Projection, id: string): CodeNode => {
  const n = node(p, id);
  if (n.kind !== "code") throw new Error(`${id} is ${n.kind}`);
  return n;
};
const into = (p: Projection, id: string) =>
  p.edges
    .filter((e) => e.to.node === id)
    .map((e) => `${e.from.node}[${e.from.port}] -> ${e.to.port}`);
const ids = (ports: readonly { id: string }[]) => ports.map((x) => x.id);

describe("F-108 code nodes", () => {
  it("F-108 step 1 AR-13 LA-27: an if/else assigning in its branches is one code node with those outputs, and later uses wire to it", async () => {
    const p = await project(
      [
        "if (params.reads) {",
        "    mode = 'paired'",
        "} else {",
        "    mode = 'single'",
        "}",
        "res = FOO(mode)",
      ].join("\n"),
    );
    const n = code(p, "main.nf#W/mode");
    expect(ids(n.outputs)).toEqual(["mode"]);
    expect(ids(n.inputs)).toEqual(["params.reads"]);
    expect(into(p, n.id)).toEqual(["main.nf#W/:params[reads] -> params.reads"]);
    expect(into(p, "main.nf#W/res")).toEqual(["main.nf#W/mode[mode] -> $1"]);
    expect(p.nodes.filter((x) => x.kind === "code")).toHaveLength(1);
  });

  it("F-108 step 1 LA-27: inputs are the graph values read: a take, the latest earlier assignment, res.name of a multi-output call, a :params port", async () => {
    const p = await project(
      [
        "a = 1",
        "a = a + 1",
        "b = ch",
        'log.info("${a} ${b} ${params.reads}")',
        "c = a",
      ].join("\n"),
    );
    // the second assignment reads the first one; the later reads see the second
    expect(into(p, "main.nf#W/a~2")).toEqual(["main.nf#W/a[a] -> a"]);
    const log = p.nodes.find((n) => n.id.includes(":code@"));
    expect(log).toBeDefined();
    expect(ids(log?.inputs ?? [])).toEqual(["a", "b", "params.reads"]);
    expect(into(p, log?.id ?? "")).toEqual([
      "main.nf#W/a~2[a] -> a",
      "main.nf#W/b[b] -> b",
      "main.nf#W/:params[reads] -> params.reads",
    ]);
  });

  it("F-108 LA-27: reads inside a code node's closures are inputs; a chain's closure reads still are not", async () => {
    const p = await project(
      [
        "label = 'x'",
        "fn = { v -> v + label }",
        "mapped = ch.map { v -> v + label }",
      ].join("\n"),
    );
    expect(ids(code(p, "main.nf#W/fn").inputs)).toEqual(["label"]);
    expect(into(p, "main.nf#W/fn")).toEqual([
      "main.nf#W/label[label] -> label",
    ]);
    expect(into(p, "main.nf#W/mapped")).toEqual([
      "main.nf#W/:take:ch[out] -> in",
    ]);
    expect(
      p.edges.some(
        (e) =>
          e.to.node === "main.nf#W/mapped" && e.from.node.endsWith("/label"),
      ),
    ).toBe(false);
  });

  it("F-108 LA-27: functions, built-ins, undeclared names and params as a whole are not ports; a value assigned earlier in the same statement is not an input", async () => {
    const p = await project(
      [
        "r = compute(undeclared, params)",
        "if (ch) {",
        "    t = 1",
        "} else {",
        "    u = t",
        "}",
      ].join("\n"),
    );
    expect(code(p, "main.nf#W/r").inputs).toEqual([]);
    const second = code(p, "main.nf#W/t");
    expect(ids(second.inputs)).toEqual(["ch"]);
    expect(ids(second.outputs)).toEqual(["t", "u"]);
  });

  it("F-108 AR-11: a code node is keyed by its first output, or :code@n without outputs; def (a, b) gives outputs a and b", async () => {
    const p = await project(
      ["def (a, b) = ['x', 'y']", "log.info('one')", "log.info('two')"].join(
        "\n",
      ),
    );
    expect(p.nodes.map((n) => n.id)).toEqual([
      "main.nf#W/:take:ch",
      "main.nf#W/a",
      "main.nf#W/:code@1",
      "main.nf#W/:code@2",
    ]);
    expect(ids(code(p, "main.nf#W/a").outputs)).toEqual(["a", "b"]);
  });

  it("F-108 LA-28: single-assignment outputs keep F-106's inline type; edges into code nodes are indirect and carry the source type", async () => {
    const p = await project(
      ["f = file('x.txt')", "g = f", "h = [f, ch]"].join("\n"),
    );
    const type = (id: string, port: string) =>
      formatFlowType(
        code(p, id).outputs.find((o) => o.id === port)?.type ?? {
          dataflow: null,
          element: null,
        },
      );
    expect(type("main.nf#W/f", "f")).toBe("Path");
    expect(type("main.nf#W/g", "g")).toBe("Path");
    expect(p.edges.filter((e) => e.to.node === "main.nf#W/h")).toEqual([
      expect.objectContaining({ direct: false }),
      expect.objectContaining({ direct: false }),
    ]);
    const multi = await project("def (a, b) = ['x', 'y']");
    expect(code(multi, "main.nf#W/a").outputs.map((o) => o.type)).toEqual([
      null,
      null,
    ]);
  });

  it("F-108 UX-22 UX-28: label is the first line, text the whole statement", async () => {
    const p = await project("if (params.reads) {\n    mode = 'paired'\n}");
    const n = code(p, "main.nf#W/mode");
    expect(n.label).toBe("if (params.reads) {");
    // the harness indents the workflow body, so continuation lines keep that indent
    expect(n.text).toBe("if (params.reads) {\n        mode = 'paired'\n    }");
  });

  it("F-108 LA-10: a typed workflow gets the same code nodes", async () => {
    const p = await project(
      ["def prefix = 'typed'", "suffix = prefix + '-tail'"].join("\n"),
      { typed: true, header: "", takes: "ch: Channel<String>" },
    );
    expect(ids(code(p, "main.nf#W/suffix").inputs)).toEqual(["prefix"]);
    expect(into(p, "main.nf#W/suffix")).toEqual([
      "main.nf#W/prefix[prefix] -> prefix",
    ]);
  });
});
