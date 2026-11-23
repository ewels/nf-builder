import type { Diagnostic } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { resolveCallee } from "../../src/details/declaration";
import {
  diagnosticsWithin,
  nodeDiagnosticScopes,
} from "../../src/details/diagnostics";
import { detailsOf, nodeNamed } from "./open";

const r = (start: number, end: number) => ({
  start,
  end,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});
const d = (
  path: string,
  start: number,
  end: number,
  code = "c",
): Diagnostic => ({
  path,
  range: r(start, end),
  severity: "warning",
  message: code,
  code,
});

const MAIN = `include { P } from './p.nf'\nworkflow {\n    main:\n    P(channel.of(1))\n}\n`;
const P = "process P {\n    input:\n    val x\n    script:\n    'true'\n}\n";

describe("F-206 diagnostics scopes", () => {
  it("F-206 UX-30 AR-05: a node's diagnostics are those inside its range in the workflow file", async () => {
    const input = await detailsOf({ "main.nf": MAIN, "p.nf": P });
    const node = nodeNamed(input, "channel.of");
    const scopes = nodeDiagnosticScopes(input.projection, node, null);
    expect(scopes).toEqual([{ path: "main.nf", range: node.range }]);
    const inside = d("main.nf", node.range.start, node.range.end - 1, "in");
    const outside = d("main.nf", 0, 3, "out");
    const other = d("p.nf", node.range.start, node.range.end - 1, "file");
    expect(
      diagnosticsWithin([outside, inside, other], scopes).map((x) => x.code),
    ).toEqual(["in"]);
  });

  it("F-206 UX-30: a call also gets the diagnostics inside its callee's declaration, in the callee's file", async () => {
    const input = await detailsOf({ "main.nf": MAIN, "p.nf": P });
    const node = nodeNamed(input, "P");
    const callee = resolveCallee(input.model, "main.nf", "P");
    const scopes = nodeDiagnosticScopes(input.projection, node, callee);
    expect(scopes.map((s) => s.path)).toEqual(["main.nf", "p.nf"]);
    const found = diagnosticsWithin(
      [
        d("p.nf", 5, 10, "decl"),
        d("main.nf", node.range.start, node.range.start + 1, "call"),
      ],
      scopes,
    );
    expect(found.map((x) => x.code).sort()).toEqual(["call", "decl"]);
  });

  it("F-206 UX-30 AR-03: an unresolved or unparsed callee also gets the diagnostics of the include binding it", async () => {
    const input = await detailsOf({
      "main.nf": MAIN,
      "p.nf": "process P {\n    input:\n    val x\n    script\n}\n",
    });
    const node = nodeNamed(input, "P");
    const callee = resolveCallee(input.model, "main.nf", "P");
    const scopes = nodeDiagnosticScopes(input.projection, node, callee);
    const include = scopes.find(
      (s) => s.path === "main.nf" && s.range.start === 0,
    );
    expect(include).toBeDefined();
    expect(
      diagnosticsWithin([d("main.nf", 2, 8, "include-name")], scopes),
    ).toHaveLength(1);
  });

  it("F-206: a diagnostic that only overlaps a node is excluded; a params or output node spanning the workflow gets none; a ScriptAst pipeline declaration is not a scope", async () => {
    expect(
      diagnosticsWithin(
        [d("a.nf", 5, 15)],
        [{ path: "a.nf", range: r(10, 20) }],
      ),
    ).toEqual([]);
    expect(
      diagnosticsWithin(
        [d("a.nf", 10, 12, "x"), d("a.nf", 10, 12, "x")],
        [
          { path: "a.nf", range: r(10, 20) },
          { path: "a.nf", range: r(0, 30) },
        ],
      ),
    ).toHaveLength(1);
    const input = await detailsOf({
      "main.nf": `workflow {\n    main:\n    x = params.input\n}\n`,
    });
    const params = input.projection.nodes.find((n) => n.kind === "params");
    if (params === undefined) throw new Error("no params node");
    expect(nodeDiagnosticScopes(input.projection, params, null)).toEqual([]);
    const pipe = await detailsOf({
      "main.nf": `include { workflow as P } from './pipe.nf'\nworkflow {\n    main:\n    P(channel.of(1))\n}\n`,
      "pipe.nf": "workflow {\n    main:\n    x = channel.of(1)\n}\n",
    });
    const call = nodeNamed(pipe, "P");
    const callee = resolveCallee(pipe.model, "main.nf", "P");
    const scopes = nodeDiagnosticScopes(pipe.projection, call, callee);
    const text = pipe.model.file("pipe.nf")?.source.text ?? "";
    const scope = scopes.find((s) => s.path === "pipe.nf");
    expect(scope?.range.start).toBe(0);
    expect(scope?.range.end).toBe(text.trimEnd().length);
    expect(scope?.range.end).toBeLessThan(text.length);
  });
});
