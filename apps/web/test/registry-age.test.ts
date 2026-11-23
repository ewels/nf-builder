import type { RegistryIndex } from "@nf-builder/sources";
import { describe, expect, it } from "vitest";
import { formatAge, formatBuildTime, sourceLine } from "../src/registry/age";

const NOW = new Date("2026-11-22T05:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const index = (source: "live" | "snapshot", asOf: string): RegistryIndex => ({
  source,
  asOf,
  snapshotAt: asOf,
  language: "26.10",
  nextflow: "26.10.7",
  modules: [],
  plugins: [],
  liveFailure: null,
});

describe("registry age", () => {
  it("F-502 UX-14: formatAge says just now, minutes, hours, yesterday and days in British English, and just now for a future time", () => {
    expect(formatAge(ago(10_000), NOW)).toBe("just now");
    expect(formatAge(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(formatAge(ago(5 * HOUR), NOW)).toBe("5 hours ago");
    expect(formatAge(ago(30 * HOUR), NOW)).toBe("yesterday");
    expect(formatAge(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(formatAge(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe(
      "just now",
    );
  });

  it("F-502 UX-14: formatBuildTime gives the build time in UTC, and sourceLine names the source and the age", () => {
    expect(formatBuildTime("2026-11-22T00:00:00.000Z")).toBe(
      "22 Nov 2026, 00:00 UTC",
    );
    expect(sourceLine(index("snapshot", ago(5 * HOUR)), NOW)).toBe(
      "Snapshot · updated 5 hours ago",
    );
    expect(sourceLine(index("live", ago(0)), NOW)).toBe(
      "Live · updated just now",
    );
  });
});
