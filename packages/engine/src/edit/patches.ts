// Text patches and their inverse (AR-20, AR-23, F-111). Pure functions over a path-to-text map; offsets are UTF-16 units
// into the file as it was before the patch. Nothing here knows Nextflow.
import type { TextEdit, TextPatch } from "@nf-builder/lang-core";

/** A patch list that cannot be applied: a programming error in a command, never a user refusal. */
export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/**
 * Apply patches to a copy of `files` and return the result with the inverse patches. Applying the inverse to the result
 * restores the exact previous bytes and paths. A list holds at most one patch per path. Throws `PatchError` for edits
 * that overlap, are unsorted or out of range, a path patched twice, an edit or delete of a missing file and a create of
 * an existing one.
 */
export function applyPatches(
  files: ReadonlyMap<string, string>,
  patches: readonly TextPatch[],
): { files: Map<string, string>; inverse: TextPatch[] } {
  const out = new Map(files);
  const inverse: TextPatch[] = [];
  const seen = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.path))
      throw new PatchError(`Two patches for ${patch.path}`);
    seen.add(patch.path);
    const current = files.get(patch.path);
    switch (patch.kind) {
      case "create":
        if (current !== undefined)
          throw new PatchError(`Cannot create ${patch.path}: it exists`);
        out.set(patch.path, patch.text);
        inverse.push({ kind: "delete", path: patch.path });
        break;
      case "delete":
        if (current === undefined)
          throw new PatchError(`Cannot delete ${patch.path}: it is missing`);
        out.delete(patch.path);
        inverse.push({ kind: "create", path: patch.path, text: current });
        break;
      case "edit": {
        if (current === undefined)
          throw new PatchError(`Cannot edit ${patch.path}: it is missing`);
        const applied = applyEdits(patch.path, current, patch.edits);
        out.set(patch.path, applied.text);
        inverse.push({
          kind: "edit",
          path: patch.path,
          edits: applied.inverse,
        });
        break;
      }
    }
  }
  return { files: out, inverse };
}

function applyEdits(
  path: string,
  text: string,
  edits: readonly TextEdit[],
): { text: string; inverse: TextEdit[] } {
  let result = "";
  let cursor = 0;
  let delta = 0;
  const inverse: TextEdit[] = [];
  for (const edit of edits) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < cursor ||
      edit.end < edit.start ||
      edit.end > text.length
    )
      throw new PatchError(
        `Edit ${edit.start}-${edit.end} in ${path} overlaps, is unsorted or is out of range (length ${text.length})`,
      );
    result += text.slice(cursor, edit.start) + edit.text;
    const start = edit.start + delta;
    inverse.push({
      start,
      end: start + edit.text.length,
      text: text.slice(edit.start, edit.end),
    });
    delta += edit.text.length - (edit.end - edit.start);
    cursor = edit.end;
  }
  return { text: result + text.slice(cursor), inverse };
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** The one edit that turns `before` into `after`, trimmed to the changed text and never splitting a surrogate pair; null when equal. */
export function diffText(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix))
    prefix += 1;
  if (prefix > 0 && isHigh(before.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) ===
      after.charCodeAt(after.length - 1 - suffix)
  )
    suffix += 1;
  if (suffix > 0 && isLow(before.charCodeAt(before.length - suffix)))
    suffix -= 1;
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}
