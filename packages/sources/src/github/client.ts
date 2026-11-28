import type { PlanCandidate, PlannedFile } from "../import/plan.ts";
import { errorFromResponse, GithubError } from "./errors.ts";
import type { RepoInput, RepoRef } from "./repo.ts";
import { commitUrl, rawUrl, treeUrl } from "./urls.ts";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: "blob" | "tree" | "commit";
  readonly sha: string;
  readonly size: number | null;
}

export interface RepoListing {
  readonly repo: RepoRef;
  readonly ref: string | null;
  readonly sha: string;
  readonly entries: readonly TreeEntry[];
}

export interface DownloadedFile {
  readonly path: string;
  readonly bytes: ArrayBuffer;
}

export interface DownloadOptions {
  readonly signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface GithubClient {
  resolveRef(
    r: RepoRef,
    ref: string | null,
    signal?: AbortSignal,
  ): Promise<string>;
  listTree(r: RepoRef, sha: string, signal?: AbortSignal): Promise<TreeEntry[]>;
  list(input: RepoInput, signal?: AbortSignal): Promise<RepoListing>;
  download(
    r: RepoRef,
    sha: string,
    files: readonly PlannedFile[],
    o?: DownloadOptions,
  ): Promise<DownloadedFile[]>;
}

export interface GithubClientOptions {
  readonly fetch: FetchLike;
  readonly concurrency?: number;
  readonly retryDelayMs?: number;
  sleep?(ms: number): Promise<void>;
}

const isAbort = (error: unknown): boolean =>
  (error as { name?: string } | null)?.name === "AbortError";

export function treeCandidates(entries: readonly TreeEntry[]): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  for (const e of entries) {
    if (e.type === "commit")
      out.push({ path: e.path, size: null, kind: "submodule" });
    else if (e.type === "blob")
      out.push({
        path: e.path,
        size: e.size,
        kind: e.mode === "120000" ? "symlink" : "file",
      });
  }
  return out;
}

export function createGithubClient(o: GithubClientOptions): GithubClient {
  const concurrency = o.concurrency ?? 8;
  const retryDelayMs = o.retryDelayMs ?? 1000;
  const sleep =
    o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function get(
    url: string,
    accept: string,
    host: "api" | "raw",
    path: string | null,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await o.fetch(url, {
        headers: { Accept: accept },
        credentials: "omit",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (isAbort(error) || signal?.aborted === true)
        throw new GithubError("aborted", "Cancelled.", { host, path });
      throw new GithubError("network", "Couldn't reach GitHub.", {
        host,
        path,
      });
    }
    if (!res.ok) throw errorFromResponse(res, host, path);
    return res;
  }

  async function resolveRef(
    r: RepoRef,
    ref: string | null,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await get(
      commitUrl(r, ref),
      "application/vnd.github.sha",
      "api",
      null,
      signal,
    );
    const body = (await res.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(body))
      throw new GithubError("unexpected", "GitHub returned no commit SHA.", {
        status: res.status,
      });
    return body;
  }

  async function listTree(
    r: RepoRef,
    sha: string,
    signal?: AbortSignal,
  ): Promise<TreeEntry[]> {
    const res = await get(
      treeUrl(r, sha),
      "application/vnd.github+json",
      "api",
      null,
      signal,
    );
    let body: { truncated?: boolean; tree?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new GithubError(
        "unexpected",
        "GitHub returned an unreadable tree.",
      );
    }
    if (body.truncated === true)
      throw new GithubError("truncated", "The listing is truncated.");
    if (!Array.isArray(body.tree))
      throw new GithubError("unexpected", "GitHub returned no tree.");
    return body.tree.map((e: unknown): TreeEntry => {
      if (typeof e !== "object" || e === null)
        throw new GithubError(
          "unexpected",
          "GitHub returned a bad tree entry.",
        );
      const entry = e as Record<string, unknown>;
      return {
        path: String(entry.path),
        mode: String(entry.mode),
        type: entry.type as TreeEntry["type"],
        sha: String(entry.sha),
        size: typeof entry.size === "number" ? entry.size : null,
      };
    });
  }

  async function fetchOne(
    r: RepoRef,
    sha: string,
    file: PlannedFile,
    signal: AbortSignal,
  ): Promise<DownloadedFile> {
    const url = rawUrl(r, sha, file.path);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await get(url, "*/*", "raw", file.path, signal);
        const incomplete = () =>
          new GithubError("incomplete", `${file.path} is incomplete.`, {
            host: "raw",
            path: file.path,
          });
        // refuse a body that is too long before it is held in memory; with a content-encoding the header counts encoded bytes
        const length = res.headers.get("content-length");
        if (
          length !== null &&
          res.headers.get("content-encoding") === null &&
          Number(length) !== file.size
        )
          throw incomplete();
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength !== file.size) throw incomplete();
        return { path: file.path, bytes };
      } catch (error) {
        const retryable =
          error instanceof GithubError &&
          (error.kind === "network" ||
            (error.kind === "download" && (error.status ?? 0) >= 500));
        if (!retryable || attempt >= 1) throw error;
        await sleep(retryDelayMs);
      }
    }
  }

  async function download(
    r: RepoRef,
    sha: string,
    files: readonly PlannedFile[],
    opts: DownloadOptions = {},
  ): Promise<DownloadedFile[]> {
    const inner = new AbortController();
    const outer = opts.signal;
    const onAbort = () => inner.abort();
    if (outer?.aborted === true) inner.abort();
    outer?.addEventListener("abort", onAbort);
    const results: DownloadedFile[] = new Array(files.length);
    let next = 0;
    let done = 0;
    const state: { failure: GithubError | null } = { failure: null };
    const record = (e: GithubError): void => {
      if (state.failure === null || state.failure.kind === "aborted")
        state.failure = e;
    };
    const worker = async (): Promise<void> => {
      while (state.failure === null && next < files.length) {
        const index = next;
        next += 1;
        const file = files[index];
        if (file === undefined) return;
        try {
          if (inner.signal.aborted)
            throw new GithubError("aborted", "Cancelled.", { host: "raw" });
          results[index] = await fetchOne(r, sha, file, inner.signal);
          done += 1;
          opts.onProgress?.(done, files.length);
        } catch (error) {
          const e =
            error instanceof GithubError
              ? error
              : new GithubError("unexpected", String(error), { host: "raw" });
          // The first real failure wins over the aborts it causes.
          record(e);
          inner.abort();
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, files.length) }, worker),
      );
    } finally {
      outer?.removeEventListener("abort", onAbort);
    }
    if (state.failure !== null) throw state.failure;
    return results;
  }

  return {
    resolveRef,
    listTree,
    async list(input, signal) {
      const sha = await resolveRef(input.repo, input.ref, signal);
      const entries = await listTree(input.repo, sha, signal);
      return { repo: input.repo, ref: input.ref, sha, entries };
    },
    download,
  };
}
