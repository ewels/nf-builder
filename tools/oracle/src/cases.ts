import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { DEFAULT_MANIFEST } from "./paths.ts";

export type Outcome = "ok" | "error";
export type LintSpec = { expect: Outcome; errors: string[] };
export type RunSpec = {
  expect: Outcome;
  output: string[];
  script: string;
  args: string[];
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

const CASE_KEYS = ["id", "about", "spec", "sources", "lint", "run"];

/** Collects every problem and throws one Error listing them as "<file>: case <id>: <problem>". */
export function loadManifest(file: string = DEFAULT_MANIFEST): Manifest {
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
    const dir = join(baseDir, id);
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
      unknownKeys(l, ["expect", "errors"], "lint.");
      lint = {
        expect: outcome("lint", l.expect),
        errors: strings("lint.errors", l.errors),
      };
    }
    let run: RunSpec | undefined;
    if (entry.run !== undefined) {
      const r = isRecord(entry.run) ? entry.run : {};
      unknownKeys(r, ["expect", "output", "script", "args"], "run.");
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
