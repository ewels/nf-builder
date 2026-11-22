// Sizes of canvas nodes in pixels. The web components set the same numbers through `style`, so layout and CSS can't drift.

export const CANVAS_METRICS = {
  cardWidth: 208,
  headerHeight: 44,
  /** One port row with its label. */
  rowHeight: 20,
  /** One port row without labels (a bare handle). */
  compactRowHeight: 10,
  pillHeight: 32,
  pillMinWidth: 96,
  pillMaxWidth: 240,
  pillCharWidth: 8,
  pillPadding: 48,
  /** The uppercase "TAKE" or "EMIT" prefix and its gap. */
  pillPrefixWidth: 40,
  columnGap: 64,
  rowGap: 24,
} as const;
