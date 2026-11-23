// Reading and writing the layout sidecar (ADR 0008, F-207). Pure: text in, text out. The text is canonical, so the same
// document always gives the same bytes.

import { parseNodeKey } from "../projection/keys";
import {
  LAYOUT_VERSION,
  type LayoutDocument,
  type LayoutWrite,
  type Point,
  type Positions,
} from "./types";

export const EMPTY_LAYOUT: LayoutDocument = { version: 1, nodes: {} };

/** `LAYOUT_MIGRATIONS[n]` turns a version-n document into version n + 1. A shipped migration is never edited. */
export type LayoutMigrations = Readonly<
  Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>
>;

export const LAYOUT_MIGRATIONS: LayoutMigrations = {};

export type ParsedLayout =
  | { ok: true; document: LayoutDocument; dropped: number }
  | { ok: false; state: "invalid" | "newer"; message: string };

const LIMIT = 1e6;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const invalid = (reason: string): ParsedLayout => ({
  ok: false,
  state: "invalid",
  message: `The layout file couldn't be read (${reason}). Nodes are laid out automatically, and the file will be replaced when the layout is saved.`,
});

/** A coordinate the sidecar keeps: a finite number within ±1e6. */
export const inRange = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= LIMIT;

/** Adding zero turns -0 into 0. */
const whole = (n: number): number => Math.round(n) + 0;

/**
 * Reads sidecar text. An entry is dropped (and counted) when its key isn't a node key or its coordinates are missing,
 * not finite or outside ±1e6; unknown fields are ignored. Never throws.
 */
export function parseLayout(
  text: string,
  migrations: LayoutMigrations = LAYOUT_MIGRATIONS,
): ParsedLayout {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid("it isn't valid JSON");
  }
  if (!isRecord(raw)) return invalid("it isn't a JSON object");
  const target = Math.max(
    LAYOUT_VERSION,
    ...Object.keys(migrations).map((k) => Number(k) + 1),
  );
  let version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return invalid("its version is missing or not a whole number");
  if (version > target)
    return {
      ok: false,
      state: "newer",
      message:
        "The layout file comes from a newer nf-builder. Reload to update; until then, positions aren't saved.",
    };
  let current: Record<string, unknown> = raw;
  while (version < target) {
    const migrate = migrations[version];
    if (migrate === undefined)
      return invalid(`no migration from version ${version}`);
    try {
      current = migrate(current);
    } catch {
      return invalid(`migrating from version ${version} failed`);
    }
    version += 1;
  }
  const entries = current.nodes;
  if (!isRecord(entries)) return invalid("its nodes are missing");
  const nodes: Record<string, Point> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (
      parseNodeKey(key) === null ||
      !isRecord(value) ||
      !inRange(value.x) ||
      !inRange(value.y)
    ) {
      dropped += 1;
      continue;
    }
    nodes[key] = { x: value.x + 0, y: value.y + 0 };
  }
  return { ok: true, document: { version: 1, nodes }, dropped };
}

/** The canonical text: 2-space indent, one node per line, keys sorted by UTF-16 code unit, integers, trailing newline. */
export function formatLayout(doc: LayoutDocument): string {
  const keys = Object.keys(doc.nodes).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const body = keys.map((key) => {
    const p = doc.nodes[key] as Point;
    return `    ${JSON.stringify(key)}: { "x": ${whole(p.x)}, "y": ${whole(p.y)} }`;
  });
  const nodes = body.length === 0 ? "{}" : `{\n${body.join(",\n")}\n  }`;
  return `{\n  "version": ${LAYOUT_VERSION},\n  "nodes": ${nodes}\n}\n`;
}

function inWorkflow(id: string, path: string, workflow: string | null) {
  const key = parseNodeKey(id);
  return key !== null && key.path === path && key.workflow === workflow;
}

/** The stored entries of one workflow, or only those of `ids`. */
export function workflowPositions(
  doc: LayoutDocument,
  path: string,
  workflow: string | null,
  ids?: Iterable<string>,
): Positions {
  const out: Record<string, Point> = {};
  if (ids !== undefined) {
    for (const id of ids) {
      const p = doc.nodes[id];
      if (p !== undefined && inWorkflow(id, path, workflow)) out[id] = p;
    }
    return out;
  }
  for (const [id, p] of Object.entries(doc.nodes))
    if (inWorkflow(id, path, workflow)) out[id] = p;
  return out;
}

/** Merges `write.positions`; with `replace`, the workflow's other entries go first. Coordinates are rounded. */
export function writePositions(
  doc: LayoutDocument,
  write: LayoutWrite,
): LayoutDocument {
  const nodes: Record<string, Point> = {};
  for (const [id, p] of Object.entries(doc.nodes))
    if (!write.replace || !inWorkflow(id, write.path, write.workflow))
      nodes[id] = p;
  for (const [id, p] of Object.entries(write.positions))
    nodes[id] = { x: whole(p.x), y: whole(p.y) };
  return { version: 1, nodes };
}

/** The workflows with entries, in key order. */
export function trackedWorkflows(
  doc: LayoutDocument,
): readonly { path: string; workflow: string | null }[] {
  const seen = new Set<string>();
  const out: { path: string; workflow: string | null }[] = [];
  for (const id of Object.keys(doc.nodes).sort()) {
    const key = parseNodeKey(id);
    if (key === null) continue;
    const label = `${key.path}#${key.workflow ?? ""}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ path: key.path, workflow: key.workflow });
  }
  return out;
}
