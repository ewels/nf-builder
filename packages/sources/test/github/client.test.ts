import { describe, expect, it } from "vitest";
import {
  createGithubClient,
  type FetchLike,
  treeCandidates,
} from "../../src/github/client";
import { GithubError } from "../../src/github/errors";

// The responses are synthesised from the GitHub REST documentation: the sandbox can't call the API for other repositories.
const repo = { owner: "nf-core", name: "fetchngs" };
const SHA = "955c892d80927cee633765e6e390f9cc6b7235c9";

interface Call {
  url: string;
  init: RequestInit;
}

function fake(
  respond: (url: string, call: number) => Response | Promise<Response>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond(url, calls.length);
    },
  };
}

const tree = (over: object = {}) =>
  Response.json({
    sha: SHA,
    truncated: false,
    tree: [
      { path: "bin", mode: "040000", type: "tree", sha: "t" },
      { path: "bin/x.py", mode: "100755", type: "blob", sha: "b", size: 3 },
      { path: "link", mode: "120000", type: "blob", sha: "l", size: 4 },
      { path: "mod", mode: "160000", type: "commit", sha: "c" },
    ],
    ...over,
  });

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GithubError);
    return e as GithubError;
  }
  throw new Error("did not reject");
};

describe("GitHub client", () => {
  it("F-401 step 2 ADR-0009 IO-10: list makes exactly two API requests: commits/<encoded ref> with Accept vnd.github.sha, then git/trees/<sha>?recursive=1; no other request headers, credentials omitted", async () => {
    const f = fake((url) =>
      url.includes("/commits/") ? new Response(SHA) : tree(),
    );
    const listing = await createGithubClient({ fetch: f.fetch }).list({
      repo,
      ref: "1.13.0",
    });
    expect(listing.sha).toBe(SHA);
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/nf-core/fetchngs/commits/1.13.0",
      `https://api.github.com/repos/nf-core/fetchngs/git/trees/${SHA}?recursive=1`,
    ]);
    expect(f.calls.map((c) => c.init)).toEqual([
      {
        headers: { Accept: "application/vnd.github.sha" },
        credentials: "omit",
      },
      {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
      },
    ]);
  });

  it("F-401 IO-10: an empty ref resolves HEAD; a slashed branch is encoded as %2F", async () => {
    const f = fake(() => new Response(SHA));
    const client = createGithubClient({ fetch: f.fetch });
    await client.resolveRef(repo, null);
    await client.resolveRef(repo, "feat/F-001");
    expect(f.calls.map((c) => c.url.split("/commits/")[1])).toEqual([
      "HEAD",
      "feat%2FF-001",
    ]);
  });

  it("F-401 ADR-0009: listTree maps blobs, symlinks and submodules to candidates and drops trees; truncated is a truncated error", async () => {
    const client = createGithubClient({ fetch: fake(() => tree()).fetch });
    const entries = await client.listTree(repo, SHA);
    expect(treeCandidates(entries)).toEqual([
      { path: "bin/x.py", size: 3, kind: "file" },
      { path: "link", size: 4, kind: "symlink" },
      { path: "mod", size: null, kind: "submodule" },
    ]);
    const truncated = createGithubClient({
      fetch: fake(() => tree({ truncated: true })).fetch,
    });
    expect((await kindOf(truncated.listTree(repo, SHA))).kind).toBe(
      "truncated",
    );
  });

  it("F-401 IO-14: a null or malformed tree entry is an unexpected error, not a TypeError", async () => {
    for (const bad of [null, 7, "x"]) {
      const client = createGithubClient({
        fetch: fake(() => tree({ tree: [bad] })).fetch,
      });
      expect((await kindOf(client.listTree(repo, SHA))).kind).toBe(
        "unexpected",
      );
    }
  });

  it("F-401 IO-14: 404, 422, 409, 403 or 429 with remaining 0 (resetAt from x-ratelimit-reset), 403 without it (retry-after), a TypeError and a non-SHA body map to their kinds", async () => {
    const status = (s: number, headers: Record<string, string> = {}) =>
      createGithubClient({
        fetch: fake(() => new Response("{}", { status: s, headers })).fetch,
      }).resolveRef(repo, null);
    expect((await kindOf(status(404))).kind).toBe("not-found");
    expect((await kindOf(status(422))).kind).toBe("no-such-ref");
    expect((await kindOf(status(409))).kind).toBe("empty");
    const limited = await kindOf(
      status(403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1700000000",
      }),
    );
    expect([limited.kind, limited.resetAt]).toEqual([
      "rate-limited",
      1_700_000_000_000,
    ]);
    const limited429 = await kindOf(
      status(429, { "x-ratelimit-remaining": "0" }),
    );
    expect(limited429.kind).toBe("rate-limited");
    const refused = await kindOf(status(403, { "retry-after": "30" }));
    expect([refused.kind, refused.retryAfterSeconds]).toEqual(["refused", 30]);
    const offline = createGithubClient({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect((await kindOf(offline.resolveRef(repo, null))).kind).toBe("network");
    const odd = createGithubClient({
      fetch: fake(() => new Response("<html>")).fetch,
    });
    expect((await kindOf(odd.resolveRef(repo, null))).kind).toBe("unexpected");
  });

  describe("download", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `f/${i}.txt`,
      size: 3,
    }));
    const body = () => new Response(new Uint8Array([1, 2, 3]));

    it("F-401 step 1 IO-14: download keeps at most 8 requests in flight and reports progress", async () => {
      let flying = 0;
      let peak = 0;
      const f = fake(async () => {
        flying += 1;
        peak = Math.max(peak, flying);
        await new Promise((r) => setTimeout(r, 2));
        flying -= 1;
        return body();
      });
      const progress: number[] = [];
      const out = await createGithubClient({ fetch: f.fetch }).download(
        repo,
        SHA,
        files,
        { onProgress: (done, total) => progress.push(done * 100 + total) },
      );
      expect(peak).toBe(8);
      expect(out.map((o) => o.path)).toEqual(files.map((x) => x.path));
      expect(out[0]?.bytes.byteLength).toBe(3);
      expect(progress.at(-1)).toBe(20 * 100 + 20);
      expect(f.calls).toHaveLength(20);
    });

    it("F-401 IO-14: retries once on a network error or 5xx and never on 4xx", async () => {
      const one = [{ path: "a.txt", size: 3 }];
      const slept: number[] = [];
      const opts = (fetch: FetchLike) => ({
        fetch,
        sleep: async (ms: number) => {
          slept.push(ms);
        },
      });
      const flaky = fake((_, n) =>
        n === 1 ? new Response("", { status: 503 }) : body(),
      );
      await createGithubClient(opts(flaky.fetch)).download(repo, SHA, one);
      expect(flaky.calls).toHaveLength(2);
      expect(slept).toEqual([1000]);
      const dead = fake(() => new Response("", { status: 500 }));
      const e = await kindOf(
        createGithubClient(opts(dead.fetch)).download(repo, SHA, one),
      );
      expect([e.kind, e.status, dead.calls.length]).toEqual([
        "download",
        500,
        2,
      ]);
      const missing = fake(() => new Response("", { status: 404 }));
      const m = await kindOf(
        createGithubClient(opts(missing.fetch)).download(repo, SHA, one),
      );
      expect([m.kind, m.path, missing.calls.length]).toEqual([
        "download",
        "a.txt",
        1,
      ]);
      const limited = fake(() => new Response("", { status: 429 }));
      expect(
        (
          await kindOf(
            createGithubClient(opts(limited.fetch)).download(repo, SHA, one),
          )
        ).kind,
      ).toBe("rate-limited");
    });

    it("F-401 IO-14: a length that differs from the tree size is incomplete", async () => {
      const f = fake(() => new Response(new Uint8Array([1, 2])));
      const e = await kindOf(
        createGithubClient({ fetch: f.fetch }).download(repo, SHA, [
          { path: "a.txt", size: 3 },
        ]),
      );
      expect([e.kind, e.path]).toEqual(["incomplete", "a.txt"]);
    });

    it("F-401 IO-14: a content-length smaller than the decoded size (gzip hidden by CORS) is accepted", async () => {
      const f = fake(
        () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-length": "2" },
          }),
      );
      const got = await createGithubClient({ fetch: f.fetch }).download(
        repo,
        SHA,
        [{ path: "a.txt", size: 3 }],
      );
      expect(got.map((d) => [d.path, d.bytes.byteLength])).toEqual([
        ["a.txt", 3],
      ]);
    });

    it("F-401 IO-14: an abort stops everything", async () => {
      const controller = new AbortController();
      const f = fake(
        (_, n) =>
          new Promise<Response>((resolve, reject) => {
            if (n === 3) controller.abort();
            setTimeout(() => resolve(body()), 50);
            controller.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const e = await kindOf(
        createGithubClient({ fetch: f.fetch }).download(repo, SHA, files, {
          signal: controller.signal,
        }),
      );
      expect(e.kind).toBe("aborted");
      expect(f.calls.length).toBeLessThanOrEqual(8);
    });
  });
});
