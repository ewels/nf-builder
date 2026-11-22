import {
  type Expression,
  NO_RANGE,
  type ProjectTree,
} from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  configInclude,
  MODULE_REFERENCE,
  registryBase,
  scriptInclude,
} from "../../src/includes/resolve.ts";

/** An in-memory project: files by path, directories derived from them. */
function tree(...files: string[]): ProjectTree {
  const set = new Set(files);
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++)
      dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    isFile: (p) => set.has(p),
    isDirectory: (p) => dirs.has(p),
  };
}

const str = (value: string): Expression => ({
  kind: "String",
  range: NO_RANGE,
  text: `'${value}'`,
  value,
  quote: "'",
});
const paren = (expression: Expression): Expression => ({
  kind: "Parenthesized",
  range: NO_RANGE,
  expression,
});

describe("script include resolution", () => {
  it("F-105 step 1 AR-03: a relative include of a directory resolves to its main.nf, and a directory wins over a .nf file", () => {
    const t = tree("modules/a/main.nf", "modules/b/main.nf", "modules/b.nf");
    expect(scriptInclude("main.nf", "./modules/a", t)).toEqual({
      kind: "file",
      path: "modules/a/main.nf",
      module: null,
    });
    expect(scriptInclude("main.nf", "./modules/b", t)).toEqual({
      kind: "file",
      path: "modules/b/main.nf",
      module: null,
    });
    expect(scriptInclude("a/b/main.nf", "../../modules/a/", t)).toEqual({
      kind: "file",
      path: "modules/a/main.nf",
      module: null,
    });
  });

  it("F-105 step 1 AR-03: a relative include without .nf gets .nf; one ending in .nf is used as written", () => {
    const t = tree("modules/c.nf", "lib/d.nf");
    expect(scriptInclude("main.nf", "./modules/c", t)).toEqual({
      kind: "file",
      path: "modules/c.nf",
      module: null,
    });
    expect(scriptInclude("main.nf", "./modules/c.nf", t)).toEqual({
      kind: "file",
      path: "modules/c.nf",
      module: null,
    });
    expect(scriptInclude("sub/main.nf", "../lib/d.nf", t)).toEqual({
      kind: "file",
      path: "lib/d.nf",
      module: null,
    });
    // an explicit .nf that is a directory is still a directory: main.nf is taken
    const u = tree("x.nf/main.nf");
    expect(scriptInclude("main.nf", "./x.nf", u)).toEqual({
      kind: "file",
      path: "x.nf/main.nf",
      module: null,
    });
  });

  it("F-105 step 1: a missing local target names the path nf-lang checks", () => {
    const t = tree("modules/b/meta.yml", "main.nf");
    const msg = (from: string, source: string) => {
      const r = scriptInclude(from, source, t);
      expect(r.kind).toBe("missing");
      return r.kind === "missing" ? [r.path, r.message, r.module] : null;
    };
    expect(msg("main.nf", "./missing/c")).toEqual([
      "missing/c.nf",
      "Invalid include source: 'missing/c.nf'",
      null,
    ]);
    expect(msg("main.nf", "./modules/b")).toEqual([
      "modules/b/main.nf",
      "Invalid include source: 'modules/b/main.nf'",
      null,
    ]);
    expect(msg("main.nf", "../outside/d.nf")).toEqual([
      "../outside/d.nf",
      "Invalid include source: '../outside/d.nf'",
      null,
    ]);
    expect(msg("main.nf", "/abs/e")).toEqual([
      "/abs/e.nf",
      "Invalid include source: '/abs/e.nf'",
      null,
    ]);
  });

  it("F-105 step 1 AR-03 IO-32: a registry name resolves to modules/<scope>/<name>/main.nf from the project root", () => {
    const t = tree(
      "modules/nf-core/fastqc/main.nf",
      "modules/nf-core/fastqc/meta.yml",
      "modules/nf-core/samtools/index/main.nf",
      "modules/nf-core/samtools/index/meta.yml",
    );
    expect(scriptInclude("main.nf", "nf-core/fastqc", t)).toEqual({
      kind: "file",
      path: "modules/nf-core/fastqc/main.nf",
      module: "nf-core/fastqc",
    });
    expect(scriptInclude("main.nf", "nf-core/samtools/index", t)).toEqual({
      kind: "file",
      path: "modules/nf-core/samtools/index/main.nf",
      module: "nf-core/samtools/index",
    });
    expect(scriptInclude("main.nf", " nf-core/fastqc ", t)).toEqual({
      kind: "file",
      path: "modules/nf-core/fastqc/main.nf",
      module: "nf-core/fastqc",
    });
  });

  it("F-105 AR-03: a script under a modules/ directory resolves registry names in its own directory (nested vendoring)", () => {
    const t = tree(
      "modules/nf-core/top/main.nf",
      "modules/nf-core/top/meta.yml",
      "modules/local/x/modules/nf-core/top/main.nf",
      "modules/local/x/modules/nf-core/top/meta.yml",
    );
    expect(registryBase("main.nf")).toBe("");
    expect(registryBase("subworkflows/local/s/main.nf")).toBe("");
    expect(registryBase("modules/local/x/main.nf")).toBe("modules/local/x");
    expect(registryBase("modules/main.nf")).toBe("modules");
    expect(scriptInclude("modules/local/x/main.nf", "nf-core/top", t)).toEqual({
      kind: "file",
      path: "modules/local/x/modules/nf-core/top/main.nf",
      module: "nf-core/top",
    });
    expect(scriptInclude("main.nf", "nf-core/top", t)).toEqual({
      kind: "file",
      path: "modules/nf-core/top/main.nf",
      module: "nf-core/top",
    });
    expect(
      scriptInclude("subworkflows/local/s/main.nf", "nf-core/top", t),
    ).toEqual({
      kind: "file",
      path: "modules/nf-core/top/main.nf",
      module: "nf-core/top",
    });
    // nested: the module is only at the root, so a vendored script does not find it
    const root = tree(
      "modules/nf-core/present/main.nf",
      "modules/nf-core/present/meta.yml",
    );
    const r = scriptInclude("modules/local/x/main.nf", "nf-core/present", root);
    expect(r).toMatchObject({
      kind: "missing",
      path: "modules/local/x/modules/nf-core/present/main.nf",
    });
  });

  it("F-105 step 1: a registry module not in the project names its missing main.nf, and one without meta.yml names that", () => {
    const t = tree("modules/nf-core/nometa/main.nf");
    expect(scriptInclude("main.nf", "nf-core/x", t)).toEqual({
      kind: "missing",
      path: "modules/nf-core/x/main.nf",
      module: "nf-core/x",
      message:
        "Module 'nf-core/x' is not in the project: 'modules/nf-core/x/main.nf' does not exist",
    });
    expect(scriptInclude("main.nf", "nf-core/nometa", t)).toEqual({
      kind: "missing",
      path: "modules/nf-core/nometa/meta.yml",
      module: "nf-core/nometa",
      message:
        "Module 'nf-core/nometa' is incomplete: 'modules/nf-core/nometa/meta.yml' does not exist",
    });
  });

  it("F-105 step 1: an invalid module reference gets nf-lang's message", () => {
    const t = tree();
    const bad = (source: string) => {
      const r = scriptInclude("main.nf", source, t);
      expect(r.kind).toBe("missing");
      return r.kind === "missing" ? r : null;
    };
    for (const s of ["Bad", "nf-core", "nf-core/", "nf-core/FastQC", "-x/y"]) {
      const r = bad(s);
      expect(r?.path).toBeNull();
      expect(r?.module).toBeNull();
      expect(r?.message).toBe(
        `Invalid module reference: '${s}'. Expected format: scope/name where scope is lowercase alphanumeric with dots/underscores/hyphens and name is lowercase alphanumeric with underscores/hyphens, optionally with slash-separated segments`,
      );
    }
    expect(bad("")?.message).toBe("Module reference cannot be empty");
    expect(bad("  ")?.message).toContain("Invalid module reference: ''.");
    expect(MODULE_REFERENCE.test("nf-core/samtools/index")).toBe(true);
    expect(MODULE_REFERENCE.test("nf-core/9x")).toBe(false);
  });

  it("F-105 AR-03: plugin/ sources are plugins, not files", () => {
    const t = tree();
    expect(scriptInclude("main.nf", "plugin/nf-schema", t)).toEqual({
      kind: "plugin",
      plugin: "nf-schema",
    });
    expect(scriptInclude("a/main.nf", "plugin/nf-validation", t)).toEqual({
      kind: "plugin",
      plugin: "nf-validation",
    });
  });
});

describe("config include resolution", () => {
  it("F-105 step 1 FI-05: includeConfig with a constant path resolves against the including file, with no extension added", () => {
    const t = tree(
      "nextflow.config",
      "conf/base.config",
      "conf/test",
      "conf/test.config",
      "conf/sub/x.config",
    );
    expect(
      configInclude("nextflow.config", str("conf/base.config"), t),
    ).toEqual({ kind: "file", path: "conf/base.config", module: null });
    expect(
      configInclude("nextflow.config", paren(str("conf/base.config")), t),
    ).toEqual({ kind: "file", path: "conf/base.config", module: null });
    expect(configInclude("conf/inc.config", str("sub/x.config"), t)).toEqual({
      kind: "file",
      path: "conf/sub/x.config",
      module: null,
    });
    expect(configInclude("conf/inc.config", str("../conf/test"), t)).toEqual({
      kind: "file",
      path: "conf/test",
      module: null,
    });
    // no .config appended: `test` is missing even though `test.config` exists
    expect(configInclude("conf/inc.config", str("nothing"), t)).toEqual({
      kind: "missing",
      path: "conf/nothing",
      module: null,
      message: "Invalid include source: 'conf/nothing'",
    });
    // a directory counts as missing
    expect(configInclude("nextflow.config", str("conf/sub"), t)).toMatchObject({
      kind: "missing",
      path: "conf/sub",
    });
  });

  it("F-105 FI-05: includeConfig with an expression or URL is external", () => {
    const t = tree("x.config");
    const gstring: Expression = {
      kind: "GString",
      range: NO_RANGE,
      quote: '"',
      parts: [],
    };
    const variable: Expression = {
      kind: "Variable",
      range: NO_RANGE,
      name: "p",
    };
    const ternary: Expression = {
      kind: "Ternary",
      range: NO_RANGE,
      condition: variable,
      consequent: str("x.config"),
      alternate: str("y.config"),
    };
    for (const e of [gstring, variable, ternary, paren(gstring)]) {
      expect(configInclude("nextflow.config", e, t)).toEqual({
        kind: "external",
      });
    }
    for (const url of ["https://example.org/x.config", "s3://b/x.config"]) {
      expect(configInclude("nextflow.config", str(url), t)).toEqual({
        kind: "external",
      });
    }
    expect(configInclude("nextflow.config", str("file:/x"), t)).toEqual({
      kind: "missing",
      path: "/x",
      module: null,
      message: "Invalid include source: '/x'",
    });
  });

  it("F-105 FI-05: a Number, Boolean or Null constant is the path nf-lang's getText() gives", () => {
    const t = tree("conf/inc.config");
    const num = (text: string): Expression => ({
      kind: "Number",
      range: NO_RANGE,
      text,
      integer: !/[.eE]|[fFdD]$/.test(text),
    });
    const missingPath = (e: Expression) => {
      const r = configInclude("conf/inc.config", e, t);
      return r.kind === "missing" ? [r.path, r.message] : r.kind;
    };
    expect(missingPath(num("42"))).toEqual([
      "conf/42",
      "Invalid include source: 'conf/42'",
    ]);
    expect(missingPath(num("1_0"))?.[0]).toBe("conf/10");
    expect(missingPath(num("7L"))?.[0]).toBe("conf/7");
    expect(missingPath(num("0x10"))?.[0]).toBe("conf/16");
    expect(missingPath(num("1.5f"))?.[0]).toBe("conf/1.5");
    expect(
      missingPath({ kind: "Boolean", range: NO_RANGE, value: true })?.[0],
    ).toBe("conf/true");
    expect(missingPath({ kind: "Null", range: NO_RANGE })?.[0]).toBe(
      "conf/null",
    );
    const present = tree("conf/42");
    expect(configInclude("conf/inc.config", num("42"), present)).toMatchObject({
      kind: "file",
      path: "conf/42",
    });
  });
});

describe("script include directory check", () => {
  it("F-105 AR-03: the directory check is made on the unnormalised path, as ModuleResolver.getLocalIncludeUri does", () => {
    const t = tree("x/a.txt", "y/main.nf", "y.nf");
    // ./x/../y: x exists, so the path is a directory
    expect(scriptInclude("main.nf", "./x/../y", t)).toMatchObject({
      kind: "file",
      path: "y/main.nf",
    });
    // ./nox/../y: nox does not exist, so the filesystem cannot resolve it and it is not a directory: y.nf
    expect(scriptInclude("main.nf", "./nox/../y", t)).toMatchObject({
      kind: "file",
      path: "y.nf",
    });
    // a plain directory is unaffected
    expect(scriptInclude("a/main.nf", "../y", t)).toMatchObject({
      kind: "file",
      path: "y/main.nf",
    });
  });
});
