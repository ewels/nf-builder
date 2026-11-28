// Carrying layout keys across a change (ADR 0008, ADR 0036, F-207). A key changes when a node's variable, callee or
// order among same-callee nodes changes, and node offsets can't be mapped through a workflow reprint, so the nodes of the
// projection before a change are matched with those after it. Pure and deterministic.

import type {
  EditCommand,
  GraphNode,
  Projection,
  WorkflowRef,
} from "@nf-builder/lang-core";
import { parseNodeKey } from "../projection/keys";
import { workflowPositions } from "./sidecar";
import type { LayoutDocument, Point, Positions } from "./types";

/** A declaration renamed from `from` to `to` in the file `path` (a `renameDeclaration` command). */
export interface RenameHint {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

/** A file, or every file under a folder, moved from `from` to `to` (a `moveFile` command). */
export interface MoveHint {
  readonly from: string;
  readonly to: string;
}

/** What a command tells the carry about the change it makes; each part is optional. */
export interface CarryHints {
  /** Declarations the command renamed. */
  readonly renames?: readonly RenameHint[];
  /** Files or folders the command moved: the workflows in them keep their positions under the new path (F-303). */
  readonly moves?: readonly MoveHint[];
  /** Ids of nodes before the change that the command deleted: they never match a node after it. */
  readonly deleted?: readonly string[];
  /** Ids of nodes after the change that an undo restored: they never match a node before it, and take back a remembered position. */
  readonly inserted?: readonly string[];
}

const NONE = "\u0000";

function nodeName(node: GraphNode): string {
  switch (node.kind) {
    case "call":
      return node.callee.name;
    case "chain":
      return node.steps.map((s) => s.operator).join(".");
    case "factory":
      return `${node.namespace}.${node.factory}`;
    case "take":
    case "emit":
      return node.name;
    case "code":
      return node.text;
    default:
      return "";
  }
}

function assignedVariable(node: GraphNode): string {
  const local = parseNodeKey(node.id)?.local;
  return local?.kind === "assigned" ? local.variable : "";
}

/** What describes a node apart from its position: kind, name, assigned variable and the variables it reads. */
function describe(
  projection: Projection,
  rename: (node: GraphNode) => string,
): { node: GraphNode; strong: string; name: string; kind: string }[] {
  const reads = new Map<string, string[]>();
  for (const e of projection.edges) {
    if (e.variable === null) continue;
    const list = reads.get(e.to.node);
    if (list) list.push(e.variable);
    else reads.set(e.to.node, [e.variable]);
  }
  return projection.nodes.map((node) => {
    const name = rename(node);
    const kind = node.kind;
    const read = (reads.get(node.id) ?? []).sort().join(",");
    return {
      node,
      kind,
      name: [kind, name].join(NONE),
      strong: [kind, nodeName(node), assignedVariable(node), read].join(NONE),
    };
  });
}

/** Longest common subsequence of two lists of strings, as index pairs. Ties prefer earlier pairs. */
function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] as number) + 1
          : Math.max(
              table[(i + 1) * width + j] as number,
              table[i * width + j + 1] as number,
            );
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] as number) >=
      (table[i * width + j + 1] as number)
    )
      i++;
    else j++;
  }
  return pairs;
}

/**
 * `ids` and, transitively, every unassigned node that has outgoing edges all leading to nodes in the set: a command that
 * deletes (or an undo that restores) a call also removes (restores) the nodes nested in its statement.
 */
function withNested(
  projection: Projection,
  ids: readonly string[] | undefined,
): Set<string> {
  const set = new Set(ids);
  if (set.size === 0) return set;
  const targets = new Map<string, string[]>();
  for (const e of projection.edges) {
    const list = targets.get(e.from.node);
    if (list) list.push(e.to.node);
    else targets.set(e.from.node, [e.to.node]);
  }
  const nested = projection.nodes.filter(
    (n) => parseNodeKey(n.id)?.local.kind === "unassigned",
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of nested) {
      const out = targets.get(n.id);
      if (set.has(n.id) || !out || !out.every((t) => set.has(t))) continue;
      set.add(n.id);
      grew = true;
    }
  }
  return set;
}

/**
 * Pairs the nodes of `before` with those of `after`: old id to new id. Each pass works on the nodes still unmatched, in
 * projection order. Passes: (1) a unique strong signature (kind, name, assigned variable, variables read); (2) the longest
 * common subsequence of strong signatures; (3) a unique name, with `renames` applied to the old callees; (4) the longest
 * common subsequence of names; (5) the longest common subsequence of kinds. A pair always has the same kind. A node the
 * hints say was deleted (before) or restored (after) takes part in no pass.
 */
export function matchNodes(
  before: Projection,
  after: Projection,
  hints: CarryHints = {},
): ReadonlyMap<string, string> {
  const renames = hints.renames ?? [];
  const renamed = (node: GraphNode): string => {
    if (node.kind === "call") {
      const hint = renames.find(
        (h) => h.path === node.callee.path && h.from === node.callee.name,
      );
      if (hint) return hint.to;
    }
    return nodeName(node);
  };
  const old = describe(before, renamed);
  const next = describe(after, nodeName);
  const deleted = withNested(before, hints.deleted);
  const inserted = withNested(after, hints.inserted);
  const oldLeft = new Set(
    old.flatMap((d, i) => (deleted.has(d.node.id) ? [] : [i])),
  );
  const newLeft = new Set(
    next.flatMap((d, i) => (inserted.has(d.node.id) ? [] : [i])),
  );
  const matched = new Map<string, string>();
  const take = (i: number, j: number) => {
    matched.set(
      (old[i] as (typeof old)[number]).node.id,
      (next[j] as (typeof next)[number]).node.id,
    );
    oldLeft.delete(i);
    newLeft.delete(j);
  };
  type Described = (typeof old)[number];
  const unique = (sig: (d: Described) => string) => {
    const olds = new Map<string, number[]>();
    const news = new Map<string, number[]>();
    for (const i of oldLeft) push(olds, sig(old[i] as Described), i);
    for (const j of newLeft) push(news, sig(next[j] as Described), j);
    for (const [key, is] of olds) {
      const js = news.get(key);
      if (is.length === 1 && js?.length === 1)
        take(is[0] as number, js[0] as number);
    }
  };
  const sequence = (sig: (d: Described) => string) => {
    const is = [...oldLeft];
    const js = [...newLeft];
    const pairs = lcs(
      is.map((i) => sig(old[i] as Described)),
      js.map((j) => sig(next[j] as Described)),
    );
    for (const [a, b] of pairs) take(is[a] as number, js[b] as number);
  };
  const strong = (d: Described) => d.strong;
  const name = (d: Described) => d.name;
  const kind = (d: Described) => d.kind;
  unique(strong);
  sequence(strong);
  unique(name);
  sequence(name);
  sequence(kind);
  return matched;
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** `path#name`, the name empty for an entry workflow. */
export const workflowKey = (w: { path: string; name: string | null }): string =>
  `${w.path}#${w.name ?? ""}`;

/** The hints of a command: the declaration a `renameDeclaration` renamed, the node a `deleteNode` deleted. */
export const carryHints = (command: EditCommand | undefined): CarryHints => {
  switch (command?.kind) {
    case "renameDeclaration":
      return {
        renames: [
          { path: command.path, from: command.name, to: command.newName },
        ],
      };
    case "moveFile":
      return { moves: [{ from: command.path, to: command.newPath }] };
    case "deleteNode":
      return { deleted: [command.node] };
    default:
      return {};
  }
};

/** Where a file went: through the first move of it or of a folder above it. */
function movedPath(path: string, moves: readonly MoveHint[]): string {
  for (const m of moves) {
    if (path === m.from) return m.to;
    if (path.startsWith(`${m.from}/`))
      return `${m.to}${path.slice(m.from.length)}`;
  }
  return path;
}

/**
 * For each workflow in `before`, the workflow it became in `after`, or null when it vanished. A workflow with the same
 * path and name is itself. Within the files in `changed`, a rename hint for it comes next, then a lone vanished
 * workflow paired with a lone new one in the same file (a replaced file text, an undo).
 */
export function pairWorkflows(
  before: readonly WorkflowRef[],
  after: readonly WorkflowRef[],
  changed: ReadonlySet<string>,
  renames: readonly RenameHint[],
  moves: readonly MoveHint[] = [],
): ReadonlyMap<string, WorkflowRef | null> {
  const present = new Map(after.map((w) => [workflowKey(w), w]));
  const beforeKeys = new Set(before.map(workflowKey));
  const result = new Map<string, WorkflowRef | null>();
  const claimed = new Set<string>();
  const vanished: WorkflowRef[] = [];
  for (const w of before) {
    const same = present.get(workflowKey(w));
    if (same) {
      result.set(workflowKey(w), same);
      claimed.add(workflowKey(same));
    } else vanished.push(w);
  }
  const rest: WorkflowRef[] = [];
  for (const w of vanished) {
    const path = movedPath(w.path, moves);
    const hint = renames.find((h) => h.path === path && h.from === w.name);
    const target =
      present.get(workflowKey({ path, name: hint ? hint.to : w.name })) ??
      (hint
        ? present.get(workflowKey({ path: w.path, name: hint.to }))
        : undefined);
    if (target && !claimed.has(workflowKey(target))) {
      result.set(workflowKey(w), target);
      claimed.add(workflowKey(target));
    } else rest.push(w);
  }
  const fresh = after.filter(
    (w) => !beforeKeys.has(workflowKey(w)) && !claimed.has(workflowKey(w)),
  );
  for (const w of rest) {
    const gone = rest.filter((x) => x.path === w.path);
    const added = fresh.filter((x) => x.path === w.path);
    const only = added[0];
    if (
      changed.has(w.path) &&
      gone.length === 1 &&
      added.length === 1 &&
      only !== undefined
    )
      result.set(workflowKey(w), only);
    else result.set(workflowKey(w), null);
  }
  return result;
}

export interface WorkflowPair {
  readonly before: Projection;
  /** Null when the workflow vanished. */
  readonly after: Projection | null;
}

/**
 * The pairs to carry: each workflow of `before` with a projection, and the projection of the workflow it became (null
 * when it vanished). One that became an unmodelled workflow is left out, so its entries stay.
 */
export function workflowPairs(
  before: {
    readonly workflows: readonly WorkflowRef[];
    readonly projections: ReadonlyMap<string, Projection>;
  },
  after: readonly WorkflowRef[],
  project: (w: WorkflowRef) => Projection | null,
  changed: ReadonlySet<string>,
  renames: readonly RenameHint[],
  moves: readonly MoveHint[] = [],
): WorkflowPair[] {
  const paired = pairWorkflows(
    before.workflows,
    after,
    changed,
    renames,
    moves,
  );
  const pairs: WorkflowPair[] = [];
  for (const w of before.workflows) {
    const old = before.projections.get(workflowKey(w));
    const target = paired.get(workflowKey(w));
    if (!old || target === undefined) continue;
    if (target === null) pairs.push({ before: old, after: null });
    else {
      const now = target.modelled ? project(target) : null;
      if (now) pairs.push({ before: old, after: now });
    }
  }
  return pairs;
}

const REMEMBERED = 500;

/**
 * Positions of nodes a change removed, kept for the session (never stored) and given back when a node with the same
 * signature returns to the same workflow: undoing a delete then restores its position (ADR 0008). Each workflow and
 * signature keeps a stack, newest first, so identical nodes deleted one after another come back in reverse order.
 * Holds at most 500.
 */
export class RemovedPositions {
  readonly #map = new Map<string, Point[]>();
  #size = 0;

  remember(workflowKey: string, signature: string, p: Point): void {
    const key = `${workflowKey}${NONE}${signature}`;
    const stack = this.#map.get(key) ?? [];
    this.#map.delete(key);
    stack.push(p);
    this.#map.set(key, stack);
    this.#size += 1;
    while (this.#size > REMEMBERED) {
      const oldest = this.#map.entries().next().value;
      if (oldest === undefined) break;
      const [oldKey, list] = oldest;
      list.shift();
      this.#size -= 1;
      if (list.length === 0) this.#map.delete(oldKey);
    }
  }

  take(workflowKey: string, signature: string): Point | null {
    const key = `${workflowKey}${NONE}${signature}`;
    const stack = this.#map.get(key);
    const found = stack?.pop();
    if (stack === undefined || found === undefined) return null;
    this.#size -= 1;
    if (stack.length === 0) this.#map.delete(key);
    return found;
  }
}

/** The signature a removed node is remembered under: kind, name, variable and variables read. */
function nodeSignatures(projection: Projection): ReadonlyMap<string, string> {
  return new Map(
    describe(projection, nodeName).map((d) => [d.node.id, d.strong]),
  );
}

/**
 * Moves each paired workflow's entries to the new ids. Entries of nodes that found no match are dropped (and remembered
 * in `removed`); entries of a vanished workflow are dropped. Nodes with no entry stay unplaced.
 */
export function carryLayout(
  doc: LayoutDocument,
  pairs: readonly WorkflowPair[],
  hints: CarryHints,
  removed?: RemovedPositions,
): LayoutDocument {
  const nodes: Record<string, Point> = { ...doc.nodes };
  const additions: Record<string, Point> = {};
  for (const { before, after } of pairs) {
    const stored: Positions = workflowPositions(
      doc,
      before.workflow.path,
      before.workflow.name,
    );
    for (const id of Object.keys(stored)) delete nodes[id];
    const fromKey = workflowKey(before.workflow);
    if (after === null) continue;
    const map = matchNodes(before, after, hints);
    const oldSignatures = nodeSignatures(before);
    for (const [id, p] of Object.entries(stored)) {
      const target = map.get(id);
      if (target !== undefined) additions[target] = p;
      else removed?.remember(fromKey, oldSignatures.get(id) ?? id, p);
    }
    const matchedNew = new Set(map.values());
    const newSignatures = nodeSignatures(after);
    for (const n of after.nodes) {
      if (matchedNew.has(n.id)) continue;
      const back = removed?.take(
        workflowKey(after.workflow),
        newSignatures.get(n.id) ?? n.id,
      );
      if (back) additions[n.id] = back;
    }
  }
  return { version: 1, nodes: { ...nodes, ...additions } };
}
