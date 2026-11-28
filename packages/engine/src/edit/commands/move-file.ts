// MoveFile (F-303, LA-12): a file, or every file under a folder, gets a new path. The include sources that named a moved
// script are rewritten in the includers and in the moved scripts, so the project resolves exactly as before. The inverse
// is the delete and create patches of the move, so an undo restores paths and bytes.
import type { MoveFile, TextEdit, TextPatch } from "@nf-builder/lang-core";
import { isManagedPath, newPathProblem } from "../../files/paths";
import type { EditState } from "../apply";
import { relativeSource } from "../names";
import { EditRefusal } from "../refusal";

const MANAGED = "nf-builder keeps .nf-builder/ up to date itself.";

/** The source literal's replacement, keeping the quote the file used. */
const literal = (written: string, source: string): string => {
  const quote = written.startsWith('"') ? '"' : "'";
  return `${quote}${source}${quote}`;
};

export function moveFile(state: EditState, command: MoveFile): TextPatch[] {
  const { path, newPath } = command;
  const { model } = state;
  const paths = model.paths();
  const moved = paths.includes(path)
    ? [path]
    : paths.filter((p) => p.startsWith(`${path}/`));
  if (moved.length === 0)
    throw new EditRefusal(
      "not-found",
      `There is no file or folder ${path}.`,
      path,
    );
  if (newPath === path)
    throw new EditRefusal("invalid", `${path} is already there.`, path);
  if (newPath.startsWith(`${path}/`))
    throw new EditRefusal("invalid", `${path} can't move into itself.`, path);
  if (isManagedPath(path) || isManagedPath(newPath))
    throw new EditRefusal("invalid", `${MANAGED} Choose another path.`, path);
  const target = (p: string): string =>
    p === path ? newPath : `${newPath}${p.slice(path.length)}`;
  for (const p of moved) {
    const problem = newPathProblem(target(p), model.tree);
    if (problem !== null) throw new EditRefusal("invalid", problem, target(p));
  }
  const movedSet = new Set(moved);
  const mapped = (p: string): string => (movedSet.has(p) ? target(p) : p);

  // the edits to include sources, by file as it is now
  const edits = new Map<string, TextEdit[]>();
  const rewrite = (from: string, file: string): void => {
    const model_ = model.file(file);
    if (model_?.source.language !== "nextflow") return;
    for (const include of model_.includes) {
      if (include.kind !== "script" || include.target.kind !== "file") continue;
      const to = include.target.path;
      const touched = movedSet.has(from) || movedSet.has(to);
      if (!touched) continue;
      const before = relativeSource(from, to);
      const after = relativeSource(mapped(from), mapped(to));
      if (before === after) continue;
      const { range, text } = include.node.source;
      const list = edits.get(file) ?? [];
      list.push({
        start: range.start,
        end: range.end,
        text: literal(text, after),
      });
      edits.set(file, list);
    }
  };
  for (const p of moved) rewrite(p, p);
  for (const p of moved)
    for (const dependant of model.dependants(p))
      if (!movedSet.has(dependant)) rewrite(dependant, dependant);

  const patches: TextPatch[] = [];
  const unmoved = new Map<string, TextEdit[]>();
  for (const [file, list] of edits) {
    const sorted = list
      .filter((e, i, all) => all.findIndex((o) => o.start === e.start) === i)
      .sort((a, b) => a.start - b.start);
    if (movedSet.has(file)) unmoved.set(file, sorted);
    else patches.push({ kind: "edit", path: file, edits: sorted });
  }
  for (const p of moved) {
    let text = model.file(p)?.source.text ?? "";
    for (const e of [...(unmoved.get(p) ?? [])].reverse())
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
    patches.push({ kind: "delete", path: p });
    patches.push({ kind: "create", path: target(p), text });
  }
  return patches;
}
