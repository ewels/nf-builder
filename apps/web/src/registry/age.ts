import type { RegistryIndex } from "@nf-builder/sources";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const buildTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "just now", "5 minutes ago", "5 hours ago", "yesterday", "3 days ago" (en-GB); a future time is "just now". */
export function formatAge(iso: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(iso);
  if (!(elapsed >= MINUTE)) return "just now";
  if (elapsed < HOUR)
    return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY)
    return relative.format(-Math.floor(elapsed / HOUR), "hour");
  return relative.format(-Math.floor(elapsed / DAY), "day");
}

/** "22 Nov 2026, 00:00 UTC" */
export function formatBuildTime(iso: string): string {
  return `${buildTime.format(new Date(iso))} UTC`;
}

/** "Snapshot · updated 5 hours ago" or "Live · updated just now". */
export function sourceLine(index: RegistryIndex, now: Date): string {
  const source = index.source === "live" ? "Live" : "Snapshot";
  return `${source} · updated ${formatAge(index.asOf, now)}`;
}
