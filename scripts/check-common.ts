// Shared by the repository checkers (ADR lint, features.json validation, and later the budget and host scans).
// Imports only node: built-ins, so CI jobs can run the checkers without `pnpm install`.
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type Problem = {
  file?: string;
  line?: number;
  column?: number;
  message: string;
};

export const REPO_ROOT: string = fileURLToPath(new URL("..", import.meta.url));
export const WEB_DIST: string = join(REPO_ROOT, "apps/web/dist");

function repoRelative(file: string): string {
  return file.startsWith(REPO_ROOT)
    ? relative(REPO_ROOT, file).split("\\").join("/")
    : file;
}

/** "docs/adr/0015-x.md:3: message"; the file is made repo-relative, ":line" appears only when known. */
export function formatProblem(problem: Problem): string {
  if (problem.file === undefined) return problem.message;
  const line = problem.line === undefined ? "" : `:${problem.line}`;
  return `${repoRelative(problem.file)}${line}: ${problem.message}`;
}

const escapeData = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** A GitHub Actions workflow command, so the problem shows inline on the pull request. */
export function githubAnnotation(problem: Problem, title: string): string {
  const properties: string[] = [];
  if (problem.file !== undefined)
    properties.push(`file=${escapeProperty(repoRelative(problem.file))}`);
  if (problem.line !== undefined) properties.push(`line=${problem.line}`);
  if (problem.column !== undefined) properties.push(`col=${problem.column}`);
  properties.push(`title=${escapeProperty(title)}`);
  return `::error ${properties.join(",")}::${escapeData(problem.message)}`;
}

/** Prints the problems (and annotations under GitHub Actions). Returns true when there are none. */
export function reportProblems(
  title: string,
  problems: readonly Problem[],
  options: {
    env?: Record<string, string | undefined>;
    write?: (line: string) => void;
  } = {},
): boolean {
  const env = options.env ?? process.env;
  const write = options.write ?? ((line: string) => console.log(line));
  if (problems.length === 0) return true;
  write(`${title}: ${problems.length} problem(s)`);
  for (const problem of problems) write(formatProblem(problem));
  if (env.GITHUB_ACTIONS === "true")
    for (const problem of problems) write(githubAnnotation(problem, title));
  return false;
}

/** True when this module is the script node was started with. */
export function isMain(meta: ImportMeta): boolean {
  try {
    return meta.filename === realpathSync(process.argv[1] ?? "");
  } catch {
    return false;
  }
}
