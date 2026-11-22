import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isRecord, type Outcome } from "./cases.ts";
import { type Evaluation, parseLintJson } from "./check.ts";
import type { Exec } from "./nextflow.ts";
import { type CheckResult, LINT_COMMAND } from "./run.ts";

/** An error as `nextflow lint` prints it, as a manifest records it. */
export type Located = { line: number; column: number; message: string };
/** A directory of Nextflow files linted in one run, and the lint errors each file must produce (`[]` for none). */
export type TreeManifest = {
  name: string;
  dir: string;
  files: { file: string; lint: Located[] }[];
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
    const located: Located[] = [];
    for (const e of lint) {
      const r = isRecord(e) ? e : {};
      if (
        typeof r.line !== "number" ||
        typeof r.column !== "number" ||
        typeof r.message !== "string"
      )
        problems.push(
          `${file}: ${path}: a lint entry needs line, column, message`,
        );
      else located.push({ line: r.line, column: r.column, message: r.message });
    }
    files.push({
      file: path.startsWith(`${folder}/`)
        ? path.slice(folder.length + 1)
        : path,
      lint: located,
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

const show = (errors: readonly Located[]): string =>
  errors.length === 0
    ? "no errors"
    : errors.map((e) => `${e.line}:${e.column} ${e.message}`).join(" | ");

/**
 * Copies the tree (keeping relative paths: includes and `modules/nf-core/` resolve against them), runs `nextflow lint -o
 * json .` once, and returns one row per manifest file: `<name>:<file>`, matched when lint's errors for that file equal
 * the recorded list. A file lint reports errors for that the manifest does not list is a row of its own.
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
  const byFile = new Map<string, Located[]>();
  for (const e of report?.errors ?? [])
    byFile.set(e.filename ?? "?", [
      ...(byFile.get(e.filename ?? "?") ?? []),
      {
        line: e.startLine ?? 0,
        column: e.startColumn ?? 0,
        message: e.message,
      },
    ]);

  const row = (file: string, expected: Located[]): CheckResult => {
    const actual = byFile.get(file) ?? [];
    const problems: string[] = [];
    if (report === null) problems.push("no JSON report in the lint output");
    else if (show(actual) !== show(expected))
      problems.push(
        `${file}: expected ${show(expected)}; lint reported ${show(actual)}`,
      );
    const outcome = (list: Located[]): Outcome =>
      list.length > 0 ? "error" : "ok";
    const evaluation: Evaluation = {
      actual: outcome(actual),
      matched: problems.length === 0,
      problems,
      errors: actual.map((e) => e.message),
      warnings: [],
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
    ...manifest.files.map((f) => row(f.file, f.lint)),
    ...[...byFile.keys()].filter((f) => !listed.has(f)).map((f) => row(f, [])),
  ];
}
