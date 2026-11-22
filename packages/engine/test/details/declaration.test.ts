import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  declarationDetails,
  docSummary,
  oneLine,
  previewText,
  resolveCallee,
} from "../../src/details/declaration";
import { detailsOf, nodeNamed } from "./open";

const TYPED = "nextflow.enable.types = true\n";

const detail = async (
  files: Record<string, string>,
  label: string,
  path = "main.nf",
  workflow: string | null = null,
) => {
  const input = await detailsOf(files, path, workflow);
  const node = nodeNamed(input, label);
  const callee =
    node.kind === "call"
      ? resolveCallee(input.model, path, node.callee.name)
      : null;
  return declarationDetails(input, node, callee);
};

const entry = (call: string) =>
  `include { P } from './p.nf'\nworkflow {\n    main:\n    ${call}\n}\n`;

describe("F-206 declaration details", () => {
  it("F-206 UX-30 LA-50: a description is the doc comment text before the first tag, as plain text", async () => {
    const comment = (body: string) =>
      docSummary([
        {
          kind: "doc",
          text: body,
          range: undefined as never,
          ownLine: true,
        },
      ]);
    expect(
      comment(
        "/**\n * Trims `reads` and\n * writes [a file](http://x).\n *\n * Second paragraph.\n *\n * @param reads the reads\n * @return the file\n */",
      ),
    ).toBe("Trims reads and writes a file.\n\nSecond paragraph.");
    expect(comment("/**\n * Aligns.\n *\n * Inputs:\n * - reads\n */")).toBe(
      "Aligns.",
    );
    expect(comment("/** One line. */")).toBe("One line.");
    expect(comment("/**\n * @param x\n */")).toBeNull();
    expect(docSummary(undefined)).toBeNull();
    expect(docSummary([])).toBeNull();
    expect(
      docSummary([
        {
          kind: "line",
          text: "// no",
          range: undefined as never,
          ownLine: true,
        },
      ]),
    ).toBeNull();
    const d = await detail(
      {
        "main.nf": entry("P(channel.of(1))"),
        "p.nf":
          "/**\n * Does P.\n * @param x\n */\nprocess P {\n    input:\n    val x\n    script:\n    'true'\n}\n",
        "other.nf": "",
      },
      "P",
    );
    expect(d.description).toBe("Does P.");
    const bare = await detail(
      {
        "main.nf": entry("P(channel.of(1))"),
        "p.nf":
          "process P {\n    input:\n    val x\n    script:\n    'true'\n}\n",
      },
      "P",
    );
    expect(bare.description).toBeNull();
  });

  it("F-206 UX-30: directives are listed in source order with one-line values cut at 60 characters", async () => {
    const long = "quay.io/biocontainers/".padEnd(80, "x");
    const d = await detail(
      {
        "main.nf": entry("P(channel.of(1))"),
        "p.nf": `process P {\n    tag "\${x}"\n    cpus 2\n    container '${long}'\n    input:\n    val x\n    script:\n    'true'\n}\n`,
      },
      "P",
    );
    expect(d.directives.map((r) => r.name)).toEqual([
      "tag",
      "cpus",
      "container",
    ]);
    expect(d.directives[0]?.value).toBe('"${x}"');
    expect(d.directives[1]?.value).toBe("2");
    expect(d.directives[2]?.value.length).toBe(60);
    expect(d.directives[2]?.value.endsWith("…")).toBe(true);
    expect(oneLine("a\n   b  c", 60)).toBe("a b c");
    expect(oneLine("abcdef", 4)).toBe("abc…");
    expect(oneLine("abcd", 4)).toBe("abcd");
  });

  it("F-206 UX-30 LA-20: topics list a typed process's topic emissions and a legacy output's topic option", async () => {
    const typed = await detail(
      {
        "main.nf": TYPED + entry("P(channel.of(1))"),
        "p.nf": `${TYPED}process P {\n    input:\n    x: Integer\n    output:\n    y: Integer = x\n    topic:\n    tuple('p', '1.0') >> 'versions'\n    script:\n    'true'\n}\n`,
      },
      "P",
    );
    expect(typed.topics).toEqual([
      { name: "versions", value: "tuple('p', '1.0')" },
    ]);
    const legacy = await detail(
      {
        "main.nf": entry("P(channel.of(1))"),
        "p.nf": `process P {\n    input:\n    val x\n    output:\n    val x\n    tuple val('p'), val('1.0'), topic: versions\n    script:\n    'true'\n}\n`,
      },
      "P",
    );
    expect(legacy.topics.map((t) => t.name)).toEqual(["versions"]);
    expect(legacy.topics[0]?.value).toContain("tuple");
  });

  it("F-206 UX-30: the script preview is the script section's body, dedented, at most 8 lines, marked when cut", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `    echo ${i}`).join(
      "\n",
    );
    const mk = (section: string, body: string) => ({
      "main.nf": entry("P(channel.of(1))"),
      "p.nf": `process P {\n    input:\n    val x\n    ${section}:\n${body}\n}\n`,
    });
    const long = await detail(mk("script", `    """\n${lines}\n    """`), "P");
    expect(long.preview?.title).toBe("Script");
    expect(long.preview?.truncated).toBe(true);
    expect(long.preview?.text.split("\n")).toHaveLength(8);
    expect(long.preview?.text.startsWith("echo 0\necho 1")).toBe(true);
    const short = await detail(
      mk("script", `    """\n    echo hi\n    """`),
      "P",
    );
    expect(short.preview).toEqual({
      title: "Script",
      text: "echo hi",
      truncated: false,
    });
    const shell = await detail(
      mk("shell", `    '''\n    echo !{x}\n    '''`),
      "P",
    );
    expect(shell.preview).toMatchObject({ title: "Shell", text: "echo !{x}" });
    const exec = await detail(mk("exec", `    println x`), "P");
    expect(exec.preview).toMatchObject({ title: "Exec", text: "println x" });
    expect(
      previewText(
        "a\n  b\n  c\n",
        { start: 0, end: 10, line: 1, column: 1, endLine: 4, endColumn: 1 },
        2,
      ),
    ).toEqual({
      text: "a\n  b",
      truncated: true,
    });
  });

  it("F-206 UX-30: an agent shows its directives and prompt; a workflow or pipeline callee has no preview", async () => {
    const agent = await detail(
      {
        "main.nf": TYPED + entry("P(channel.of(1))"),
        "p.nf": `${TYPED}agent P {\n    model 'm'\n    input:\n    x: Integer\n    prompt:\n    """\n    Say \${x}\n    """\n}\n`,
      },
      "P",
    );
    expect(agent.directives.map((r) => r.name)).toEqual(["model"]);
    expect(agent.preview?.title).toBe("Prompt");
    const wf = await detail(
      {
        "main.nf": entry("P(channel.of(1))"),
        "p.nf":
          "/** A flow. */\nworkflow P {\n    take:\n    x\n    main:\n    y = x\n    emit:\n    y\n}\n",
      },
      "P",
    );
    expect(wf.preview).toBeNull();
    expect(wf.description).toBe("A flow.");
    expect(wf.directives).toEqual([]);
    const pipe = await detail(
      {
        "main.nf": `include { workflow as P } from './pipe.nf'\nworkflow {\n    main:\n    P(channel.of(1))\n}\n`,
        "pipe.nf":
          "/** A pipeline. */\nworkflow {\n    main:\n    x = channel.of(1)\n}\n",
      },
      "P",
    );
    expect(pipe.preview).toBeNull();
    expect(pipe.description).toBe("A pipeline.");
  });

  it("F-206 UX-30 ADR-0008: a chain lists its operators with catalogue descriptions, flags legacy operators, and previews its closures", async () => {
    const input = await detailsOf({
      "main.nf": `workflow {\n    main:\n    ch = channel.of(1)\n    out = ch.map { v -> v + 1 }.collect()\n}\n`,
    });
    const chain = input.projection.nodes.find((n) => n.kind === "chain");
    if (chain === undefined) throw new Error("no chain");
    const details = declarationDetails(input, chain, null);
    expect(details.operators.map((o) => o.name)).toEqual(["map", "collect"]);
    expect(details.operators[0]?.description).toMatch(/\S/);
    expect(details.operators.every((o) => !o.legacy)).toBe(true);
    expect(details.preview?.title).toBe("Source");
    expect(details.preview?.text).toContain("v -> v + 1");
    const unknown = await detailsOf({
      "main.nf": `workflow {\n    main:\n    ch = channel.of(1)\n    out = ch.countLines()\n}\n`,
    });
    const odd = unknown.projection.nodes.find((n) => n.kind === "chain");
    if (odd === undefined) throw new Error("no chain");
    const row = declarationDetails(unknown, odd, null).operators[0];
    expect(row).toMatchObject({ name: "countLines", legacy: true });
  });

  it("F-206 UX-30: a factory shows its catalogue description; a code node previews its statement text", async () => {
    const input = await detailsOf({
      "main.nf": `workflow {\n    main:\n    ch = channel.of(1)\n    log.info "hi"\n}\n`,
    });
    const factory = input.projection.nodes.find((n) => n.kind === "factory");
    const code = input.projection.nodes.find((n) => n.kind === "code");
    if (factory === undefined || code === undefined) throw new Error("nodes");
    const f = declarationDetails(input, factory, null);
    expect(f.description).toMatch(/\S/);
    expect(f.description).not.toContain("\n\n");
    expect(f.path).toBe("main.nf");
    expect(f.line).toBe(factory.range.line);
    expect(declarationDetails(input, code, null).preview).toEqual({
      title: "Source",
      text: 'log.info "hi"',
      truncated: false,
    });
  });

  it("F-206 UX-30: an unparsed callee previews its declaration text; an unresolved callee has no declaration", async () => {
    const input = await detailsOf({
      "main.nf": readFileSync(
        join(
          import.meta.dirname,
          "../../../../tools/corpus/fixtures/bad-declaration.nf",
        ),
        "utf8",
      ),
    });
    const node = nodeNamed(input, "SECOND");
    if (node.kind !== "call") throw new Error("not a call");
    expect(node.callee.status).toBe("unparsed");
    const callee = resolveCallee(input.model, "main.nf", "SECOND");
    const d = declarationDetails(input, node, callee);
    expect(d.preview?.title).toBe("Source");
    expect(d.preview?.text).toContain("process SECOND");
    expect(d.path).toBe("main.nf");
    expect(d.line).toBe(callee?.declaration?.range.line);
    const missing = await detailsOf({
      "main.nf":
        "include { GONE } from './missing.nf'\nworkflow {\n    main:\n    GONE(channel.of(1))\n}\n",
    });
    const gone = nodeNamed(missing, "GONE");
    if (gone.kind !== "call") throw new Error("not a call");
    expect(gone.callee.status).toBe("unresolved");
    expect(
      resolveCallee(missing.model, "main.nf", "GONE")?.declaration,
    ).toBeNull();
    expect(
      declarationDetails(
        missing,
        gone,
        resolveCallee(missing.model, "main.nf", "GONE"),
      ),
    ).toMatchObject({
      path: null,
      line: null,
      description: null,
      preview: null,
    });
  });

  it("F-206 UX-30: a params node without a block previews nothing", async () => {
    const input = await detailsOf({
      "main.nf": `workflow {\n    main:\n    x = params.input\n    publish:\n    y = x\n}\n\noutput {\n    y: Channel<Integer> {\n        path 'y'\n    }\n}\n`,
    });
    for (const node of input.projection.nodes)
      if (node.kind === "params")
        expect(declarationDetails(input, node, null).preview).toBeNull();
    const withBlock = await detailsOf({
      "main.nf": `${TYPED}params {\n    input: String = 'a'\n}\n\nworkflow {\n    main:\n    x = params.input\n}\n`,
    });
    const params = withBlock.projection.nodes.find((n) => n.kind === "params");
    if (params === undefined) throw new Error("no params node");
    expect(declarationDetails(withBlock, params, null).preview?.text).toContain(
      "input: String",
    );
  });
});
