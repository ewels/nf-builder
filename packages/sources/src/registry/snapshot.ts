import type {
  RegistrySnapshotIndex,
  RegistrySnapshotPorts,
  SnapshotPluginFile,
} from "@nf-builder/lang-core";
import { RegistryError, readJson, request } from "./errors.ts";
import { parsePluginFile } from "./plugin.ts";
import { parseSnapshotPorts } from "./ports.ts";
import type {
  RegistryClient,
  RegistryFailure,
  RegistryIndex,
  RegistryReadOptions,
} from "./types.ts";

export interface SnapshotClientOptions {
  /** Absolute URL of the snapshot directory, ending in "/". */
  readonly snapshotUrl: string;
  readonly fetch?: typeof fetch;
}

export interface SnapshotRegistryClient extends RegistryClient {
  readonly source: "snapshot";
  /** The validated index.json: read once per client; `refresh` revalidates. */
  snapshot(options?: RegistryReadOptions): Promise<RegistrySnapshotIndex>;
}

/** Throws RegistryError("invalid") unless format 1 with a parseable generatedAt and module and plugin arrays. */
function parseSnapshotIndex(
  value: unknown,
  url: string,
): RegistrySnapshotIndex {
  const o = value as Record<string, unknown> | null;
  const bad = (why: string) =>
    new RegistryError("invalid", url, `Registry snapshot ${why}.`);
  if (typeof o !== "object" || o === null) throw bad("is not an object");
  if (o.format !== 1) throw bad(`has format ${String(o.format)}, not 1`);
  if (
    typeof o.generatedAt !== "string" ||
    Number.isNaN(Date.parse(o.generatedAt))
  ) {
    throw bad("has no readable generatedAt");
  }
  if (!Array.isArray(o.modules) || !Array.isArray(o.plugins)) {
    throw bad("has no modules or plugins list");
  }
  return o as unknown as RegistrySnapshotIndex;
}

export function fromSnapshot(
  index: RegistrySnapshotIndex,
  liveFailure: RegistryFailure | null = null,
): RegistryIndex {
  return {
    source: "snapshot",
    asOf: index.generatedAt,
    snapshotAt: index.generatedAt,
    language: index.language,
    nextflow: index.nextflow,
    modules: index.modules,
    plugins: index.plugins,
    liveFailure,
  };
}

export function createSnapshotClient(
  options: SnapshotClientOptions,
): SnapshotRegistryClient {
  // Called bare: `options.fetch(...)` as a method throws "Illegal invocation" in browsers.
  const doFetch = options.fetch ?? fetch;
  const url = new URL("index.json", options.snapshotUrl).href;
  let held: Promise<RegistrySnapshotIndex> | null = null;

  async function read(refresh: boolean): Promise<RegistrySnapshotIndex> {
    const response = await request(
      doFetch,
      url,
      { credentials: "omit", cache: refresh ? "no-cache" : "default" },
      "Registry snapshot",
    );
    if (response.status === 404 || response.status === 410) {
      throw new RegistryError(
        "unavailable",
        url,
        "No registry snapshot is available on this site.",
        response.status,
      );
    }
    return parseSnapshotIndex(
      await readJson(response, url, "Registry snapshot"),
      url,
    );
  }

  function snapshot(opts?: RegistryReadOptions) {
    if (opts?.refresh) {
      // Replace the held copy only when the new read succeeds.
      const next = read(true);
      void next.then(
        () => {
          held = next;
        },
        () => undefined,
      );
      return next;
    }
    if (!held) {
      const next = read(false);
      held = next;
      next.catch(() => {
        if (held === next) held = null;
      });
    }
    return held;
  }

  const portsUrl = new URL("ports.json", options.snapshotUrl).href;
  let heldPorts: Promise<RegistrySnapshotPorts> | null = null;
  let rereading: Promise<RegistrySnapshotPorts> | null = null;

  async function readPorts(refresh: boolean): Promise<RegistrySnapshotPorts> {
    const response = await request(
      doFetch,
      portsUrl,
      { credentials: "omit", cache: refresh ? "no-cache" : "default" },
      "Registry ports",
    );
    if (response.status === 404 || response.status === 410) {
      throw new RegistryError(
        "unavailable",
        portsUrl,
        "This registry snapshot has no ports file.",
        response.status,
      );
    }
    return parseSnapshotPorts(
      await readJson(response, portsUrl, "Registry ports"),
      portsUrl,
    );
  }

  /** The held ports.json, re-read once with no-cache when it isn't from the index's snapshot. */
  async function loadPorts(
    opts?: RegistryReadOptions,
  ): Promise<RegistrySnapshotPorts> {
    const generatedAt = (await snapshot(opts)).generatedAt;
    const current = heldPorts ?? readPorts(false);
    heldPorts = current;
    current.catch(() => {
      if (heldPorts === current) heldPorts = null;
    });
    const first = await current;
    if (first.generatedAt === generatedAt) return first;
    // Concurrent stale callers share one re-fetch.
    const next =
      rereading ??
      readPorts(true).finally(() => {
        rereading = null;
      });
    rereading = next;
    const again = await next;
    if (again.generatedAt !== generatedAt) {
      throw new RegistryError(
        "invalid",
        portsUrl,
        "Registry ports are out of step with the index.",
      );
    }
    heldPorts = next;
    return again;
  }

  const heldPlugins = new Map<string, Promise<SnapshotPluginFile>>();

  async function readPlugin(
    id: string,
    version: string,
  ): Promise<SnapshotPluginFile> {
    const pluginUrl = new URL(
      `plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}.json`,
      options.snapshotUrl,
    ).href;
    const response = await request(
      doFetch,
      pluginUrl,
      { credentials: "omit", cache: "default" },
      "Registry plugin spec",
    );
    if (response.status === 404 || response.status === 410) {
      throw new RegistryError(
        "unavailable",
        pluginUrl,
        `This registry snapshot has no spec for ${id} ${version}.`,
        response.status,
      );
    }
    return parsePluginFile(
      await readJson(response, pluginUrl, "Registry plugin spec"),
      pluginUrl,
      id,
      version,
    );
  }

  return {
    source: "snapshot",
    snapshot,
    plugin(id, version) {
      const key = `${id}@${version}`;
      let held = heldPlugins.get(key);
      if (!held) {
        const next = readPlugin(id, version);
        held = next;
        heldPlugins.set(key, next);
        next.catch(() => {
          if (heldPlugins.get(key) === next) heldPlugins.delete(key);
        });
      }
      return held;
    },
    async ports(name, opts) {
      return (await loadPorts(opts)).modules[name] ?? null;
    },
    async index(opts) {
      return fromSnapshot(await snapshot(opts));
    },
  };
}
