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

export interface LiveClientOptions {
  readonly snapshot: SnapshotRegistryClient;
  readonly registryUrl?: string; // REGISTRY_URL
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number; // 10_000
  readonly now?: () => Date;
}

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

export function createLiveClient(options: LiveClientOptions): RegistryClient {
  const doFetch = options.fetch ?? fetch;
  const base = `${options.registryUrl ?? REGISTRY_URL}/api/v1`;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const now = options.now ?? (() => new Date());

  // A simple GET: no custom headers, so no preflight.
  const get = async (url: string, signal: AbortSignal) =>
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

  /** Every item under `key` of every page, until a page says `last`. */
  async function listAll(
    path: string,
    key: string,
    kind: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    for (let page = 1; ; page++) {
      const url = `${base}/${path}?size=${PAGE_SIZE}&page=${page}${kind ? `&kind=${kind}` : ""}`;
      const body = (await get(url, signal)) as Record<string, unknown> | null;
      const list = body?.[key];
      if (!Array.isArray(list)) {
        throw new RegistryError(
          "invalid",
          url,
          `Live registry response has no "${key}" list.`,
        );
      }
      items.push(...(list as Record<string, unknown>[]));
      if (body?.last !== false) return items;
    }
  }

  async function lists(signal: AbortSignal): Promise<LiveLists> {
    const module = (kind: "Process" | "Workflow") =>
      listAll("modules/list", "modules", kind, signal).then((items) =>
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
      module("Process"),
      module("Workflow"),
      listAll("plugins", "plugins", "", signal),
    ]);
    return {
      modules: [...processes, ...workflows],
      pluginIds: plugins.map((p) => String(p.id)),
    };
  }

  return {
    source: "live",
    async index(opts?: RegistryReadOptions) {
      const snapshot = await options.snapshot.snapshot(opts);
      const live = await lists(AbortSignal.timeout(timeoutMs));
      return overlayLive(snapshot, live, now().toISOString());
    },
  };
}
