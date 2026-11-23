export interface ImportLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxTotalBytes: number;
  readonly maxTextFileBytes: number;
  readonly unpackMs: number;
}

/** IO-12 and QA-32. 1 MB is 1,000,000 bytes. */
export const IMPORT_LIMITS: ImportLimits = {
  maxArchiveBytes: 200_000_000,
  maxEntries: 20_000,
  maxTotalBytes: 200_000_000,
  maxTextFileBytes: 1_000_000,
  unpackMs: 30_000,
};

const UNITS = ["kB", "MB", "GB"] as const;

const shown = (value: number): number =>
  value < 10 ? Math.round(value * 10) / 10 : Math.round(value);

/** SI units; one decimal below 10, dropped when it is zero. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  let unit = 0;
  let value = shown(bytes / 1000);
  while (value >= 1000 && unit < UNITS.length - 1) {
    unit += 1;
    value = shown(bytes / 1000 ** (unit + 1));
  }
  return `${value} ${UNITS[unit]}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}
