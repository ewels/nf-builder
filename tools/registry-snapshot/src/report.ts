import { gzipSync } from "node:zlib";
import type { BuildReport } from "./build.ts";

interface SnapshotSizes {
  readonly files: number;
  readonly totalBytes: number;
  readonly indexBytes: number;
  readonly indexGzipBytes: number;
  readonly portsBytes: number;
  readonly portsGzipBytes: number;
}

const bytesOf = (text: string | undefined): number =>
  Buffer.byteLength(text ?? "");
const gzipOf = (text: string | undefined): number =>
  gzipSync(text ?? "").length;

/** QA-06 sizes: node:zlib default level, as in ADR 0015. */
export function snapshotSizes(
  files: ReadonlyMap<string, string>,
): SnapshotSizes {
  const index = files.get("registry/index.json");
  const ports = files.get("registry/ports.json");
  let totalBytes = 0;
  for (const text of files.values()) totalBytes += bytesOf(text);
  return {
    files: files.size,
    totalBytes,
    indexBytes: bytesOf(index),
    indexGzipBytes: gzipOf(index),
    portsBytes: bytesOf(ports),
    portsGzipBytes: gzipOf(ports),
  };
}

const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} kB`;
const list = (items: readonly string[], max = 20): string =>
  items.length === 0
    ? "none"
    : `${items.slice(0, max).join(", ")}${items.length > max ? `, and ${items.length - max} more` : ""}`;

/** The Markdown for the job summary. */
export function reportMarkdown(
  report: BuildReport,
  sizes: SnapshotSizes,
): string {
  const lines = [
    "## Registry snapshot",
    "",
    `Generated ${report.generatedAt} from registry API ${report.apiVersion}.`,
    "",
    "| Measure | Value |",
    "|---|---|",
    `| Modules | ${report.modules} (${report.processes} processes, ${report.workflows} workflows) |`,
    `| Typed / legacy / unmodelled | ${report.typed.length} / ${report.legacy} / ${report.unmodelled.length} |`,
    `| Plugins | ${report.plugins} |`,
    `| Bundles reused / downloaded / pinned versions | ${report.reused} / ${report.downloaded} / ${report.pins} |`,
    `| index.json | ${kb(sizes.indexBytes)}, ${kb(sizes.indexGzipBytes)} gzipped (QA-06) |`,
    `| ports.json | ${kb(sizes.portsBytes)}, ${kb(sizes.portsGzipBytes)} gzipped |`,
    `| Files, total | ${sizes.files}, ${kb(sizes.totalBytes)} |`,
    "",
    `Spot checks: ${list(report.spotChecks)}`,
    "",
    `Typed modules: ${list(report.typed)}`,
    "",
    `Modules that could not be modelled: ${list(report.unmodelled)}`,
    "",
    `Kind differs from the registry: ${list(report.kindOverrides)}`,
    "",
    `Component differs from the registry: ${list(report.componentDisagreements)}`,
    "",
    `Skipped modules: ${list(report.skippedModules)}`,
    "",
    `Skipped plugins: ${list(report.skippedPlugins)}`,
    "",
    `Plugin definition problems: ${list(report.pluginProblems)}`,
    "",
    `Failures: ${report.failures.length === 0 ? "none" : ""}`,
    ...report.failures.map(
      (f) =>
        `- ${f.id} (${f.kept ? "previous copy kept" : "left out"}): ${f.error}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
