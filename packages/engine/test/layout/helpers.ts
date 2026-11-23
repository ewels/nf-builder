// Shared by the carry tests: the fixture, projections before and after a command, and the carry step the service runs.
import { join } from "node:path";
import type {
  CommandResult,
  EditCommand,
  Projection,
  TextPatch,
  WorkflowRef,
} from "@nf-builder/lang-core";
import {
  applyCommand,
  commit,
  type EditState,
  patchResult,
} from "../../src/edit/apply";
import {
  carryLayout,
  type LayoutDocument,
  type RemovedPositions,
  type RenameHint,
  renameHints,
  type WorkflowPair,
  workflowKey,
  workflowPairs,
} from "../../src/layout";
import { createProjector } from "../../src/projection/project";
import { stateFor } from "../edit/helpers";
import { readTree } from "../model/read-tree";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;

export const entry = { path: "main.nf", workflow: null };

export async function fixtureState(
  name = "f111-start-typed",
  extra: Record<string, string> = {},
): Promise<EditState> {
  const files = Object.fromEntries(
    readTree(join(cases, name)).map((f) => [f.path, f.text]),
  );
  return stateFor({ ...files, ...extra });
}

export interface Snapshot {
  readonly workflows: readonly WorkflowRef[];
  readonly projections: ReadonlyMap<string, Projection>;
}

export function snapshot(state: EditState): Snapshot {
  const projector = createProjector(state.model, state.catalogue);
  const workflows = projector.workflows();
  const projections = new Map<string, Projection>();
  for (const w of workflows) {
    const p = w.modelled ? projector.project(w.path, w.name) : null;
    if (p) projections.set(workflowKey(w), p);
  }
  return { workflows, projections };
}

/** A document with a distinct position for every node of every workflow. */
export function seedLayout(snap: Snapshot): LayoutDocument {
  const nodes: Record<string, { x: number; y: number }> = {};
  let i = 0;
  for (const p of snap.projections.values())
    for (const n of p.nodes) {
      nodes[n.id] = { x: 100 + i * 7, y: 50 + i * 13 };
      i += 1;
    }
  return { version: 1, nodes };
}

export interface Stepped {
  readonly doc: LayoutDocument;
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly pairs: readonly WorkflowPair[];
  /** The patches that undo the change. */
  readonly inverse: readonly TextPatch[];
}

type Accepted = Extract<CommandResult, { ok: true }>;

/** Commits an accepted result, then carries `doc` across it as the service does. */
function carried(
  state: EditState,
  doc: LayoutDocument,
  result: Accepted,
  renames: readonly RenameHint[],
  removed?: RemovedPositions,
): Stepped {
  const before = snapshot(state);
  commit(state, result);
  const after = snapshot(state);
  const pairs = workflowPairs(
    before,
    after.workflows,
    (w) => after.projections.get(workflowKey(w)) ?? null,
    new Set(result.files.map((f) => f.path)),
    renames,
  );
  return {
    doc: carryLayout(doc, pairs, renames, removed),
    before,
    after,
    pairs,
    inverse: result.inverse,
  };
}

/** Applies `patches` (an undo) and carries `doc` across them. */
export function stepPatches(
  state: EditState,
  doc: LayoutDocument,
  patches: readonly TextPatch[],
  removed?: RemovedPositions,
): Stepped {
  return carried(state, doc, patchResult(state.model, patches), [], removed);
}

/** Applies and commits `command`, then carries `doc` across it as the service does. */
export function step(
  state: EditState,
  doc: LayoutDocument,
  command: EditCommand,
  removed?: RemovedPositions,
): Stepped {
  const result = applyCommand(state, command);
  if (!result.ok) throw new Error(`refused: ${result.code}: ${result.message}`);
  return carried(state, doc, result, renameHints(command), removed);
}
