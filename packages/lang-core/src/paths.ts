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
