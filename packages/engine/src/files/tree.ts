// The Files view's rows (UX-16, F-210): pure, pack-free, built on the main thread from the worker's file list.
import type { FileSummary } from "../service/types";
import { ancestorsOf, folderOf, readOnlyReason } from "./paths";
import type { FileTreeRow, RegistryFolder } from "./types";

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** Case-insensitive natural order of names; ties fall back to code-unit order so the order is total. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Every folder that holds a file, at any depth. */
export function folderSet(
  files: readonly { readonly path: string }[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const f of files) for (const a of ancestorsOf(f.path)) out.add(a);
  return out;
}

/** A file the parser couldn't fully read: problems, or a partial or verbatim parse. Plain files never fail. */
export const failedParse = (f: FileSummary): boolean =>
  f.problems > 0 || f.status === "partial" || f.status === "verbatim";

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The visible rows: at each level files come before folders, and a collapsed folder hides what is below it. */
export function fileTreeRows(input: {
  readonly files: readonly FileSummary[];
  readonly registry: readonly RegistryFolder[];
  readonly expanded: ReadonlySet<string>;
}): readonly FileTreeRow[] {
  const { files, registry, expanded } = input;
  const folders = folderSet(files);
  const modules = new Map(registry.map((r) => [r.path, r.module]));
  const children = new Map<string, { path: string; folder: boolean }[]>();
  const add = (path: string, folder: boolean) => {
    const parent = folderOf(path);
    const list = children.get(parent) ?? [];
    list.push({ path, folder });
    children.set(parent, list);
  };
  const byPath = new Map(files.map((f) => [f.path, f]));
  // a path that is both a file and a folder (FileTree allows it) shows as both
  for (const f of files) add(f.path, false);
  for (const d of folders) add(d, true);
  const rows: FileTreeRow[] = [];
  const visit = (folder: string, level: number) => {
    const list = (children.get(folder) ?? []).sort(
      (a, b) =>
        Number(a.folder) - Number(b.folder) ||
        compareNames(nameOf(a.path), nameOf(b.path)),
    );
    list.forEach((item, i) => {
      const common = {
        path: item.path,
        name: nameOf(item.path),
        level,
        setSize: list.length,
        posInSet: i + 1,
        parent: folder === "" ? null : folder,
        readOnly: readOnlyReason(item.path),
      };
      if (item.folder) {
        const open = expanded.has(item.path);
        rows.push({
          ...common,
          kind: "folder",
          expanded: open,
          language: null,
          registry: modules.get(item.path) ?? null,
          problems: 0,
          failed: false,
        });
        if (open) visit(item.path, level + 1);
      } else {
        const file = byPath.get(item.path) as FileSummary;
        rows.push({
          ...common,
          kind: "file",
          expanded: null,
          language: file.language,
          registry: null,
          problems: file.problems,
          failed: failedParse(file),
        });
      }
    });
  };
  visit("", 1);
  return rows;
}
