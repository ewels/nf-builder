import type { PaletteIcon } from "@nf-builder/engine";
import type { JSX } from "react";
import { PALETTE_GLYPHS } from "../glyphs";

export function PaletteGlyph({
  icon,
}: {
  readonly icon: PaletteIcon;
}): JSX.Element {
  const glyph = PALETTE_GLYPHS[icon];
  return (
    <span className={`palette-glyph tone-${glyph.tone}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d={glyph.path} />
      </svg>
    </span>
  );
}
