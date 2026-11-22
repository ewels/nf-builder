import type {
  PluginDefinition,
  SnapshotPlugin,
  SnapshotPluginFile,
} from "@nf-builder/lang-core";
import type { ApiPlugin, ApiPluginRelease } from "./api-types.ts";

const SUMMARY_MAX = 300;
const DEFINITION_TYPES = new Set([
  "ConfigScope",
  "Function",
  "Operator",
  "Factory",
]);

interface Version {
  readonly numbers: readonly number[];
  /** SNAPSHOT 0, edge 1, a release 2: a suffix sorts below its release. */
  readonly rank: number;
}

function parseVersion(text: string): Version {
  const match = /^(\d+(?:\.\d+)*)(?:-(edge|SNAPSHOT))?$/.exec(text.trim());
  if (!match) return { numbers: [0], rank: 2 };
  const rank = match[2] === "SNAPSHOT" ? 0 : match[2] === "edge" ? 1 : 2;
  return { numbers: (match[1] as string).split(".").map(Number), rank };
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
    const d = (a.numbers[i] ?? 0) - (b.numbers[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.rank - b.rank;
}

/** Whether a plugin release's `requires` (`>=V`, `>V`, `<V` or a bare V, meaning at least V) admits `nextflow`. */
export function admits(requires: string | null, nextflow: string): boolean {
  if (requires === null) return true;
  const match = /^\s*(>=|>|<)?\s*(\S+)\s*$/.exec(requires);
  if (!match) return true;
  const order = compare(
    parseVersion(nextflow),
    parseVersion(match[2] as string),
  );
  if (match[1] === ">") return order > 0;
  if (match[1] === "<") return order < 0;
  return order >= 0;
}

/** First non-heading paragraph of the README markdown, whitespace collapsed, at most 300 characters. */
function summaryOf(description: string): string {
  const paragraph = description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p !== "" && !p.startsWith("#"));
  const text = (paragraph ?? "").replace(/\s+/g, " ");
  return text.length <= SUMMARY_MAX
    ? text
    : `${text.slice(0, SUMMARY_MAX - 1)}…`;
}

function definitionsOf(
  release: ApiPluginRelease,
  problems: string[],
): PluginDefinition[] {
  if (!release.spec) return [];
  let raw: unknown;
  try {
    raw = (JSON.parse(release.spec) as { definitions?: unknown }).definitions;
  } catch {
    problems.push(`spec of ${release.version} is not valid JSON`);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const kept: PluginDefinition[] = [];
  raw.forEach((definition: unknown, index) => {
    const d = definition as {
      type?: unknown;
      spec?: { name?: unknown };
    } | null;
    if (
      d &&
      typeof d.type === "string" &&
      DEFINITION_TYPES.has(d.type) &&
      typeof d.spec?.name === "string"
    )
      kept.push(d as PluginDefinition);
    else
      problems.push(
        `definition ${index} of ${release.version} is malformed and was dropped`,
      );
  });
  return kept;
}

/**
 * The index entry and file of the highest published release that runs on `nextflow` (IO-33), in registry order. A
 * plugin with no such release is skipped.
 */
export function pluginSnapshot(
  plugin: ApiPlugin,
  nextflow: string,
):
  | { entry: SnapshotPlugin; file: SnapshotPluginFile; problems: string[] }
  | { skipped: string } {
  const release = plugin.releases.find(
    (r) => r.status === "PUBLISHED" && admits(r.requires ?? null, nextflow),
  );
  if (!release)
    return {
      skipped: `${plugin.id}: no published release runs on Nextflow ${nextflow}`,
    };
  const problems: string[] = [];
  const definitions = definitionsOf(release, problems);
  const description = release.description ?? "";
  return {
    entry: {
      id: plugin.id,
      version: release.version,
      requires: release.requires ?? null,
      summary: summaryOf(description),
      provider: plugin.provider ?? null,
      projectUrl: plugin.projectUrl ?? null,
      definitions: definitions.length,
    },
    file: {
      format: 1,
      id: plugin.id,
      version: release.version,
      requires: release.requires ?? null,
      description,
      definitions,
    },
    problems: problems.map((p) => `${plugin.id}: ${p}`),
  };
}
