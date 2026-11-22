// Comparison of the browser's SVG with the CLI's (F-010 step 2). DOM-free.
export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export type PixelDiff = {
  sameSize: boolean;
  mismatchPixels: number;
  mismatchRatio: number;
};

/** 0 to 255: a pixel differs when its largest RGBA channel difference exceeds this. */
export const CHANNEL_THRESHOLD = 25;
/** Step 2 passes at or below 0.1% differing pixels (one recoloured line gives about 1%). */
export const MISMATCH_TOLERANCE = 0.001;

/** Different sizes give { sameSize: false, mismatchPixels: max(area), mismatchRatio: 1 }. */
export function pixelDiff(
  a: Raster,
  b: Raster,
  threshold: number = CHANNEL_THRESHOLD,
): PixelDiff {
  if (a.width !== b.width || a.height !== b.height)
    return {
      sameSize: false,
      mismatchPixels: Math.max(a.width * a.height, b.width * b.height),
      mismatchRatio: 1,
    };
  const pixels = a.width * a.height;
  let mismatchPixels = 0;
  for (let i = 0; i < pixels; i++) {
    let largest = 0;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(
        (a.data[i * 4 + channel] ?? 0) - (b.data[i * 4 + channel] ?? 0),
      );
      if (difference > largest) largest = difference;
    }
    if (largest > threshold) mismatchPixels++;
  }
  return {
    sameSize: true,
    mismatchPixels,
    mismatchRatio: pixels === 0 ? 0 : mismatchPixels / pixels,
  };
}

/** The CLI appends a final newline; only trailing whitespace is ignored. */
export function normaliseSvg(text: string): string {
  return text.trimEnd();
}
