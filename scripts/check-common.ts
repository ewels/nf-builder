// Shared by the repository checkers (ADR lint, features.json validation, the budget and host scans).
// Checker scripts import only `node:` built-ins and sibling scripts, because the `adr-lint` and `features`
// CI jobs run them without `pnpm install`.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
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

/** "docs/adr/0015-x.md:3:7: message"; the file is made repo-relative, ":line" and ":column" appear only when known. */
function formatProblem(problem: Problem): string {
  if (problem.file === undefined) return problem.message;
  const line = problem.line === undefined ? "" : `:${problem.line}`;
  const column =
    problem.line === undefined || problem.column === undefined
      ? ""
      : `:${problem.column}`;
  return `${repoRelative(problem.file)}${line}${column}: ${problem.message}`;
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

/** True when the build output directory exists; otherwise prints how to fix that. */
export function distExists(dist: string): boolean {
  if (existsSync(dist) && statSync(dist).isDirectory()) return true;
  console.error(`${repoRelative(dist)} not found: run pnpm build first`);
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

/**
 * "26.10" -> <repo>/packages/lang-2610, for the language packs that have `marker` (a path inside the pack).
 * A version without such a pack throws "No language pack with a <what> for version ...", listing the packs there are.
 */
export function packFor(
  version: string,
  marker: string,
  what: string,
  repoRoot: string = REPO_ROOT,
): string {
  const match = /^(\d+)\.(\d+)$/.exec(version);
  const name = match ? `lang-${match[1]}${match[2]}` : undefined;
  const dir = join(repoRoot, "packages");
  const packs = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => existsSync(join(dir, n, marker)))
        .sort()
    : [];
  if (name === undefined || !packs.includes(name)) {
    const known = packs.map((p) => p.replace(/^lang-(\d+)(\d{2})$/, "$1.$2"));
    throw new Error(
      `No language pack with a ${what} for version "${version}". Packs with one: ${known.join(", ") || "none"}.`,
    );
  }
  return join(dir, name);
}
