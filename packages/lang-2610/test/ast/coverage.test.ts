import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSIGNMENT_OPERATORS,
  BINARY_OPERATORS,
  SCRIPT_NODE_KINDS,
  type ScriptAst,
  walk,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";

const dir = dirname(fileURLToPath(import.meta.url));
type Fixture = {
  file: string;
  sections: string[];
  source: string[];
  note?: string;
  adjusted?: string;
  lint: unknown[];
};
const manifest = JSON.parse(
  readFileSync(join(dir, "fixtures.json"), "utf8"),
) as {
  upstream: { commit: string };
  fixtures: Fixture[];
};

const asts = manifest.fixtures.map(({ file }) => {
  const text = readFileSync(join(dir, "fixtures", file), "utf8");
  const result = parseScriptAst(text);
  if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.errors)}`);
  return { file, ast: result.ast };
});

type Visited = Record<string, unknown> & { kind: string };
const visit = (each: (node: Visited, ast: ScriptAst) => void) => {
  for (const { ast } of asts)
    walk(ast, (node) => {
      each(node as unknown as Visited, ast);
    });
};

// docs/reference/syntax.mdx at nextflow-io/nextflow 0ad848ef: one section per construct.
const SYNTAX_SECTIONS = [
  "Comments",
  "Script declarations",
  "Shebang",
  "Feature flag",
  "Include",
  "Params block",
  "Parameter (legacy)",
  "Workflow",
  "Workflow (typed)",
  "Process",
  "Process (typed)",
  "Agent",
  "Function",
  "Enum type",
  "Record type",
  "Output block",
  "Statements",
  "Variable declaration",
  "Assignment",
  "Expression statement",
  "assert",
  "if/else",
  "return",
  "throw",
  "try/catch",
  "Variable",
  "Number",
  "Boolean",
  "Null",
  "String",
  "Dynamic string",
  "List",
  "Map",
  "Closure",
  "Index expression",
  "Property expression",
  "Function call",
  "Constructor call",
  "Unary expressions",
  "Binary expressions",
  "Ternary expression",
  "Parentheses",
  "Precedence",
];

describe("F-102 step 1: the fixtures cover the syntax reference", () => {
  it("F-102 step 1: the fixtures cover every construct section of the 26.10 syntax reference", () => {
    const covered = new Set(manifest.fixtures.flatMap((f) => f.sections));
    expect(SYNTAX_SECTIONS).toHaveLength(43);
    expect([...covered].sort()).toEqual([...SYNTAX_SECTIONS].sort());
  });

  it("F-102 step 1 AR-02: every script AST node kind appears in a fixture snapshot", () => {
    // error-only kinds are covered in errors.test.ts
    const errorOnly = new Set([
      "Import",
      "IncompleteDeclaration",
      "InvalidDeclaration",
      "IncompleteExpression",
      // built only by F-104's fallback; tested in test/source/
      "Unparsed",
    ]);
    const seen = new Set<string>();
    visit((node) => {
      seen.add(node.kind);
    });
    const wanted = SCRIPT_NODE_KINDS.filter((k) => !errorOnly.has(k));
    expect([...seen].sort()).toEqual([...wanted].sort());
  });

  it("F-102 step 1: every binary and assignment operator appears", () => {
    const binary = new Set<unknown>();
    const assignment = new Set<unknown>();
    const labels = new Set<unknown>();
    visit((node) => {
      if (node.kind === "Binary") binary.add(node.operator);
      if (node.kind === "Assignment") assignment.add(node.operator);
      if (node.kind === "Section" && node.label) labels.add(node.label);
    });
    expect([...binary].sort()).toEqual([...BINARY_OPERATORS].sort());
    expect([...assignment].sort()).toEqual([...ASSIGNMENT_OPERATORS].sort());
    expect([...labels].sort()).toEqual(
      [
        "input",
        "stage",
        "output",
        "topic",
        "when",
        "script",
        "shell",
        "exec",
        "stub",
        "prompt",
        "take",
        "main",
        "emit",
        "publish",
        "onComplete",
        "onError",
      ].sort(),
    );
  });

  it("F-102 LA-10: typed and legacy processes and workflows both build", () => {
    const seen = new Set<string>();
    visit((node, ast) => {
      if (node.kind !== "Process" && node.kind !== "Workflow") return;
      seen.add(`${node.kind} typed=${node.typed}`);
      if (node.kind === "Process" && ast.typesEnabled)
        expect(node.typed, "a process after the types flag is typed").toBe(
          true,
        );
    });
    expect([...seen].sort()).toEqual([
      "Process typed=false",
      "Process typed=true",
      "Workflow typed=false",
      "Workflow typed=true",
    ]);
  });

  it("F-102: the manifest lists every fixture file, cites the pinned docs and records an empty lint result", () => {
    const upstream = JSON.parse(
      readFileSync(join(dir, "../../upstream.json"), "utf8"),
    ) as { nextflow: { commit: string } };
    expect(manifest.upstream.commit).toBe(upstream.nextflow.commit);
    const onDisk: string[] = [];
    const list = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, entry.name);
        if (entry.isDirectory()) list(path);
        else if (entry.name.endsWith(".nf"))
          onDisk.push(relative(join(dir, "fixtures"), path));
      }
    };
    list(join(dir, "fixtures"));
    expect(onDisk.sort()).toEqual(manifest.fixtures.map((f) => f.file).sort());
    for (const f of manifest.fixtures) {
      for (const source of f.source)
        expect(source, f.file).toMatch(
          /^docs\/reference\/syntax\.mdx#L\d+(-L\d+)?$/,
        );
      if (f.source.length === 0)
        expect(
          f.note,
          `${f.file} cites no source, so it needs a note`,
        ).toBeTruthy();
      expect(f.lint, f.file).toEqual([]);
    }
  });
});
