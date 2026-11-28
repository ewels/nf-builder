import type { RegistrySnapshotIndex } from "@nf-builder/lang-core";
import { RegistryError, readJson, request } from "./errors.ts";
import { fromSnapshot, type SnapshotRegistryClient } from "./snapshot.ts";
import type {
  RegistryClient,
  RegistryIndex,
  RegistryModule,
  RegistryReadOptions,
} from "./types.ts";

const REGISTRY_URL = "https://registry.nextflow.io";

const PAGE_SIZE = 100;

export interface LiveModule {
  readonly name: string;
  readonly kind: "process" | "workflow";
  readonly description: string;
  readonly revoked: boolean;
}

export interface LiveLists {
  readonly modules: readonly LiveModule[];
  readonly pluginIds: readonly string[];
}

export interface LiveReadOptions {
  readonly registryUrl?: string; // REGISTRY_URL
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number; // 10_000
}

export interface LiveClientOptions extends LiveReadOptions {
  readonly snapshot: SnapshotRegistryClient;
  readonly now?: () => Date;
}

/** Pages 2..n are read this many at a time (the API allows 100 requests a minute). */
const MAX_IN_FLIGHT = 6;
/** Stops a listing that never says it is last. */
const MAX_PAGES = 200;

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * The live lists overlaid on the snapshot: snapshot details kept for modules still listed, unlisted modules added
 * with no version, revoked and missing modules dropped, plugins only pruned.
 */
export function overlayLive(
  snapshot: RegistrySnapshotIndex,
  live: LiveLists,
  asOf: string,
): RegistryIndex {
  const known = new Map(snapshot.modules.map((m) => [m.name, m]));
  const modules: RegistryModule[] = [];
  for (const m of live.modules) {
    if (m.revoked) continue;
    modules.push(
      known.get(m.name) ?? {
        name: m.name,
        version: null,
        kind: m.kind,
        component: null,
        typed: null,
        description: m.description,
        keywords: [],
      },
    );
  }
  modules.sort(byName);
  const ids = new Set(live.pluginIds);
  return {
    ...fromSnapshot(snapshot),
    source: "live",
    asOf,
    modules,
    plugins: snapshot.plugins.filter((p) => ids.has(p.id)),
  };
}

/** The live module and plugin lists, within one timeout. Processes and workflows are deduplicated by name. */
export async function readLiveLists(
  options: LiveReadOptions,
): Promise<LiveLists> {
  const doFetch = options.fetch ?? fetch;
  const base = `${options.registryUrl ?? REGISTRY_URL}/api/v1`;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);

  // A simple GET: no custom headers, so no preflight.
  const get = async (url: string) =>
    readJson(
      await request(
        doFetch,
        url,
        { credentials: "omit", signal },
        "Live registry",
      ),
      url,
      "Live registry",
    );

  const pageUrl = (path: string, kind: string, page: number) =>
    `${base}/${path}?size=${PAGE_SIZE}&page=${page}${kind ? `&kind=${kind}` : ""}`;

  async function readPage(
    path: string,
    key: string,
    kind: string,
    page: number,
  ) {
    const url = pageUrl(path, kind, page);
    const body = (await get(url)) as Record<string, unknown> | null;
    const list = body?.[key];
    if (!Array.isArray(list)) {
      throw new RegistryError(
        "invalid",
        url,
        `Live registry response has no "${key}" list.`,
      );
    }
    return { body, items: list as Record<string, unknown>[] };
  }

  /**
   * Every item under `key`: page 1, then (when it says there are more) the rest at most MAX_IN_FLIGHT at a time.
   * The page count comes from totalPages or totalSize; without either, pages are read in turn until one is last
   * or empty.
   */
  async function listAll(
    path: string,
    key: string,
    kind: string,
  ): Promise<Record<string, unknown>[]> {
    const first = await readPage(path, key, kind, 1);
    if (first.body?.last !== false) return first.items;
    const totalPages =
      typeof first.body.totalPages === "number"
        ? first.body.totalPages
        : typeof first.body.totalSize === "number"
          ? Math.ceil(first.body.totalSize / PAGE_SIZE)
          : null;
    const pages: Record<string, unknown>[][] = [first.items];
    if (totalPages === null) {
      for (let page = 2; page <= MAX_PAGES; page++) {
        const next = await readPage(path, key, kind, page);
        if (next.items.length === 0) break;
        pages.push(next.items);
        if (next.body?.last !== false) break;
      }
      return pages.flat();
    }
    const last = Math.min(totalPages, MAX_PAGES);
    let next = 2;
    const worker = async () => {
      while (next <= last) {
        const page = next++;
        pages[page - 1] = (await readPage(path, key, kind, page)).items;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_IN_FLIGHT, last - 1) }, worker),
    );
    return pages.flat();
  }

  const modules = (kind: "Process" | "Workflow") =>
    listAll("modules/list", "modules", kind).then((items) =>
      items.map(
        (m): LiveModule => ({
          name: String(m.name),
          kind: kind === "Process" ? "process" : "workflow",
          description: typeof m.description === "string" ? m.description : "",
          revoked: m.revoked === true,
        }),
      ),
    );
  const [processes, workflows, plugins] = await Promise.all([
    modules("Process"),
    modules("Workflow"),
    listAll("plugins", "plugins", ""),
  ]);
  const seen = new Set<string>();
  return {
    modules: [...processes, ...workflows].filter(
      (m) => !seen.has(m.name) && seen.add(m.name),
    ),
    pluginIds: plugins.map((p) => String(p.id)),
  };
}

export function createLiveClient(options: LiveClientOptions): RegistryClient {
  const now = options.now ?? (() => new Date());
  return {
    source: "live",
    ports: (name, opts) => options.snapshot.ports(name, opts),
    async index(opts?: RegistryReadOptions) {
      const snapshot = await options.snapshot.snapshot(opts);
      return overlayLive(
        snapshot,
        await readLiveLists(options),
        now().toISOString(),
      );
    },
  };
}
