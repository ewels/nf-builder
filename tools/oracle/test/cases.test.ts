import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadManifest } from "../src/cases.ts";
import { REPO_ROOT } from "../src/paths.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "oracle-cases-"));

describe("F-005 manifest", () => {
  it("F-005: loadManifest applies the defaults (run script main.nf, args [-stub], no errors or output texts)", () => {
    const dir = tmp();
    mkdirSync(join(dir, "one"));
    writeFileSync(join(dir, "one", "main.nf"), "");
    const file = join(dir, "cases.yaml");
    writeFileSync(
      file,
      `cases:
  - id: one
    about: a
    spec: [F-005]
    sources: [https://example.com]
    lint: { expect: ok }
    run: { expect: ok }
`,
    );
    const [c] = loadManifest(file).cases;
    expect(c?.dir).toBe(join(dir, "one"));
    expect(c?.lint).toEqual({ expect: "ok", errors: [] });
    expect(c?.run).toEqual({
      expect: "ok",
      output: [],
      script: "main.nf",
      args: ["-stub"],
    });
  });

  it("F-005: loadManifest reports duplicate ids, unknown keys, a missing case directory, a missing run script and an expect other than ok or error, all in one error", () => {
    const dir = tmp();
    mkdirSync(join(dir, "dup"));
    writeFileSync(join(dir, "dup", "main.nf"), "");
    mkdirSync(join(dir, "noscript"));
    const file = join(dir, "cases.yaml");
    const base = "about: a\n    spec: [F-005]\n    sources: [u]\n";
    writeFileSync(
      file,
      `cases:
  - id: dup
    ${base}    run: { expect: ok }
  - id: dup
    ${base}    run: { expect: ok }
    colour: red
  - id: gone
    ${base}    run: { expect: ok }
  - id: noscript
    ${base}    run: { expect: ok }
  - id: bad
    ${base}    lint: { expect: maybe }
`,
    );
    mkdirSync(join(dir, "bad"));
    let message = "";
    try {
      loadManifest(file);
    } catch (error) {
      message = (error as Error).message;
    }
    const lines = message.split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(`${file}: case `);
    expect(message).toContain("duplicate");
    expect(message).toContain("colour");
    expect(message).toContain("gone");
    expect(message).toContain("main.nf");
    expect(message).toContain("maybe");
  });
});

const problemsOf = (file: string, root: string): string => {
  try {
    loadManifest(file, root);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("F-203 manifest keys", () => {
  const head = "about: a\n    spec: [F-203]\n    sources: [u]\n";

  it("F-203 ADR-0019: dir resolves relative to the manifest; a missing dir or one outside the repository is a problem", () => {
    const root = tmp();
    const cases = join(root, "cases");
    mkdirSync(join(root, "trees", "t"), { recursive: true });
    writeFileSync(join(root, "trees", "t", "main.nf"), "");
    mkdirSync(cases);
    const file = join(cases, "cases.yaml");
    writeFileSync(
      file,
      `cases:\n  - id: viadir\n    ${head}    dir: ../trees/t\n    run: { expect: ok }\n`,
    );
    expect(loadManifest(file, root).cases[0]?.dir).toBe(
      join(root, "trees", "t"),
    );

    writeFileSync(
      file,
      `cases:\n  - id: gone\n    ${head}    dir: ../trees/none\n    run: { expect: ok, script: x.nf }\n  - id: outside\n    ${head}    dir: ../../\n    lint: { expect: ok }\n`,
    );
    const message = problemsOf(file, root);
    expect(message).toContain("case gone: directory");
    expect(message).toContain(
      "case outside: dir must resolve inside the repository",
    );
  });

  it("F-203: lint.clean must be a boolean, is kept on the case, and is refused with expect: error", () => {
    const root = tmp();
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    const file = join(root, "cases.yaml");
    writeFileSync(
      file,
      `cases:\n  - id: a\n    ${head}    lint: { expect: ok, clean: true }\n`,
    );
    expect(loadManifest(file, root).cases[0]?.lint).toEqual({
      expect: "ok",
      errors: [],
      clean: true,
    });
    writeFileSync(
      file,
      `cases:\n  - id: a\n    ${head}    lint: { expect: ok, clean: yes }\n  - id: b\n    ${head}    lint: { expect: error, clean: true }\n`,
    );
    const message = problemsOf(file, root);
    expect(message).toContain("case a: lint.clean must be true or false");
    expect(message).toContain("case b: lint.clean needs lint.expect ok");
  });

  it("F-203: run.tools lists tool names, kept on the case; a name with a path separator is a problem", () => {
    const root = tmp();
    mkdirSync(join(root, "a"));
    writeFileSync(join(root, "a", "main.nf"), "");
    const file = join(root, "cases.yaml");
    writeFileSync(
      file,
      `cases:\n  - id: a\n    ${head}    run: { expect: ok, tools: [fastqc, multiqc] }\n`,
    );
    expect(loadManifest(file, root).cases[0]?.run?.tools).toEqual([
      "fastqc",
      "multiqc",
    ]);
    writeFileSync(
      file,
      `cases:\n  - id: a\n    ${head}    run: { expect: ok, tools: ["../evil"] }\n`,
    );
    expect(problemsOf(file, root)).toContain("run.tools");
  });

  it("F-203 LA-02: every template in templates.yaml has a template-<id> case pointing at it, with lint clean and a run check", () => {
    const yamlFile = `${REPO_ROOT}/packages/lang-2610/templates/templates.yaml`;
    const meta = parse(readFileSync(yamlFile, "utf8")) as {
      blank: { id: string };
      templates: { id: string }[];
    };
    const ids = [meta.blank.id, ...meta.templates.map((t) => t.id)];
    const { cases } = loadManifest();
    for (const id of ids) {
      const c = cases.find((x) => x.id === `template-${id}`);
      expect(c, `case template-${id}`).toBeDefined();
      expect(c?.dir).toBe(`${REPO_ROOT}/packages/lang-2610/templates/${id}`);
      expect(c?.lint?.clean).toBe(true);
      expect(c?.run?.expect).toBe("ok");
    }
  });
});
