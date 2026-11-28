// What a palette drag carries (F-301, UX-15). A custom type, so the Files drop guard (F-210), which acts on drags with
// `Files`, never takes it, and a file dragged over the canvas is never taken for a palette item.
export const PALETTE_MIME = "application/x-nf-builder-palette";

export function writePaletteDrag(dt: DataTransfer, key: string): void {
  dt.setData(PALETTE_MIME, key);
  dt.effectAllowed = "copy";
}

/** True while a palette item is dragged (the data itself can't be read before the drop). */
export function hasPaletteDrag(dt: DataTransfer): boolean {
  return [...dt.types].includes(PALETTE_MIME);
}

export function readPaletteDrag(dt: DataTransfer): string | null {
  if (!hasPaletteDrag(dt)) return null;
  const key = dt.getData(PALETTE_MIME);
  return key === "" ? null : key;
}
