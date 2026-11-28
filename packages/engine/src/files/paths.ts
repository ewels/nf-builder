// Path rules and helpers for the Files view and the CreateFile command (UX-16, F-210). Pure.
import { type ProjectTree, projectPathProblem } from "@nf-builder/lang-core";
import { FileTree } from "../model/tree";
import type { ReadOnlyReason } from "./types";

/** The folder nf-builder writes itself (the layout sidecar, F-207). */
export const MANAGED_DIR = ".nf-builder";

export const isManagedPath = (path: string): boolean =>
  path === MANAGED_DIR || path.startsWith(`${MANAGED_DIR}/`);

export const readOnlyReason = (path: string): ReadOnlyReason | null =>
  isManagedPath(path) ? "managed" : null;

/** A tree over `paths`, for the checks below. */
export const projectTreeOf = (paths: Iterable<string>): ProjectTree =>
  new FileTree(paths);

/** The folder holding `path`: "" for a top-level file. */
export const folderOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/** The folders above `path`, outermost first: "a/b/c.nf" gives "a", "a/b". */
export function ancestorsOf(path: string): readonly string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** `name` inside `folder` ("" is the project root). */
export const joinFolder = (folder: string, name: string): string =>
  folder === "" ? name : `${folder}/${name}`;

/** Why `path` can't be a new file or folder, in words for the dialog; null when it can. */
export function newPathProblem(path: string, tree: ProjectTree): string | null {
  const problem = projectPathProblem(path);
  if (problem !== null) return `"${path}" isn't a valid path (${problem}).`;
  if (isManagedPath(path))
    return `nf-builder keeps ${MANAGED_DIR}/ up to date itself. Choose another folder.`;
  for (const ancestor of ancestorsOf(path))
    if (tree.isFile(ancestor))
      return `${ancestor} is a file, so it can't hold ${path.slice(ancestor.length + 1)}.`;
  if (tree.isFile(path)) return `${path} already exists.`;
  if (tree.isDirectory(path))
    return `There is already a folder called ${path}.`;
  return null;
}

/** As `newPathProblem` for a folder; a trailing `/` is ignored. */
export function newFolderProblem(
  folder: string,
  tree: ProjectTree,
): string | null {
  return newPathProblem(
    folder.endsWith("/") ? folder.slice(0, -1) : folder,
    tree,
  );
}
