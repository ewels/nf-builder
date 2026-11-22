import { readFileSync } from "node:fs";
import type { Unparsed } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst, parseScriptAst } from "../../src/ast/index.ts";
import {
  parseConfigSource,
  parseScriptSource,
  statusOf,
} from "../../src/source/parse-source.ts";
import { configFixtures, malformed, scriptFixtures } from "./files.ts";
import { labelOf } from "./labels.ts";
import { checkTiling } from "./tiling.ts";

describe("F-104 ADR-0004: isolating declarations on the whole-file path", () => {
  it("F-104 ADR-0004: a file that parses with no errors is fully modelled and its AST is the builder's", () => {
    const script =
      "process A {\n    script:\n    'echo'\n}\n\nworkflow {\n    A()\n}\n";
    const s = parseScriptSource(script);
    const built = parseScriptAst(script);
    expect(s.status).toBe("modelled");
    expect(s.problems).toEqual([]);
    expect(built.ok && s.ast).toEqual(built.ok ? built.ast : null);
    const config = "// c\ndocker.enabled = true\nprocess { cpus = 1 }\n";
    const c = parseConfigSource(config);
    const builtConfig = parseConfigAst(config);
    expect(c.status).toBe("modelled");
    expect(c.problems).toEqual([]);
    expect(builtConfig.ok && c.ast).toEqual(
      builtConfig.ok ? builtConfig.ast : null,
    );
  });

  it("F-104 step 2 ADR-0004: a declaration with a builder error becomes Unparsed with its exact text, head and problems", () => {
    const text = malformed("typed-without-flag.nf");
    const r = parseScriptSource(text);
    expect(r.status).toBe("partial");
    const ast = r.ast;
    const [first, second] = ast?.body ?? [];
    expect(first?.kind).toBe("Unparsed");
    const u = first as Unparsed;
    expect(u.head).toEqual({ keyword: "process", name: "HELLO" });
    expect(u.text).toBe(
      text
        .slice(text.indexOf("process HELLO {"), text.indexOf("process GOODBYE"))
        .trimEnd(),
    );
    expect(u.problems.map((p) => [p.line, p.column])).toEqual([[4, 5]]);
    expect(second?.kind).toBe("Process");
    expect(labelOf(second as never, text)).toBe("process GOODBYE");
    expect(checkTiling(text, ast as never)).toEqual([]);
  });

  it("F-104: an InvalidDeclaration is Unparsed and named by the pre-scanner", () => {
    const text = malformed("section-order.nf");
    const body = parseScriptSource(text).ast?.body ?? [];
    expect(body.map((i) => i.kind)).toEqual(["Unparsed", "Process"]);
    expect((body[0] as Unparsed).head).toEqual({
      keyword: "process",
      name: "LATE_INPUT",
    });
  });

  it("F-104: comments move with the item they belong to", () => {
    const text = [
      "nextflow.enable.types = true",
      "",
      "/** Docs. */",
      "process LEGACY {",
      "    // inner",
      "    input:",
      "    val x",
      "",
      "    script:",
      "    'echo'",
      "}",
      "",
    ].join("\n");
    const r = parseScriptSource(text);
    const ast = r.ast;
    const u = ast?.body.find((i) => i.kind === "Unparsed") as Unparsed;
    expect(u.head?.name).toBe("LEGACY");
    expect(u.leadingComments?.map((c) => c.text)).toEqual(["/** Docs. */"]);
    expect(ast?.comments.map((c) => c.text)).toEqual(["/** Docs. */"]);
    expect(u.text).toContain("// inner");
  });

  it("F-104: whole-script checks never isolate a declaration", () => {
    const cases = [
      "params {\n    a: String\n}\nparams {\n    b: String\n}\nworkflow {\n}\n",
      "params {\n    a: String\n}\n",
      "process A {\n    script:\n    'x'\n}\nprintln 'hi'\n",
    ];
    for (const text of cases) {
      const r = parseScriptSource(text);
      const body = r.ast?.body ?? [];
      expect(
        body.some((i) => i.kind === "Unparsed"),
        text,
      ).toBe(false);
      expect(r.problems.length, text).toBeGreaterThan(0);
      expect(
        r.problems.every((p) => p.scope === "file"),
        text,
      ).toBe(true);
    }
  });

  it("F-104 ADR-0004: text the builder dropped is kept as Unparsed", () => {
    const text = "nextflow.enable.types = true\n\nparams.input = 'x'\n";
    const r = parseScriptSource(text);
    const body = r.ast?.body ?? [];
    expect(body[0]?.kind).toBe("FeatureFlag");
    const u = body[1] as Unparsed;
    expect(u.kind).toBe("Unparsed");
    expect(u.text).toBe("params.input = 'x'");
    expect(u.head).toEqual({ keyword: "param", name: "params.input" });
    expect(u.problems.length).toBeGreaterThan(0);
    expect(u.text).toBe(text.slice(u.range.start, u.range.end));
    expect(u.range.line).toBe(3);
    expect(u.range.column).toBe(1);
    expect(checkTiling(text, r.ast as never)).toEqual([]);
  });

  it("F-104: statusOf distinguishes modelled, partial and verbatim", () => {
    expect(statusOf(2, 0, false)).toBe("modelled");
    expect(statusOf(0, 0, false)).toBe("modelled");
    expect(statusOf(2, 1, false)).toBe("partial");
    expect(statusOf(0, 1, false)).toBe("verbatim");
    expect(statusOf(0, 0, true)).toBe("verbatim");
    expect(statusOf(1, 0, true)).toBe("modelled");
    expect(statusOf(1, 1, true)).toBe("partial");
    expect(parseScriptSource("").status).toBe("modelled");
    expect(parseScriptSource("// only a comment\n").status).toBe("modelled");
  });

  it("F-104 IO-14: a file that parses but has only builder-error items is verbatim", () => {
    const r = parseScriptSource(
      malformed("typed-without-flag.nf").split("process GOODBYE")[0] as string,
    );
    expect(r.status).toBe("verbatim");
    expect(r.ast).toBeNull();
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("F-104 ADR-0004: nothing is isolated that the builder accepts", () => {
  it("F-104 ADR-0004: every error-free AST and config fixture stays fully modelled with nothing left over", () => {
    const files = [...scriptFixtures(), ...configFixtures()];
    let clean = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const config = file.endsWith(".config");
      const built = config ? parseConfigAst(text) : parseScriptAst(text);
      if (!built.ok || built.errors.length > 0) continue;
      clean++;
      const r = config ? parseConfigSource(text) : parseScriptSource(text);
      expect(r.status, file).toBe("modelled");
      expect(r.ast, file).toEqual(built.ast);
    }
    expect(clean).toBeGreaterThan(40);
  });
});
