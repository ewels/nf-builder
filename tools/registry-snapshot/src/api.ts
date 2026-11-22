import type {
  ApiModule,
  ApiModuleRelease,
  ApiPlugin,
  ApiServiceInfo,
} from "./api-types.ts";

const DEFAULT_BASE = "https://registry.nextflow.io";

export class RegistryHttpError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number, detail?: string) {
    super(`${url} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "RegistryHttpError";
    this.url = url;
    this.status = status;
  }
}

export interface RegistryApiOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (message: string) => void;
  readonly maxAttempts?: number;
}

export interface RegistryApi {
  serviceInfo(): Promise<ApiServiceInfo>;
  /** Names of every process and workflow module, deduplicated. */
  listModules(): Promise<string[]>;
  getModule(name: string): Promise<ApiModule>;
  getModuleRelease(name: string, version: string): Promise<ApiModuleRelease>;
  /** The release's tar.gz: follows the registry's 307 to the blob store. */
  downloadModule(name: string, version: string): Promise<Uint8Array>;
  listPlugins(): Promise<string[]>;
  getPlugin(id: string): Promise<ApiPlugin>;
}

const PAGE_SIZE = 100;

export function createRegistryApi(
  options: RegistryApiOptions = {},
): RegistryApi {
  const base = `${options.baseUrl ?? DEFAULT_BASE}/api/v1`;
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => {});
  const maxAttempts = options.maxAttempts ?? 5;
  /** Milliseconds the registry asked us to wait before the next request (ratelimit-remaining reached 0). */
  let pendingDelay = 0;
  /** The last response's ratelimit-reset, in seconds. */
  let lastReset: number | null = null;

  /** GET with header-driven rate limiting, and retries with backoff on 429, 5xx and network errors. */
  async function get(
    url: string,
    redirect: "follow" | "manual" = "follow",
  ): Promise<Response> {
    let status = 0;
    let detail: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const retryDelay =
        attempt === 1 ? 0 : retryWait(attempt, status, lastReset);
      const wait = Math.max(pendingDelay, retryDelay);
      pendingDelay = 0;
      if (wait > 0) {
        log(`waiting ${wait} ms before ${url}`);
        await sleep(wait);
      }
      let response: Response;
      try {
        response = await doFetch(url, { redirect });
      } catch (error) {
        status = 0;
        detail = error instanceof Error ? error.message : String(error);
        lastReset = null;
        continue;
      }
      const reset = Number(response.headers.get("ratelimit-reset"));
      lastReset = Number.isFinite(reset) && reset > 0 ? reset : null;
      if (
        response.headers.get("ratelimit-remaining") === "0" &&
        lastReset !== null
      )
        pendingDelay = lastReset * 1000;
      status = response.status;
      if (status === 429 || status >= 500) {
        detail = undefined;
        continue;
      }
      if (status >= 400) throw new RegistryHttpError(url, status);
      return response;
    }
    throw new RegistryHttpError(url, status, detail);
  }
  function retryWait(
    attempt: number,
    status: number,
    reset: number | null,
  ): number {
    if (status === 429 && reset !== null) return reset * 1000;
    return 1000 * 2 ** (attempt - 2);
  }

  const json = async <T>(path: string): Promise<T> =>
    (await get(`${base}${path}`)).json() as Promise<T>;
  const enc = encodeURIComponent;

  async function listPaged<T extends { last?: boolean }>(
    path: string,
    kind: string | null,
  ): Promise<T[]> {
    const pages: T[] = [];
    for (let page = 1; ; page++) {
      const query = `size=${PAGE_SIZE}&page=${page}${kind ? `&kind=${kind}` : ""}`;
      const body = await json<T>(`${path}?${query}`);
      pages.push(body);
      if (body.last !== false) return pages;
    }
  }

  return {
    async serviceInfo() {
      return (await json<{ serviceInfo: ApiServiceInfo }>("/service-info"))
        .serviceInfo;
    },
    async listModules() {
      const names = new Set<string>();
      for (const kind of ["Process", "Workflow"])
        for (const page of await listPaged<{
          modules: { name: string }[];
          last?: boolean;
        }>("/modules/list", kind))
          for (const m of page.modules) names.add(m.name);
      return [...names];
    },
    async getModule(name) {
      return (await json<{ module: ApiModule }>(`/modules/${enc(name)}`))
        .module;
    },
    async getModuleRelease(name, version) {
      return (
        await json<{ release: ApiModuleRelease }>(
          `/modules/${enc(name)}/${enc(version)}`,
        )
      ).release;
    },
    async downloadModule(name, version) {
      const first = await get(
        `${base}/modules/${enc(name)}/${enc(version)}/download`,
        "manual",
      );
      const location = first.headers.get("location");
      const response =
        first.status >= 300 && location
          ? await get(new URL(location, first.url || base).href)
          : first;
      return new Uint8Array(await response.arrayBuffer());
    },
    async listPlugins() {
      const ids: string[] = [];
      for (const page of await listPaged<{
        plugins: { id: string }[];
        last?: boolean;
      }>("/plugins", null))
        for (const p of page.plugins) ids.push(p.id);
      return ids;
    },
    async getPlugin(id) {
      return (await json<{ plugin: ApiPlugin }>(`/plugins/${enc(id)}`)).plugin;
    },
  };
}
