import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isRecord, type Outcome } from "./cases.ts";
import { type Evaluation, type LintMessage, parseLintJson } from "./check.ts";
import type { Exec } from "./nextflow.ts";
import { type CheckResult, LINT_COMMAND } from "./run.ts";

/** An error or warning as `nextflow lint` prints it, as a manifest records it. */
export type Located = { line: number; column: number; message: string };
/**
 * A directory of Nextflow files linted in one run, and the lint errors each file must produce (`[]` for none). `warnings`,
 * when recorded, is the exact list of warnings the file must produce; a file without it has its warnings ignored.
 */
export type TreeManifest = {
  name: string;
  dir: string;
  files: { file: string; lint: Located[]; warnings?: Located[] }[];
};

/**
 * Reads a pack manifest with a `fixtures` or `cases` list whose entries have `file` and `lint` (the recorded errors).
 * The files live in the directory beside the manifest that is named like it (`errors.json` and `errors/`); an entry's
 * `file` may include that prefix. `name` labels the rows. Throws one Error listing every problem.
 */
export function loadTreeManifest(file: string, name: string): TreeManifest {
  const root: unknown = JSON.parse(readFileSync(file, "utf8"));
  const list = isRecord(root) ? (root.fixtures ?? root.cases) : undefined;
  if (!Array.isArray(list))
    throw new Error(`${file}: "fixtures" or "cases" must be a list`);
  const folder = basename(file, ".json");
  const problems: string[] = [];
  const files: TreeManifest["files"] = [];
  for (const entry of list) {
    const raw = isRecord(entry) ? entry : {};
    const path = typeof raw.file === "string" ? raw.file : "";
    const lint = raw.lint;
    if (path === "" || !Array.isArray(lint)) {
      problems.push(`${file}: ${path || "?"}: needs a file and a lint list`);
      continue;
    }
    const parse = (list: unknown[], what: string): Located[] => {
      const located: Located[] = [];
      for (const e of list) {
        const r = isRecord(e) ? e : {};
        if (
          typeof r.line !== "number" ||
          typeof r.column !== "number" ||
          typeof r.message !== "string"
        )
          problems.push(
            `${file}: ${path}: a ${what} entry needs line, column, message`,
          );
        else
          located.push({ line: r.line, column: r.column, message: r.message });
      }
      return located;
    };
    const located = parse(lint, "lint");
    if (raw.warnings !== undefined && !Array.isArray(raw.warnings)) {
      problems.push(`${file}: ${path}: warnings must be a list`);
      continue;
    }
    const warnings = raw.warnings && parse(raw.warnings, "warnings");
    files.push({
      file: path.startsWith(`${folder}/`)
        ? path.slice(folder.length + 1)
        : path,
      lint: located,
      ...(warnings ? { warnings } : {}),
    });
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return { name, dir: join(dirname(file), folder), files };
}

export type TreeRunOptions = {
  exec: Exec;
  /** The oracle cache (`.cache/oracle`); the tree is copied to `<cacheDir>/trees/<name>/`. */
  cacheDir: string;
  log?: (line: string) => void;
};

const show = (list: readonly Located[], none = "no errors"): string =>
  list.length === 0
    ? none
    : list.map((e) => `${e.line}:${e.column} ${e.message}`).join(" | ");
const showWarnings = (list: readonly Located[]) => show(list, "no warnings");

/**
 * Copies the tree (keeping relative paths: includes and `modules/nf-core/` resolve against them), runs `nextflow lint -o
 * json .` once, and returns one row per manifest file: `<name>:<file>`, matched when lint's errors for that file equal
 * the recorded list, and, for a file with recorded warnings, its warnings equal them. A file lint reports errors for that
 * the manifest does not list is a row of its own. Lint prints absolute paths in some messages; `<tree dir>/` is stripped.
 */
export function runTree(
  manifest: TreeManifest,
  options: TreeRunOptions,
): CheckResult[] {
  const { exec, cacheDir, log = () => {} } = options;
  const dir = join(cacheDir, "trees", manifest.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(manifest.dir, dir, { recursive: true });
  log(`tree:${manifest.name}: nextflow ${LINT_COMMAND.join(" ")}`);
  const result = exec(LINT_COMMAND, dir);
  const logFile = join(dir, "lint.log");
  writeFileSync(
    logFile,
    [
      `$ nextflow ${LINT_COMMAND.join(" ")}`,
      `exit: ${result.status ?? `signal ${result.signal}`}`,
      `duration: ${result.durationMs} ms`,
      "--- stdout ---",
      result.stdout,
      "--- stderr ---",
      result.stderr,
      "",
    ].join("\n"),
  );
  const report = parseLintJson(result.stdout);
  const group = (list: readonly LintMessage[]): Map<string, Located[]> => {
    const map = new Map<string, Located[]>();
    for (const e of list)
      map.set(e.filename ?? "?", [
        ...(map.get(e.filename ?? "?") ?? []),
        {
          line: e.startLine ?? 0,
          column: e.startColumn ?? 0,
          message: e.message.replaceAll(`${dir}/`, ""),
        },
      ]);
    return map;
  };
  const byFile = group(report?.errors ?? []);
  const warningsByFile = group(report?.warnings ?? []);

  const row = (
    file: string,
    expected: Located[],
    expectedWarnings?: Located[],
  ): CheckResult => {
    const actual = byFile.get(file) ?? [];
    const actualWarnings = warningsByFile.get(file) ?? [];
    const problems: string[] = [];
    if (report === null) problems.push("no JSON report in the lint output");
    else if (show(actual) !== show(expected))
      problems.push(
        `${file}: expected ${show(expected)}; lint reported ${show(actual)}`,
      );
    if (
      report !== null &&
      expectedWarnings !== undefined &&
      showWarnings(actualWarnings) !== showWarnings(expectedWarnings)
    )
      problems.push(
        `${file}: expected warnings ${showWarnings(expectedWarnings)}; lint reported ${showWarnings(actualWarnings)}`,
      );
    const outcome = (list: Located[]): Outcome =>
      list.length > 0 ? "error" : "ok";
    const evaluation: Evaluation = {
      actual: outcome(actual),
      matched: problems.length === 0,
      problems,
      errors: actual.map((e) => e.message),
      warnings: actualWarnings.map((e) => e.message),
    };
    return {
      ...evaluation,
      caseId: `${manifest.name}:${file}`,
      kind: "lint",
      command: LINT_COMMAND,
      expected: outcome(expected),
      exitCode: result.status,
      durationMs: result.durationMs,
      logFile,
    };
  };

  const listed = new Set(manifest.files.map((f) => f.file));
  return [
    ...manifest.files.map((f) => row(f.file, f.lint, f.warnings)),
    ...[...byFile.keys()].filter((f) => !listed.has(f)).map((f) => row(f, [])),
  ];
}
