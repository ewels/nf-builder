import { describe, expect, it } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigSource,
  parseScriptSource,
} from "../../src/source/parse-source.ts";
import { checkTiling } from "./tiling.ts";

// `nextflow lint` 26.10.7 accepts a stray closing bracket at the top level: the lexer's popMode on an empty mode stack
// throws, and nf-lang drops the token without a syntax error (docs/research/upstream-bugs.md, 16).
const script = "workflow {\n    println('hi')\n}\n}\n";
const config = "docker.enabled = true\n}\nprocess.cpus = 1\n";

describe("F-104 IO-14: a stray closing bracket is dropped as nextflow lint does", () => {
  it("F-104 IO-14: a script with a stray closing brace parses whole without errors", () => {
    for (const text of [
      script,
      `${script}}\n)\n`,
      "workflow {\n}\n} workflow W {\n}\n",
    ]) {
      const r = parseScriptAst(text);
      expect(r.ok, text).toBe(true);
      expect(r.errors, text).toEqual([]);
    }
  });

  it("F-104 IO-14: a config with a stray closing brace parses whole without errors", () => {
    const r = parseConfigAst(config);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("F-104 IO-14 ADR-0004: such a file is modelled, exactly when lint accepts it, and the model accounts for the brace", () => {
    const s = parseScriptSource(script);
    expect(s.status).toBe("modelled");
    expect(s.problems).toEqual([]);
    expect(s.ast?.body.map((i) => i.kind)).toEqual(["Workflow"]);
    expect(checkTiling(script, s.ast as never)).toEqual([]);
    const c = parseConfigSource(config);
    expect(c.status).toBe("modelled");
    expect(c.problems).toEqual([]);
    expect(c.ast?.statements.map((i) => i.kind)).toEqual([
      "ConfigAssign",
      "ConfigAssign",
    ]);
    expect(checkTiling(config, c.ast as never)).toEqual([]);
  });

  it("F-104 IO-14: an error after a stray brace is reported where it is", () => {
    const r = parseScriptAst("workflow {\n}\n} foo bar baz (\n");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ line: 3, column: 11 });
  });
});
