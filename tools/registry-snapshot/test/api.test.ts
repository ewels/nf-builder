import { describe, expect, it } from "vitest";
import { createRegistryApi, RegistryHttpError } from "../src/api.ts";

const BASE = "https://registry.example/api/v1";

type Reply = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
};

/** A fake fetch that answers from a queue per URL and records every call. */
function fake(replies: Record<string, Reply[]>) {
  const calls: string[] = [];
  const events: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    events.push(`GET ${url}`);
    const queue = replies[url];
    const reply = queue?.length
      ? queue.length > 1
        ? queue.shift()
        : queue[0]
      : undefined;
    if (!reply) throw new Error(`unexpected request ${url}`);
    const body =
      reply.body === undefined || reply.body instanceof Uint8Array
        ? (reply.body as Uint8Array | undefined)
        : JSON.stringify(reply.body);
    return new Response(reply.status === 307 ? null : body, {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as typeof globalThis.fetch;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    events.push(`sleep ${ms}`);
  };
  return { fetch, sleep, calls, sleeps, events };
}

const summary = (name: string) => ({ name });
const page = (names: string[], last: boolean) => ({
  body: { modules: names.map(summary), last },
});

describe("F-501 registry API client", () => {
  it("F-501 IO-31: listModules pages through kind=Process and kind=Workflow until last", async () => {
    const f = fake({
      [`${BASE}/modules/list?size=100&page=1&kind=Process`]: [
        page(["a/x", "a/y"], false),
      ],
      [`${BASE}/modules/list?size=100&page=2&kind=Process`]: [
        page(["a/y", "a/z"], true),
      ],
      [`${BASE}/modules/list?size=100&page=1&kind=Workflow`]: [
        page(["a/w"], true),
      ],
    });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    expect(await api.listModules()).toEqual(["a/x", "a/y", "a/z", "a/w"]);
    expect(f.calls).toEqual([
      `${BASE}/modules/list?size=100&page=1&kind=Process`,
      `${BASE}/modules/list?size=100&page=2&kind=Process`,
      `${BASE}/modules/list?size=100&page=1&kind=Workflow`,
    ]);
  });

  it("F-501 ADR-0009: module names are %2F-encoded in every path", async () => {
    const name = "nf-core/samtools/merge";
    const enc = "nf-core%2Fsamtools%2Fmerge";
    const f = fake({
      [`${BASE}/modules/${enc}`]: [{ body: { module: { name } } }],
      [`${BASE}/modules/${enc}/0.0.0-df69bf6`]: [
        { body: { release: { version: "0.0.0-df69bf6" } } },
      ],
      [`${BASE}/modules/${enc}/0.0.0-df69bf6/download`]: [
        { status: 307, headers: { location: "https://blobs.example/x" } },
      ],
      "https://blobs.example/x": [{ body: new Uint8Array([1]) }],
    });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    expect((await api.getModule(name)).name).toBe(name);
    expect((await api.getModuleRelease(name, "0.0.0-df69bf6")).version).toBe(
      "0.0.0-df69bf6",
    );
    await api.downloadModule(name, "0.0.0-df69bf6");
    expect(
      f.calls
        .slice(0, 3)
        .every((u) => u.includes(enc) && !u.includes("samtools/merge")),
    ).toBe(true);
  });

  it("F-501: waits ratelimit-reset seconds when ratelimit-remaining reaches 0; retries 429 and 5xx with backoff", async () => {
    const url = `${BASE}/service-info`;
    const f = fake({
      [url]: [
        {
          body: { serviceInfo: { version: "1" } },
          headers: { "ratelimit-remaining": "0", "ratelimit-reset": "7" },
        },
        { status: 500 },
        { status: 429, headers: { "ratelimit-reset": "3" } },
        { body: { serviceInfo: { version: "2" } } },
      ],
    });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    expect(await api.serviceInfo()).toEqual({ version: "1" });
    expect(f.events).toEqual([`GET ${url}`]);
    expect(await api.serviceInfo()).toEqual({ version: "2" });
    // The 0-remaining response delays the next call by 7 s; the 500 then backs off 1 s; the 429 waits its 3 s.
    expect(f.events).toEqual([
      `GET ${url}`,
      "sleep 7000",
      `GET ${url}`,
      "sleep 1000",
      `GET ${url}`,
      "sleep 3000",
      `GET ${url}`,
    ]);
  });

  it("F-501: gives up after 5 attempts with a RegistryHttpError naming the URL and status", async () => {
    const url = `${BASE}/modules/nf-core%2Ftiara%2Ftiara`;
    const f = fake({ [url]: [{ status: 500 }] });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    const error = await api
      .getModule("nf-core/tiara/tiara")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryHttpError);
    expect(error).toMatchObject({ url, status: 500 });
    expect((error as Error).message).toContain(url);
    expect((error as Error).message).toContain("500");
    expect(f.calls).toHaveLength(5);
    expect(f.sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it("F-501: a 404 is not retried", async () => {
    const url = `${BASE}/plugins/nope`;
    const f = fake({ [url]: [{ status: 404 }] });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    await expect(api.getPlugin("nope")).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(1);
  });

  it("F-501: downloadModule follows the 307 to the blob", async () => {
    const enc = "nf-core%2Ffastqc";
    const f = fake({
      [`${BASE}/modules/${enc}/1/download`]: [
        { status: 307, headers: { location: "https://blobs.example/b" } },
      ],
      "https://blobs.example/b": [{ body: new Uint8Array([1, 2, 3]) }],
    });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    expect([...(await api.downloadModule("nf-core/fastqc", "1"))]).toEqual([
      1, 2, 3,
    ]);
    expect(f.calls).toEqual([
      `${BASE}/modules/${enc}/1/download`,
      "https://blobs.example/b",
    ]);
  });

  it("F-501: listPlugins pages through /plugins and getPlugin unwraps the plugin", async () => {
    const f = fake({
      [`${BASE}/plugins?size=100&page=1`]: [
        { body: { plugins: [{ id: "nf-a" }, { id: "nf-b" }], last: true } },
      ],
      [`${BASE}/plugins/nf-a`]: [
        { body: { plugin: { id: "nf-a", releases: [] } } },
      ],
    });
    const api = createRegistryApi({
      baseUrl: "https://registry.example",
      fetch: f.fetch,
      sleep: f.sleep,
    });
    expect(await api.listPlugins()).toEqual(["nf-a", "nf-b"]);
    expect(await api.getPlugin("nf-a")).toEqual({ id: "nf-a", releases: [] });
  });
});
