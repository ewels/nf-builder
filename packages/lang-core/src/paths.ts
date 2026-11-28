/** The longest project path, in characters (QA-32). */
export const PATH_MAX = 1024;

/**
 * Why a project-relative path is unsafe, or null when it is fine (QA-32, F-210).
 * Shared by zip import, uploads and the New file dialog.
 */
export function projectPathProblem(path: string): string | null {
  if (path === "") return "empty path";
  if (path.length > PATH_MAX) return "path too long";
  if (path.startsWith("/")) return "absolute path";
  if (/^[A-Za-z]:/.test(path)) return "drive letter";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return "control character";
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..")
      return `${segment || "empty"} segment`;
    if (segment === "__proto__") return "reserved segment";
  }
  return null;
}

export interface PathClashes {
  /** Groups of two or more paths that differ only by letter case, each group sorted. */
  readonly caseOnly: readonly (readonly string[])[];
  /** Paths that are both a file and the folder of another path. */
  readonly fileAndFolder: readonly string[];
}

/** Paths that clash when unzipped on a case-insensitive file system or that are both file and folder (F-404, ADR 0055). */
export function exportClashes(paths: readonly string[]): PathClashes {
  const byLower = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const group = byLower.get(key);
    if (group) group.push(path);
    else byLower.set(key, [path]);
  }
  const caseOnly = [...byLower.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.toSorted())
    .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      folders.add(parts.slice(0, i).join("/"));
  }
  const fileAndFolder = paths.filter((p) => folders.has(p)).toSorted();
  return { caseOnly, fileAndFolder };
}
