// The undo history of one open project (F-209, AR-23): steps made of one or more accepted commands, an undo and a redo
// stack, and bounds on both. Pure data and no knowledge of Nextflow; the service decides when to record and apply.
import type { TextPatch } from "@nf-builder/lang-core";
import type { CarryHints, RenameHint } from "../layout";

export interface HistoryStatus {
  /** The label of the step an undo would take back, or null. */
  readonly undo: string | null;
  readonly redo: string | null;
  readonly undoCount: number;
  readonly redoCount: number;
}

export const EMPTY_HISTORY: HistoryStatus = {
  undo: null,
  redo: null,
  undoCount: 0,
  redoCount: 0,
};

export interface HistoryLimits {
  /** The most steps kept; a group counts as one. */
  readonly steps: number;
  /** The most UTF-16 code units of patch and inverse text kept across both stacks. */
  readonly units: number;
}

export const HISTORY_LIMITS: HistoryLimits = { steps: 100, units: 8_000_000 };

/** One accepted command: its patches and the inverse that restores the bytes before it. */
export interface StepPart {
  readonly patches: readonly TextPatch[];
  readonly inverse: readonly TextPatch[];
  /** What the command told the layout carry (F-207): the declarations it renamed and the nodes it deleted. */
  readonly renames?: readonly RenameHint[];
  readonly deleted?: readonly string[];
}

interface HistoryStep {
  readonly label: string;
  readonly parts: readonly StepPart[];
  readonly units: number;
}

/** The size of patches in UTF-16 code units: the paths, the edit texts and the created texts. */
export function patchUnits(patches: readonly TextPatch[]): number {
  let units = 0;
  for (const patch of patches) {
    units += patch.path.length;
    if (patch.kind === "create") units += patch.text.length;
    else if (patch.kind === "edit")
      for (const edit of patch.edits) units += edit.text.length;
  }
  return units;
}

/** Renames in the order made, with a chain through one name joined: A to B then B to C becomes A to C. */
function composeRenames(renames: readonly RenameHint[]): RenameHint[] {
  const out: RenameHint[] = [];
  for (const r of renames) {
    const at = out.findIndex((x) => x.path === r.path && x.to === r.from);
    const chained = out[at];
    if (chained === undefined) out.push(r);
    else if (chained.from === r.to) out.splice(at, 1);
    else out[at] = { path: r.path, from: chained.from, to: r.to };
  }
  return out;
}

export class History {
  readonly #limits: HistoryLimits;
  #undo: HistoryStep[] = [];
  #redo: HistoryStep[] = [];
  #open: string | null = null;

  constructor(limits: HistoryLimits = HISTORY_LIMITS) {
    this.#limits = limits;
  }

  /**
   * Records an accepted command. A part with no patches changes nothing, not even the open group. With a `group` equal to
   * the open one the part joins the top step; otherwise it starts a step and clears the redo stack.
   */
  record(part: StepPart, label: string, group: string | null): void {
    if (part.patches.length === 0) return;
    const units = patchUnits(part.patches) + patchUnits(part.inverse);
    const top = this.#undo[this.#undo.length - 1];
    if (group !== null && group === this.#open && top) {
      this.#undo[this.#undo.length - 1] = {
        ...top,
        parts: [...top.parts, part],
        units: top.units + units,
      };
    } else {
      this.#undo.push({ label, parts: [part], units });
      this.#redo = [];
    }
    this.#open = group;
    this.#trim();
  }

  /** The patch lists that take back the top step, newest first; null with nothing to undo. */
  undoLists(): readonly (readonly TextPatch[])[] | null {
    const top = this.#undo[this.#undo.length - 1];
    return top ? [...top.parts].reverse().map((p) => p.inverse) : null;
  }

  /** The patch lists that re-apply the top undone step, oldest first; null with nothing to redo. */
  redoLists(): readonly (readonly TextPatch[])[] | null {
    const top = this.#redo[this.#redo.length - 1];
    return top ? top.parts.map((p) => p.patches) : null;
  }

  /**
   * What an undo of the top step tells the layout carry: its renames reversed (a chain composed, so A to B then B to C
   * undoes as C to A), and, for a one-part step, the nodes its command deleted as the ones the undo restores.
   */
  undoHints(): CarryHints {
    const top = this.#undo[this.#undo.length - 1];
    if (!top) return {};
    const renames = composeRenames(top.parts.flatMap((p) => p.renames ?? []))
      .reverse()
      .map((r) => ({ path: r.path, from: r.to, to: r.from }));
    const only = top.parts.length === 1 ? top.parts[0] : undefined;
    return only?.deleted?.length
      ? { renames, inserted: only.deleted }
      : { renames };
  }

  /**
   * What a redo of the top undone step tells the layout carry: its renames (composed) and deleted nodes, oldest first.
   * The ids of nodes deleted by a later part of a group are those before that part, so they are exact only for the
   * first deleting part.
   */
  redoHints(): CarryHints {
    const top = this.#redo[this.#redo.length - 1];
    if (!top) return {};
    return {
      renames: composeRenames(top.parts.flatMap((p) => p.renames ?? [])),
      deleted: top.parts.flatMap((p) => p.deleted ?? []),
    };
  }

  /** Moves the top step to the redo stack after its undo was applied (or drops it with `discard`); returns its label. */
  undone(discard = false): string {
    const step = this.#undo.pop();
    if (!step) throw new Error("Nothing to undo");
    if (!discard) this.#redo.push(step);
    this.#open = null;
    return step.label;
  }

  /** Moves the top undone step back after its redo was applied; returns its label. */
  redone(): string {
    const step = this.#redo.pop();
    if (!step) throw new Error("Nothing to redo");
    this.#undo.push(step);
    this.#open = null;
    return step.label;
  }

  /** Closes the open group: the next command starts a new step. */
  seal(): void {
    this.#open = null;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
    this.#open = null;
  }

  status(): HistoryStatus {
    const undo = this.#undo[this.#undo.length - 1];
    const redo = this.#redo[this.#redo.length - 1];
    return {
      undo: undo?.label ?? null,
      redo: redo?.label ?? null,
      undoCount: this.#undo.length,
      redoCount: this.#redo.length,
    };
  }

  /** Drops the oldest undo steps past the limits; the newest step stays even when it alone is over the size budget. */
  #trim(): void {
    let units = 0;
    for (const s of this.#undo) units += s.units;
    for (const s of this.#redo) units += s.units;
    while (
      this.#undo.length > 1 &&
      (this.#undo.length > this.#limits.steps || units > this.#limits.units)
    ) {
      const dropped = this.#undo.shift() as HistoryStep;
      units -= dropped.units;
    }
  }
}
