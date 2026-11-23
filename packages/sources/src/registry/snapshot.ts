import type { RegistrySnapshotIndex } from "@nf-builder/lang-core";
import { RegistryError } from "./errors.ts";
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
export function parseSnapshotIndex(
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
    let response: Response;
    try {
      response = await doFetch(url, {
        credentials: "omit",
        cache: refresh ? "no-cache" : "default",
      });
    } catch (error) {
      throw new RegistryError(
        "network",
        url,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (response.status === 404 || response.status === 410) {
      throw new RegistryError(
        "unavailable",
        url,
        "No registry snapshot is available on this site.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new RegistryError(
        "http",
        url,
        `Registry snapshot request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      throw new RegistryError(
        "invalid",
        url,
        `Registry snapshot has content type "${type}", not JSON.`,
        response.status,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RegistryError(
        "invalid",
        url,
        "Registry snapshot is not valid JSON.",
      );
    }
    return parseSnapshotIndex(body, url);
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

  return {
    source: "snapshot",
    snapshot,
    async index(opts) {
      return fromSnapshot(await snapshot(opts));
    },
  };
}
