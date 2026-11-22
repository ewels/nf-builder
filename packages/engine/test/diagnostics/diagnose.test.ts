import type {
  Diagnostic,
  IncludeRules,
  LanguagePack,
  LintRule,
  PackLints,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  compareDiagnostics,
  countDiagnostics,
  createDiagnoser,
} from "../../src/diagnostics/diagnose";
import { loadLints } from "../../src/diagnostics/lints";
import { ProjectModel } from "../../src/model/project";
import { installedPacks } from "../../src/packs";
import { createProjector } from "../../src/projection/project";
import { loadParser } from "../../src/source/parser";
import { diagnoseFiles } from "./open";

const HELLO = `process hello {
    script:
    """
    echo hello
    """
}
`;

/** The installed pack's lints with `rules` replaced. */
const withRules = async (rules: readonly LintRule[]): Promise<PackLints> => {
  const { lints } = await diagnoseFiles([]);
  return { ...lints, rules };
};

describe("F-112 diagnoser", () => {
  it("F-112 AR-05: diagnostics come from the parser, the model and the pack's rules, each with path, range, severity, message and code", async () => {
    const rule: LintRule = {
      code: "syntax",
      check: ({ file }) => [
        {
          range: file.ast?.range ?? (undefined as never),
          message: "A rule finding -- fix it",
        },
      ],
    };
    const { diagnoser } = await diagnoseFiles(
      [
        {
          path: "main.nf",
          text: "include { hello } from './missing'\nworkflow { hello() }\n",
        },
        { path: "bad.nf", text: "import java.nio.file.Path\n" },
      ],
      await withRules([rule]),
    );
    const all = diagnoser.all();
    expect(all.map((d) => [d.path, d.code, d.severity])).toEqual([
      ["bad.nf", "syntax", "error"],
      ["main.nf", "include-target", "error"],
      // a rule's finding takes its code's severity from the registry
      ["main.nf", "syntax", "error"],
    ]);
    for (const d of all) {
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.range.end).toBeGreaterThanOrEqual(d.range.start);
    }
    expect(diagnoser.file("main.nf")).toEqual(
      all.filter((d) => d.path === "main.nf"),
    );
    expect(diagnoser.file("nope.nf")).toEqual([]);
  });

  it("F-112 LA-30: syntax errors keep the parser's wording with advice, at lint's position", async () => {
    const { diagnoser } = await diagnoseFiles([
      { path: "bad.nf", text: "import java.nio.file.Path\n" },
    ]);
    const [d] = diagnoser.file("bad.nf");
    expect(d?.code).toBe("syntax");
    // lint: 1:1 Groovy `import` declarations are not supported -- use fully-qualified name inline instead
    expect([d?.range.line, d?.range.column]).toEqual([1, 1]);
    expect(d?.message).toBe(
      "Groovy `import` declarations are not supported -- use fully-qualified name inline instead",
    );
    const eof = await diagnoseFiles([
      { path: "a.nf", text: "workflow {\n  println 1\n" },
    ]);
    expect(eof.diagnoser.file("a.nf")[0]?.message).toMatch(
      /^Unexpected end of file -- /,
    );
    const unexpected = await diagnoseFiles([
      { path: "a.nf", text: "process 'MY-PROC' {\n}\n" },
    ]);
    expect(unexpected.diagnoser.file("a.nf")[0]?.message).toMatch(
      /^Unexpected input: ''MY-PROC'' -- \S/,
    );
  });

  it("F-112 AR-03: include diagnostics get advice and keep nf-lang's wording as their start", async () => {
    const { diagnoser, model } = await diagnoseFiles([
      { path: "main.nf", text: "include { nothere } from './hello.nf'\n" },
      { path: "hello.nf", text: HELLO },
    ]);
    const [d] = diagnoser.file("main.nf");
    const raw = model.diagnostics()[0];
    expect(d?.code).toBe("include-name");
    expect(d?.message.startsWith(`${raw?.message} -- `)).toBe(true);
    expect(d?.range).toEqual(raw?.range);
  });

  it("F-112 IO-14: a rule that throws gives an internal warning and the other rules still run", async () => {
    const boom: LintRule = {
      code: "syntax",
      check: () => {
        throw new Error("kaboom");
      },
    };
    const fine: LintRule = {
      code: "include-name",
      check: ({ file }) => [
        {
          range: file.ast?.range ?? (undefined as never),
          message: "still ran",
        },
      ],
    };
    const { diagnoser } = await diagnoseFiles(
      [{ path: "main.nf", text: HELLO }],
      await withRules([boom, fine]),
    );
    const list = diagnoser.file("main.nf");
    expect(list.map((d) => [d.code, d.severity])).toEqual([
      ["include-name", "error"],
      ["internal", "warning"],
    ]);
    expect(list.find((d) => d.code === "internal")?.message).toBe(
      "Rule `syntax` failed: kaboom -- it is kept as written; edit it as text",
    );
  });

  it("F-112 IO-14: a parser that throws gives an internal warning, not a syntax error", async () => {
    const { model } = await diagnoseFiles([]);
    const parser = await loadParser("26.10");
    const broken = new ProjectModel([{ path: "main.nf", text: HELLO }], {
      parser: {
        ...parser,
        parseScript: () => {
          throw new Error("parser bug");
        },
      },
      includes: installedPacks[0]?.includes as IncludeRules,
    });
    expect(model.paths()).toEqual([]);
    const lints = await loadLints("26.10");
    const catalogue = await (installedPacks[0] as LanguagePack).loadCatalogue();
    const diagnoser = createDiagnoser({
      model: broken,
      projector: createProjector(broken, catalogue.script),
      catalogue,
      lints,
    });
    const list = diagnoser.file("main.nf");
    expect(list.map((d) => [d.code, d.severity])).toEqual([
      ["internal", "warning"],
    ]);
    expect(list[0]?.message).toMatch(
      / -- it is kept as written; edit it as text$/,
    );
  });

  it("F-112 ADR-0004: rules see only the modelled part of a partial file", async () => {
    const seen: string[] = [];
    const spy: LintRule = {
      code: "syntax",
      check: ({ file }) => {
        seen.push(`${file.status}:${file.ast?.kind}`);
        return [];
      },
    };
    const { diagnoser } = await diagnoseFiles(
      [
        {
          path: "main.nf",
          text: `${HELLO}\nprocess broken {\n  script:\n  import x\n}\n`,
        },
      ],
      await withRules([spy]),
    );
    expect(diagnoser.file("main.nf").some((d) => d.code === "syntax")).toBe(
      true,
    );
    expect(seen).toEqual(["partial:Script"]);
    // a verbatim file has no AST, so no rule runs on it
    const none: string[] = [];
    const verbatim = await diagnoseFiles(
      [{ path: "v.nf", text: "/* never closed\n" }],
      await withRules([
        {
          code: "syntax",
          check: () => {
            none.push("ran");
            return [];
          },
        },
      ]),
    );
    expect(verbatim.diagnoser.file("v.nf")[0]?.code).toBe("syntax");
    expect(none).toEqual([]);
  });

  it("F-112 UX-03: countDiagnostics counts errors, warnings and suggestions separately", () => {
    const d = (severity: Diagnostic["severity"]): Diagnostic => ({
      path: "a.nf",
      range: { start: 0, end: 0, line: 1, column: 1, endLine: 1, endColumn: 1 },
      severity,
      message: "m",
      code: "c",
    });
    expect(
      countDiagnostics([
        d("error"),
        d("warning"),
        d("warning"),
        d("suggestion"),
      ]),
    ).toEqual({ errors: 1, warnings: 2, suggestions: 1 });
    expect(countDiagnostics([])).toEqual({
      errors: 0,
      warnings: 0,
      suggestions: 0,
    });
  });

  it("F-112 AR-05: diagnostics sort by path, then range start, then code", () => {
    const at = (path: string, start: number, code: string): Diagnostic => ({
      path,
      range: {
        start,
        end: start,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
      },
      severity: "error",
      message: "m",
      code,
    });
    const list = [
      at("b.nf", 0, "a"),
      at("a.nf", 5, "z"),
      at("a.nf", 5, "b"),
      at("a.nf", 1, "z"),
    ];
    expect(
      [...list]
        .sort(compareDiagnostics)
        .map((x) => `${x.path}:${x.range.start}:${x.code}`),
    ).toEqual(["a.nf:1:z", "a.nf:5:b", "a.nf:5:z", "b.nf:0:a"]);
  });

  it("F-112 AR-31: diagnostics are plain data and deterministic", async () => {
    const files = [
      { path: "main.nf", text: "include { x } from './gone'\nimport y\n" },
    ];
    const one = (await diagnoseFiles(files)).diagnoser.all();
    const two = (await diagnoseFiles(files)).diagnoser.all();
    expect(one.length).toBeGreaterThan(0);
    expect(structuredClone(one)).toEqual(one);
    expect(two).toEqual(one);
  });

  it("F-112 AR-05: a rule's quick fix is carried with its path and edits", async () => {
    const fixer: LintRule = {
      code: "syntax",
      check: ({ file }) => [
        {
          range: file.ast?.range ?? (undefined as never),
          message: "Fixable -- fix it",
          fix: { title: "Fix it", edits: [{ start: 0, end: 0, text: "// " }] },
        },
      ],
    };
    const { diagnoser } = await diagnoseFiles(
      [{ path: "main.nf", text: HELLO }],
      await withRules([fixer]),
    );
    expect(diagnoser.file("main.nf")[0]?.fix).toEqual({
      title: "Fix it",
      path: "main.nf",
      edits: [{ start: 0, end: 0, text: "// " }],
    });
  });
});
