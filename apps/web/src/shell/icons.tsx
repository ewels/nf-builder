import type { JSX } from "react";

const CHEVRON_PATHS = {
  left: "M10 3 5 8l5 5",
  right: "M6 3l5 5-5 5",
  down: "M3 6l5 5 5-5",
} as const;

export function ChevronIcon({
  direction,
}: {
  readonly direction: "left" | "right" | "down";
}): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CHEVRON_PATHS[direction]} />
    </svg>
  );
}

export function CheckIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function RefreshIcon(): JSX.Element {
  return (
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
      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
    </svg>
  );
}

const GLYPH_PATHS = {
  close: "M4 4l8 8M12 4l-8 8",
  "new-file": "M4 2h5l3 3v9H4zM9 2v3h3M8 7.5v4M6 9.5h4",
  "new-folder": "M2 4h4l1.5 1.5H14V13H2zM8 7.5v4M6 9.5h4",
  upload: "M8 11V3M5 6l3-3 3 3M3 13h10",
  folder: "M2 4h4l1.5 1.5H14V13H2z",
  file: "M4 2h5l3 3v9H4zM9 2v3h3",
  error: "M8 2 14.5 13h-13zM8 6.5v3M8 11.2v.1",
} as const;

export type GlyphName = keyof typeof GLYPH_PATHS;

/** A 16 px inline glyph for the Files view and the file tabs; decorative, so the control carries the name (QA-12). */
export function GlyphIcon({ name }: { readonly name: GlyphName }): JSX.Element {
  return (
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
      <path d={GLYPH_PATHS[name]} />
    </svg>
  );
}
