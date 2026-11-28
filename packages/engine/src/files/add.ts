// Planning an upload or drop into a folder (UX-16, F-210). Pure.
import type { ProjectTree } from "@nf-builder/lang-core";
import { ancestorsOf, isManagedPath, joinFolder } from "./paths";
import type { AddConflict, AddPlan } from "./types";

/**
 * Where each path lands under `folder`, which existing files it replaces, and which it skips: anything managed by
 * nf-builder (`.nf-builder/`), a target where a folder is, and a target below a file, existing or added earlier.
 */
export function planAdd(input: {
  readonly paths: readonly string[];
  readonly folder: string;
  readonly tree: ProjectTree;
}): AddPlan {
  const { paths, folder, tree } = input;
  const writes: { from: string; to: string }[] = [];
  const replaced: string[] = [];
  const conflicts: AddConflict[] = [];
  const addedFiles = new Set<string>();
  const addedFolders = new Set<string>();
  for (const from of paths) {
    const to = joinFolder(folder, from);
    if (isManagedPath(from) || isManagedPath(to)) {
      conflicts.push({ path: to, reason: "managed" });
      continue;
    }
    const ancestors = ancestorsOf(to);
    const blocker = ancestors.find((a) => tree.isFile(a) || addedFiles.has(a));
    if (blocker !== undefined) {
      conflicts.push({ path: to, reason: "under-file", ancestor: blocker });
      continue;
    }
    if (tree.isDirectory(to) || addedFolders.has(to)) {
      conflicts.push({ path: to, reason: "folder" });
      continue;
    }
    writes.push({ from, to });
    addedFiles.add(to);
    for (const a of ancestors) addedFolders.add(a);
    if (tree.isFile(to)) replaced.push(to);
  }
  return { writes, replaced, conflicts };
}
