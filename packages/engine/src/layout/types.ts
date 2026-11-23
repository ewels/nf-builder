// The layout sidecar (ADR 0008, F-207): where nodes sit on the canvas, stored in `.nf-builder/layout.json`.

import type { FileText } from "@nf-builder/lang-core";

/** The sidecar's path in the project (IO-02). */
export const LAYOUT_PATH = ".nf-builder/layout.json";

/** The version this build writes. */
export const LAYOUT_VERSION = 1;

/** A node's top-left corner in canvas coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Node ids (ADR 0036 keys) to positions. */
export type Positions = Readonly<Record<string, Point>>;

export interface LayoutDocument {
  readonly version: 1;
  readonly nodes: Positions;
}

/**
 * `absent`: no file. `ok`: readable. `invalid`: unreadable; positions are ignored and the next layout write replaces the
 * file. `newer`: written by a newer version; positions are ignored and the file is never written.
 */
export type LayoutState = "absent" | "ok" | "invalid" | "newer";

export interface LayoutStatus {
  readonly state: LayoutState;
  /** The notice text for `invalid` and `newer`, and for `ok` when entries were dropped; null otherwise. */
  readonly message: string | null;
}

/** Positions to store for one workflow; `replace` drops that workflow's other entries first. */
export interface LayoutWrite {
  /** The revision the positions were computed for; a write for another revision is refused as stale (F-207). */
  readonly revision: number;
  readonly path: string;
  /** Null for the entry workflow. */
  readonly workflow: string | null;
  readonly positions: Positions;
  readonly replace: boolean;
}

export interface LayoutChange {
  readonly revision: number;
  /** The sidecar's new text, or empty when nothing changed. */
  readonly files: readonly FileText[];
  readonly layout: LayoutStatus;
}
