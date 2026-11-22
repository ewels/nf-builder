import type { PaletteIcon } from "@nf-builder/engine";
import type { JSX } from "react";
import { GlyphIcon, PALETTE_GLYPHS } from "../glyphs";

export function PaletteGlyph({
  icon,
}: {
  readonly icon: PaletteIcon;
}): JSX.Element {
  return <GlyphIcon glyph={PALETTE_GLYPHS[icon]} className="palette-glyph" />;
}
