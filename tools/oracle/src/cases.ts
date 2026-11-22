import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { DEFAULT_MANIFEST, REPO_ROOT } from "./paths.ts";

export type Outcome = "ok" | "error";
export type LintSpec = {
  expect: Outcome;
  errors: string[];
  /** Set only when true: any lint warning fails the case. */
  clean?: boolean;
};
export type RunSpec = {
  expect: Outcome;
  output: string[];
  script: string;
  args: string[];
  /** Set only when not empty: tools the run gets a version-printing shim for, first on PATH. */
  tools?: string[];
};
export type OracleCase = {
  id: string;
  dir: string;
  about: string;
  spec: string[];
  sources: string[];
  lint?: LintSpec;
  run?: RunSpec;
};
export type Manifest = { file: string; cases: OracleCase[] };

type Raw = Record<string, unknown>;
export const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const nonEmptyStrings = (value: unknown): value is string[] =>
  isStrings(value) && value.length > 0;

const CASE_KEYS = ["id", "dir", "about", "spec", "sources", "lint", "run"];

/**
 * Collects every problem and throws one Error listing them as "<file>: case <id>: <problem>".
 * A case's directory is `dir` (relative to the manifest, and inside repoRoot) or else the folder named like its id.
 */
export function loadManifest(
  file: string = DEFAULT_MANIFEST,
  repoRoot: string = REPO_ROOT,
): Manifest {
  const root: unknown = parse(readFileSync(file, "utf8"));
  const rawCases = isRecord(root) ? root.cases : undefined;
  if (!Array.isArray(rawCases)) {
    throw new Error(`${file}: "cases" must be a list`);
  }
  const problems: string[] = [];
  const cases: OracleCase[] = [];
  const seen = new Set<string>();
  const baseDir = dirname(file);

  rawCases.forEach((raw: unknown, index) => {
    const entry = isRecord(raw) ? raw : {};
    const id = typeof entry.id === "string" ? entry.id : `#${index + 1}`;
    const problem = (text: string): void => {
      problems.push(`${file}: case ${id}: ${text}`);
    };
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      problem("id must be kebab-case");
    }
    if (seen.has(id)) problem("duplicate id");
    seen.add(id);
    const unknownKeys = (obj: Raw, allowed: string[], prefix: string): void => {
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) problem(`unknown key "${prefix}${key}"`);
      }
    };
    unknownKeys(entry, CASE_KEYS, "");
    if (typeof entry.about !== "string" || entry.about === "") {
      problem("about must not be empty");
    }
    if (!nonEmptyStrings(entry.spec)) problem("spec must not be empty");
    if (!nonEmptyStrings(entry.sources)) problem("sources must not be empty");
    let dir = join(baseDir, id);
    if (entry.dir !== undefined) {
      if (typeof entry.dir !== "string" || entry.dir === "") {
        problem("dir must be a path");
      } else {
        dir = resolve(baseDir, entry.dir);
        const out = relative(resolve(repoRoot), dir);
        if (out === "" || out.startsWith("..") || isAbsolute(out)) {
          problem("dir must resolve inside the repository");
        }
      }
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      problem(`directory ${dir} is missing`);
    }

    const outcome = (where: string, value: unknown): Outcome => {
      if (value !== "ok" && value !== "error") {
        problem(
          `${where}.expect must be ok or error, got ${JSON.stringify(value)}`,
        );
        return "ok";
      }
      return value;
    };
    const strings = (where: string, value: unknown): string[] => {
      if (value === undefined) return [];
      if (!isStrings(value)) {
        problem(`${where} must be a list of strings`);
        return [];
      }
      return value;
    };

    let lint: LintSpec | undefined;
    if (entry.lint !== undefined) {
      const l = isRecord(entry.lint) ? entry.lint : {};
      unknownKeys(l, ["expect", "errors", "clean"], "lint.");
      lint = {
        expect: outcome("lint", l.expect),
        errors: strings("lint.errors", l.errors),
      };
      if (l.clean !== undefined) {
        if (typeof l.clean !== "boolean") {
          problem("lint.clean must be true or false");
        } else if (l.clean) {
          if (lint.expect !== "ok") problem("lint.clean needs lint.expect ok");
          lint.clean = true;
        }
      }
    }
    let run: RunSpec | undefined;
    if (entry.run !== undefined) {
      const r = isRecord(entry.run) ? entry.run : {};
      unknownKeys(r, ["expect", "output", "script", "args", "tools"], "run.");
      const script = typeof r.script === "string" ? r.script : "main.nf";
      if (existsSync(dir) && !existsSync(join(dir, script))) {
        problem(`run script ${script} is missing from ${dir}`);
      }
      run = {
        expect: outcome("run", r.expect),
        output: strings("run.output", r.output),
        script,
        args: r.args === undefined ? ["-stub"] : strings("run.args", r.args),
      };
      const tools = strings("run.tools", r.tools);
      for (const tool of tools) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tool)) {
          problem(`run.tools: "${tool}" is not a plain command name`);
        }
      }
      if (tools.length > 0) run.tools = tools;
    }
    if (!lint && !run) {
      problem("needs a lint or a run check");
    }
    cases.push({
      id,
      dir,
      about: typeof entry.about === "string" ? entry.about : "",
      spec: isStrings(entry.spec) ? entry.spec : [],
      sources: isStrings(entry.sources) ? entry.sources : [],
      ...(lint && { lint }),
      ...(run && { run }),
    });
  });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { file, cases };
}
