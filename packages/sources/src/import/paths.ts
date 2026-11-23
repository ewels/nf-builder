export type EntryPath =
  | { readonly kind: "file" | "folder"; readonly path: string }
  | {
      readonly kind: "unsafe";
      readonly path: string;
      readonly problem: string;
    };

const MAX_PATH = 1024;

function problemWith(path: string): string | null {
  if (path === "") return "empty path";
  if (path.length > MAX_PATH) return "path too long";
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

export function entryPath(raw: string): EntryPath {
  const slashed = raw.replaceAll("\\", "/");
  const folder = slashed.endsWith("/");
  const path = folder ? slashed.slice(0, -1) : slashed;
  const problem = problemWith(path);
  if (problem !== null) return { kind: "unsafe", path: raw, problem };
  return { kind: folder ? "folder" : "file", path };
}

const firstSegment = (path: string): string => path.split("/", 1)[0] ?? "";

/** The one top-level folder every entry (outside `__MACOSX/`) lies under, or null. */
export function topFolder(entries: readonly EntryPath[]): string | null {
  let top: string | null = null;
  let files = 0;
  for (const entry of entries) {
    if (entry.kind === "unsafe") continue;
    const first = firstSegment(entry.path);
    if (first === "__MACOSX") continue;
    if (top === null) top = first;
    else if (top !== first) return null;
    if (entry.kind === "file") {
      if (entry.path === first) return null;
      files += 1;
    }
  }
  return files > 0 ? top : null;
}

export function stripFolder(path: string, folder: string | null): string {
  return folder !== null && path.startsWith(`${folder}/`)
    ? path.slice(folder.length + 1)
    : path;
}
