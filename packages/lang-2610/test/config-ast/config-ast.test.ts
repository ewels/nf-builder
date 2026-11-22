import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AstNode,
  type ConfigAssign,
  type ConfigAst,
  type ConfigBlock,
  type ConfigSelector,
  type ConfigStatement,
  walk,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";

const build = (text: string) => {
  const result = parseConfigAst(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
};
const slice = (text: string, node: AstNode) =>
  text.slice(node.range.start, node.range.end);
const find = <T extends AstNode>(ast: ConfigAst, kind: T["kind"]) => {
  const found: T[] = [];
  walk(ast, (n) => {
    if (n.kind === kind) found.push(n as T);
  });
  return found;
};
/** Each assignment's full path, joining the enclosing block names (selectors count their target). */
const fullPaths = (
  statements: readonly ConfigStatement[],
  prefix: string[] = [],
): string[] =>
  statements.flatMap((s) => {
    if (s.kind === "ConfigAssign")
      return [[...prefix, ...s.path.map((n) => n.name)].join(".")];
    if (s.kind === "ConfigBlock")
      return fullPaths(s.statements, [...prefix, s.name.name]);
    if (s.kind === "ConfigSelector")
      return fullPaths(s.statements, [...prefix, s.target.name]);
    return [];
  });

describe("F-103 AR-01: parseConfigAst returns the AST, the errors and the comments", () => {
  it("F-103 AR-01: a parsed config has a root with its statements, every comment in source order and no errors", () => {
    const text = "// a\nx = 1 // b\n/* c\n d */\ny = [1, // e\n 2]\n";
    const result = build(text);
    expect(result.errors).toEqual([]);
    expect(result.ast.kind).toBe("ConfigFile");
    expect(result.ast.statements.map((s) => s.kind)).toEqual([
      "ConfigAssign",
      "ConfigAssign",
    ]);
    expect(result.ast.comments.map((c) => [c.kind, c.text, c.ownLine])).toEqual(
      [
        ["line", "// a", true],
        ["line", "// b", false],
        ["block", "/* c\n d */", true],
        ["line", "// e", false],
      ],
    );
    expect(result.ast.range).toMatchObject({ start: 0, end: text.length });
  });

  it("F-103 AR-01: a config that does not parse gives F-101's error and no AST", () => {
    const result = parseConfigAst("process {\n");
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ source: "parser", line: 2 });
  });

  it("F-103 AR-01: strings that look like comments are not comments", () => {
    const text = `params.pattern = "\${params.dir}/*.vcf.gz"\nparams.url = "\${params.host}//path"\n`;
    expect(build(text).ast.comments).toEqual([]);
  });
});

describe("F-103 FI-01: assignments, blocks and selectors", () => {
  it("F-103 FI-01: dotted assignments keep their path names, quoted and built-in-type names keep their form", () => {
    const text = "docker.enabled = true\n'foo-bar'.x = 1\nint { y = 3 }\n";
    const { ast } = build(text);
    const [a, b, c] = ast.statements;
    expect(a).toMatchObject({ kind: "ConfigAssign" });
    expect(
      (a as unknown as ConfigAssign).path.map((n) => [n.name, n.form]),
    ).toEqual([
      ["docker", "identifier"],
      ["enabled", "identifier"],
    ]);
    expect(slice(text, a as AstNode)).toBe("docker.enabled = true");
    expect(
      (b as unknown as ConfigAssign).path.map((n) => [n.name, n.form]),
    ).toEqual([
      ["foo-bar", "string"],
      ["x", "identifier"],
    ]);
    expect((c as ConfigBlock).name).toMatchObject({
      name: "int",
      form: "builtInType",
    });
  });

  it("F-103 FI-01: the three forms of executor.retry.maxAttempt give the same full path", () => {
    const forms = [
      "executor.retry.maxAttempt = 5\n",
      "executor {\n    retry.maxAttempt = 5\n}\n",
      "executor {\n    retry {\n        maxAttempt = 5\n    }\n}\n",
    ];
    for (const text of forms)
      expect(fullPaths(build(text).ast.statements), text).toEqual([
        "executor.retry.maxAttempt",
      ]);
  });

  it("F-103 FI-01: selectors keep their kind and target, quoted or not, inside process and agent", () => {
    const text = [
      "process {",
      "    withLabel: big_mem { cpus = 1 }",
      "    withName: 'PARENT:hello' { cpus = 2 }",
      "    withLabel: '!hello' { cpus = 3 }",
      "    withName: '.*:FOO' { cpus = 4 }",
      "    withFoo: x { cpus = 5 }",
      "}",
      "agent { withName: helper { cpus = 6 } }",
      "",
    ].join("\n");
    const result = build(text);
    expect(result.errors).toEqual([]);
    const selectors = find<ConfigSelector>(result.ast, "ConfigSelector");
    expect(
      selectors.map((s) => [s.selector.name, s.target.name, s.target.form]),
    ).toEqual([
      ["withLabel", "big_mem", "identifier"],
      ["withName", "PARENT:hello", "string"],
      ["withLabel", "!hello", "string"],
      ["withName", ".*:FOO", "string"],
      ["withFoo", "x", "identifier"],
      ["withName", "helper", "identifier"],
    ]);
    expect(slice(text, selectors[0] as AstNode)).toBe(
      "withLabel: big_mem { cpus = 1 }",
    );
  });

  it("F-103 FI-01: profiles are blocks of blocks, and includes inside them are kept", () => {
    const text =
      "profiles {\n  test {\n    includeConfig 'conf/test.config'\n    params.x = 1\n  }\n}\n";
    const { ast } = build(text);
    const [profiles] = ast.statements as [ConfigBlock];
    expect(profiles.name.name).toBe("profiles");
    const [test] = profiles.statements as [ConfigBlock];
    expect(test.name.name).toBe("test");
    expect(test.statements.map((s) => s.kind)).toEqual([
      "ConfigInclude",
      "ConfigAssign",
    ]);
  });

  it("F-103 FI-01: an unknown scope is kept as a block with no error", () => {
    const text = readFileSync(
      join(
        import.meta.dirname,
        "../../../../tools/corpus/fixtures/unknown-scope.config",
      ),
      "utf8",
    );
    const result = build(text);
    expect(result.errors).toEqual([]);
    expect(result.ast.statements.map((s) => s.kind)).toHaveLength(3);
    expect(
      result.ast.statements.some(
        (s) => s.kind === "ConfigBlock" && s.name.name === "notAScope",
      ),
    ).toBe(true);
  });
});

describe("F-103 FI-05: includeConfig", () => {
  it("F-103 FI-05: includes keep the source expression and the decoded path", () => {
    const text = [
      "includeConfig 'conf/base.config'",
      "includeConfig params.big ? 'conf/a.config' : 'conf/b.config'",
      `includeConfig "\${projectDir}/conf/c.config"`,
      "",
    ].join("\n");
    const { ast, errors } = build(text);
    expect(errors).toEqual([]);
    const [plain, ternary, gstring] = ast.statements as unknown as {
      kind: string;
      source: {
        kind: string;
        value?: string;
        consequent?: { value: string };
        alternate?: { value: string };
      };
      range: AstNode["range"];
    }[];
    expect(plain?.kind).toBe("ConfigInclude");
    expect(plain?.source).toMatchObject({
      kind: "String",
      value: "conf/base.config",
    });
    expect(slice(text, plain as unknown as AstNode)).toBe(
      "includeConfig 'conf/base.config'",
    );
    expect(ternary?.source.kind).toBe("Ternary");
    expect(ternary?.source.consequent?.value).toBe("conf/a.config");
    expect(ternary?.source.alternate?.value).toBe("conf/b.config");
    expect(gstring?.source.kind).toBe("GString");
  });
});

describe("F-103 FI-01: apply, incomplete and invalid statements", () => {
  it("F-103 FI-01: plugins is an apply block; any other apply block is kept and reported; an empty one is a block", () => {
    const ok = build("plugins {\n  id 'nf-schema@2.1.0'\n  id 'x'\n}\n");
    expect(ok.errors).toEqual([]);
    expect(ok.ast.statements[0]).toMatchObject({
      kind: "ConfigApplyBlock",
      name: { name: "plugins" },
    });
    expect(find(ok.ast, "ConfigApply")).toHaveLength(2);
    expect(find(ok.ast, "ConfigApply")[0]).toMatchObject({
      name: { name: "id" },
      args: [{ kind: "String", value: "nf-schema@2.1.0" }],
    });

    const bad = build("process {\n    cpus 4\n}\n");
    expect(bad.ast.statements[0]?.kind).toBe("ConfigApplyBlock");
    expect(bad.errors).toMatchObject([
      {
        message: "Config settings must be assigned with an equals sign (`=`)",
        line: 1,
        column: 1,
      },
    ]);

    expect(build("plugins { }\n").ast.statements[0]?.kind).toBe("ConfigBlock");
  });

  it("F-103 FI-01 ADR-0004: incomplete statements are kept and reported", () => {
    const cases: [string, string[], boolean, number, number][] = [
      ["process.cpus", ["process", "cpus"], false, 1, 1],
      ["process {\n    cpus\n}", ["cpus"], false, 2, 5],
      ["process.", ["process"], true, 1, 1],
    ];
    for (const [text, names, trailingDot, line, column] of cases) {
      const result = build(text);
      const [incomplete] = find(result.ast, "ConfigIncomplete") as unknown as {
        path: { name: string }[];
        trailingDot: boolean;
      }[];
      expect(
        incomplete?.path.map((n) => n.name),
        text,
      ).toEqual(names);
      expect(incomplete?.trailingDot, text).toBe(trailingDot);
      expect(result.errors, text).toMatchObject([
        { message: "Incomplete statement", line, column },
      ]);
    }
  });

  it("F-103 FI-01 ADR-0004: if, try and def among config statements are kept as invalid statements and reported", () => {
    const text =
      "if( true ) {\n  x = 1\n}\ndef x = 1\ntry { x } catch( Exception e ) { y }\n";
    const result = build(text);
    expect(result.ast.statements.map((s) => s.kind)).toEqual([
      "ConfigInvalid",
      "ConfigInvalid",
      "ConfigInvalid",
    ]);
    expect(
      result.ast.statements.map(
        (s) => (s as unknown as { statement: AstNode }).statement.kind,
      ),
    ).toEqual(["If", "VariableDeclaration", "TryCatch"]);
    expect(result.errors.map((e) => [e.line, e.column, e.message])).toEqual([
      [1, 1, "If statements cannot be mixed with config statements"],
      [4, 1, "Variable declarations cannot be mixed with config statements"],
      [5, 1, "Try-catch blocks cannot be mixed with config statements"],
    ]);
  });
});
