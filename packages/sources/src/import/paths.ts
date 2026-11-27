import { projectPathProblem } from "@nf-builder/lang-core";

export type EntryPath =
  | { readonly kind: "file" | "folder"; readonly path: string }
  | {
      readonly kind: "unsafe";
      readonly path: string;
      readonly problem: string;
    };

export function entryPath(raw: string): EntryPath {
  const slashed = raw.replaceAll("\\", "/");
  const folder = slashed.endsWith("/");
  const path = folder ? slashed.slice(0, -1) : slashed;
  const problem = projectPathProblem(path);
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
