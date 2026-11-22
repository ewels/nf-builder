import type { PaletteIcon } from "@nf-builder/engine";
import type { JSX } from "react";

type Glyph = { readonly tone: string; readonly path: string };

// One small shape per icon, so kinds differ by shape as well as colour (QA-12). Tones follow UX-22.
const GLYPHS: Record<PaletteIcon, Glyph> = {
  process: { tone: "green", path: "M4 4h8v8H4z" },
  agent: {
    tone: "green",
    path: "M8 3l1.5 3.5L13 8l-3.5 1.5L8 13l-1.5-3.5L3 8l3.5-1.5z",
  },
  workflow: { tone: "blue", path: "M3 4h5v3H3zM8 9h5v3H8zM5.5 7v2.5H8" },
  include: { tone: "blue", path: "M8 3v7M5 7.5 8 10.5l3-3M4 13h8" },
  factory: { tone: "purple", path: "M3 12V6l3 2V6l3 2V4h4v8z" },
  operator: { tone: "amber", path: "M3 6h10M3 10h10M10 3l3 3-3 3" },
  params: { tone: "purple", path: "M4 4h8M4 8h8M4 12h5" },
  output: { tone: "pink", path: "M3 8h8M8 5l3 3-3 3M13 3v10" },
  record: { tone: "grey", path: "M3 4h10v8H3zM3 7h10M7 7v5" },
  enum: { tone: "grey", path: "M5 4h7M5 8h7M5 12h7M3 4h.5M3 8h.5M3 12h.5" },
  function: { tone: "grey", path: "M10 3C8 3 8 5 8 7v2c0 2 0 4-2 4M5.5 7h5" },
  plugin: {
    tone: "grey",
    path: "M6 3v3M10 3v3M4 6h8v3a4 4 0 0 1-8 0zM8 13v-1",
  },
  config: { tone: "grey", path: "M4 4v8M8 4v8M12 4v8M3 6h2M7 10h2M11 7h2" },
};

export function PaletteGlyph({
  icon,
}: {
  readonly icon: PaletteIcon;
}): JSX.Element {
  const glyph = GLYPHS[icon];
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
