// The bridge from the palette to the canvas's viewport (F-301, UX-15): the palette lives outside the React Flow provider,
// so the mounted canvas registers what it can answer, like `registerFlush` in the canvas store.
import type { Point } from "@nf-builder/engine";

export interface CanvasViewport {
  /** The workflow tab whose canvas this is. */
  readonly tab: string;
  /** The centre of the visible canvas, in flow coordinates. */
  centre(): Point;
  /** A screen point (client coordinates) in flow coordinates. */
  toFlow(client: { readonly x: number; readonly y: number }): Point;
}

const mounted = new Map<string, CanvasViewport>();

/** Registers a mounted canvas; returns the function that removes it (and leaves a later one for the tab alone). */
export function registerViewport(viewport: CanvasViewport): () => void {
  mounted.set(viewport.tab, viewport);
  return () => {
    if (mounted.get(viewport.tab) === viewport) mounted.delete(viewport.tab);
  };
}

export function activeViewport(tab: string): CanvasViewport | null {
  return mounted.get(tab) ?? null;
}
