import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  RegistrySnapshotIndex,
  RegistrySnapshotPorts,
  SnapshotFile,
  SnapshotModule,
  SnapshotModuleBundle,
  SnapshotModulePorts,
  SnapshotPlugin,
  SourceParser,
} from "@nf-builder/lang-core";
import { REGISTRY_URL, type RegistryApi } from "./api.ts";
import type { ApiModule, ApiModuleRelease } from "./api-types.ts";
import { classifyModule } from "./classify.ts";
import { moduleBundlePath, pluginFilePath, serialise } from "./files.ts";
import { pluginSnapshot } from "./plugins.ts";
import { modulePorts } from "./ports.ts";
import { readModuleTarGz } from "./tar.ts";

export class SnapshotBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotBuildError";
  }
}

/** A snapshot already published, read from a checkout of the `registry-snapshot` branch. */
export interface PreviousSnapshot {
  readonly index: RegistrySnapshotIndex;
  readonly ports: RegistrySnapshotPorts;
  /** The text of a snapshot file by its path ("registry/..."), or undefined. */
  read(path: string): string | undefined;
}

export interface BuildOptions {
  readonly api: RegistryApi;
  readonly parser: SourceParser;
  /** The pack that classifies typed and legacy, "26.10". */
  readonly language: string;
  /** The Nextflow version plugin releases are chosen for, "26.10.7". */
  readonly nextflow: string;
  readonly now: () => Date;
  readonly previous?: PreviousSnapshot;
  /** Build only these (fixtures, spot checks). Without `modules`, the module-count check is skipped when set. */
  readonly only?: {
    readonly modules?: readonly string[];
    readonly plugins?: readonly string[];
  };
  readonly limits?: { maxFailureRatio: number; minCountRatio: number };
  readonly log?: (message: string) => void;
}

export interface BuildReport {
  readonly generatedAt: string;
  readonly apiVersion: string;
  modules: number;
  processes: number;
  workflows: number;
  typed: string[];
  legacy: number;
  /** Modules whose main.nf could not be modelled (typed: null). */
  unmodelled: string[];
  /** Known modules that must classify as expected, e.g. "nf-core/fastqc: legacy process FASTQC". */
  spotChecks: string[];
  kindOverrides: string[];
  componentDisagreements: string[];
  reused: number;
  downloaded: number;
  pins: number;
  skippedModules: string[];
  plugins: number;
  skippedPlugins: string[];
  pluginProblems: string[];
  /** Failed items; "kept" says whether the previous snapshot's copy was kept. */
  failures: { id: string; error: string; kept: boolean }[];
}

const DEFAULT_LIMITS = { maxFailureRatio: 0.02, minCountRatio: 0.9 };
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function readPreviousSnapshot(
  dir: string,
): PreviousSnapshot | undefined {
  const read = (path: string): string | undefined => {
    const file = join(dir, path);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };
  const index = read("registry/index.json");
  const ports = read("registry/ports.json");
  if (index === undefined || ports === undefined) return undefined;
  try {
    return {
      index: JSON.parse(index) as RegistrySnapshotIndex,
      ports: JSON.parse(ports) as RegistrySnapshotPorts,
      read,
    };
  } catch {
    return undefined;
  }
}

/** "nf-core/gatk4/applybqsr@0.0.0-6d1763b" -> name and version (split at the last "@"). */
function parsePin(pin: string): { name: string; version: string } | undefined {
  const at = pin.lastIndexOf("@");
  return at > 0
    ? { name: pin.slice(0, at), version: pin.slice(at + 1) }
    : undefined;
}

/**
 * Builds the snapshot (IO-31): index, ports, one bundle per module release, plugins. Sequential, so the registry's
 * rate limit is easy to respect. Failures of single items keep the previous copy; too many throw SnapshotBuildError.
 */
export async function buildSnapshot(
  options: BuildOptions,
): Promise<{ files: ReadonlyMap<string, string>; report: BuildReport }> {
  const { api, parser, previous } = options;
  const log = options.log ?? (() => {});
  const limits = options.limits ?? DEFAULT_LIMITS;
  const generatedAt = options.now().toISOString();
  const info = await api.serviceInfo();
  const report: BuildReport = {
    generatedAt,
    apiVersion: info.version,
    modules: 0,
    processes: 0,
    workflows: 0,
    typed: [],
    legacy: 0,
    unmodelled: [],
    spotChecks: [],
    kindOverrides: [],
    componentDisagreements: [],
    reused: 0,
    downloaded: 0,
    pins: 0,
    skippedModules: [],
    plugins: 0,
    skippedPlugins: [],
    pluginProblems: [],
    failures: [],
  };
  const files = new Map<string, string>();
  const entries = new Map<string, SnapshotModule>();
  const ports = new Map<string, SnapshotModulePorts>();
  const pinQueue: { name: string; version: string }[] = [];

  /** The files of a release: from the previous bundle when its checksum matches, else downloaded and verified. */
  async function releaseFiles(
    name: string,
    release: ApiModuleRelease,
  ): Promise<SnapshotFile[]> {
    const old = previous?.read(moduleBundlePath(name, release.version));
    if (old !== undefined) {
      const bundle = JSON.parse(old) as SnapshotModuleBundle;
      if (bundle.checksum === release.checksum) {
        report.reused++;
        return [...bundle.files];
      }
    }
    log(`downloading ${name}@${release.version}`);
    const bytes = await api.downloadModule(name, release.version);
    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (checksum !== release.checksum)
      throw new Error(
        `${name}@${release.version}: checksum ${checksum} does not match the registry's ${release.checksum}`,
      );
    report.downloaded++;
    return readModuleTarGz(bytes);
  }

  /** Classifies and writes one release's bundle; returns what the index and the pin queue need. */
  async function buildRelease(
    name: string,
    release: ApiModuleRelease,
    module?: ApiModule,
  ) {
    const metadata = release.metadata;
    const releaseFilesList = await releaseFiles(name, release);
    const text = (path: string): string | null => {
      const file = releaseFilesList.find((f) => f.path === path);
      return file && "text" in file ? file.text : null;
    };
    const registryKind = metadata?.kind ?? module?.kind;
    const classification = classifyModule(parser, text("main.nf"), {
      kind: registryKind,
      componentName: metadata?.componentName,
    });
    const requires = (metadata?.requires?.modules ?? [])
      .map(parsePin)
      .flatMap((p) => (p ? [p] : []))
      .sort((a, b) => byName(a.name, b.name) || byName(a.version, b.version));
    const bundle: SnapshotModuleBundle = {
      format: 1,
      name,
      version: release.version,
      checksum: release.checksum,
      component: classification.component,
      requires,
      files: [...releaseFilesList].sort((a, b) => byName(a.path, b.path)),
    };
    files.set(moduleBundlePath(name, release.version), serialise(bundle));
    for (const pin of requires) pinQueue.push(pin);
    const entry: SnapshotModule = {
      name,
      version: release.version,
      kind: classification.kind,
      component: classification.component,
      typed: classification.typed,
      description: metadata?.description ?? module?.description ?? "",
      keywords: metadata?.keywords ?? [],
    };
    return {
      entry,
      ports: modulePorts(metadata, text("meta.yml")),
      registryKind,
      componentName: metadata?.componentName,
    };
  }

  const keepModule = (name: string): boolean => {
    const entry = previous?.index.modules.find((m) => m.name === name);
    const modulePorts = previous?.ports.modules[name];
    const bundle =
      entry && previous?.read(moduleBundlePath(name, entry.version));
    if (!(entry && modulePorts && bundle)) return false;
    entries.set(name, entry);
    ports.set(name, modulePorts);
    files.set(moduleBundlePath(name, entry.version), bundle);
    return true;
  };

  const names = options.only?.modules ?? (await api.listModules());
  for (const name of names) {
    try {
      const module = await api.getModule(name);
      const latest = module.latest;
      if (
        module.revoked === true ||
        !latest ||
        (latest.status !== undefined && latest.status !== "PUBLISHED")
      ) {
        report.skippedModules.push(name);
        continue;
      }
      const built = await buildRelease(name, latest, module);
      entries.set(name, built.entry);
      ports.set(name, built.ports);
      if (
        built.registryKind !== undefined &&
        built.registryKind.toLowerCase() !== built.entry.kind
      )
        report.kindOverrides.push(
          `${name}: registry ${built.registryKind}, main.nf ${built.entry.kind}`,
        );
      if (
        built.componentName !== undefined &&
        built.componentName !== built.entry.component
      )
        report.componentDisagreements.push(
          `${name}: registry ${built.componentName}, main.nf ${built.entry.component ?? "none"}`,
        );
    } catch (error) {
      report.failures.push({
        id: name,
        error: message(error),
        kept: keepModule(name),
      });
      log(`failed ${name}: ${message(error)}`);
    }
  }

  // Pinned dependency versions that aren't a module's latest also get a bundle, closed over their own pins.
  const visited = new Set<string>();
  for (let pin = pinQueue.shift(); pin; pin = pinQueue.shift()) {
    const path = moduleBundlePath(pin.name, pin.version);
    if (files.has(path) || visited.has(path)) continue;
    visited.add(path);
    try {
      await buildRelease(
        pin.name,
        await api.getModuleRelease(pin.name, pin.version),
      );
      report.pins++;
    } catch (error) {
      const old = previous?.read(path);
      if (old !== undefined) files.set(path, old);
      report.failures.push({
        id: `${pin.name}@${pin.version}`,
        error: message(error),
        kept: old !== undefined,
      });
    }
  }

  const plugins: SnapshotPlugin[] = [];
  const pluginIds = options.only?.plugins ?? (await api.listPlugins());
  for (const id of pluginIds) {
    try {
      const result = pluginSnapshot(await api.getPlugin(id), options.nextflow);
      if ("skipped" in result) {
        report.skippedPlugins.push(result.skipped);
        continue;
      }
      plugins.push(result.entry);
      files.set(
        pluginFilePath(id, result.entry.version),
        serialise(result.file),
      );
      report.pluginProblems.push(...result.problems);
    } catch (error) {
      const entry = previous?.index.plugins.find((p) => p.id === id);
      const old = entry && previous?.read(pluginFilePath(id, entry.version));
      if (entry && old !== undefined) {
        plugins.push(entry);
        files.set(pluginFilePath(id, entry.version), old);
      }
      report.failures.push({
        id,
        error: message(error),
        kept: Boolean(entry && old !== undefined),
      });
    }
  }

  const attempted = names.length + pluginIds.length;
  if (report.failures.length > attempted * limits.maxFailureRatio)
    throw new SnapshotBuildError(
      `${report.failures.length} of ${attempted} items failed (limit ${limits.maxFailureRatio * 100}%): ${report.failures
        .slice(0, 5)
        .map((f) => `${f.id}: ${f.error}`)
        .join("; ")}`,
    );
  if (
    options.only?.modules === undefined &&
    previous &&
    entries.size < previous.index.modules.length * limits.minCountRatio
  )
    throw new SnapshotBuildError(
      `${entries.size} modules is under ${limits.minCountRatio * 100}% of the previous snapshot's ${previous.index.modules.length}`,
    );

  const sortedModules = [...entries.values()].sort((a, b) =>
    byName(a.name, b.name),
  );
  const sortedPlugins = plugins.sort((a, b) => byName(a.id, b.id));
  const index: RegistrySnapshotIndex = {
    format: 1,
    generatedAt,
    registry: REGISTRY_URL,
    apiVersion: info.version,
    language: options.language,
    nextflow: options.nextflow,
    modules: sortedModules,
    plugins: sortedPlugins,
  };
  const portsFile: RegistrySnapshotPorts = {
    format: 1,
    generatedAt,
    modules: Object.fromEntries(
      sortedModules.map((m) => [
        m.name,
        ports.get(m.name) as SnapshotModulePorts,
      ]),
    ),
  };
  files.set("registry/index.json", serialise(index));
  files.set("registry/ports.json", serialise(portsFile));

  for (const m of sortedModules) {
    report.modules++;
    if (m.kind === "workflow") report.workflows++;
    else report.processes++;
    if (m.typed === true) report.typed.push(m.name);
    else if (m.typed === false) report.legacy++;
    else report.unmodelled.push(m.name);
    if (m.name === "nf-core/fastqc")
      report.spotChecks.push(
        `${m.name}: ${m.typed === null ? "unmodelled" : m.typed ? "typed" : "legacy"} ${m.kind} ${m.component ?? ""}`.trim(),
      );
  }
  report.plugins = sortedPlugins.length;
  return {
    files: new Map([...files].sort(([a], [b]) => byName(a, b))),
    report,
  };
}
