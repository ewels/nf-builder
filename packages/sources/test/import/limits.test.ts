import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  IMPORT_LIMITS,
} from "../../src/import/limits";

describe("import limits", () => {
  it("F-403 IO-12 QA-32: the limits are 20,000 entries, 200 MB uncompressed, a 200 MB zip, 1 MB per text file and 30 s to unpack, with 1 MB = 1,000,000 bytes", () => {
    expect(IMPORT_LIMITS).toEqual({
      maxArchiveBytes: 200_000_000,
      maxEntries: 20_000,
      maxTotalBytes: 200_000_000,
      maxTextFileBytes: 1_000_000,
      unpackMs: 30_000,
    });
  });

  it("F-403 IO-12: formatBytes writes 999 B, 31 kB, 6.1 MB, 1 MB and 200 MB", () => {
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(30_562)).toBe("31 kB");
    expect(formatBytes(6_114_054)).toBe("6.1 MB");
    expect(formatBytes(1_000_000)).toBe("1 MB");
    expect(formatBytes(200_000_000)).toBe("200 MB");
    expect(formatBytes(999_999)).toBe("1 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });

  it("F-403 IO-12: formatCount groups thousands", () => {
    expect(formatCount(20_000)).toBe("20,000");
    expect(formatCount(1)).toBe("1");
  });
});
