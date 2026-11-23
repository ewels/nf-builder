import type { RegistrySnapshotIndex } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  createLiveClient,
  createSnapshotClient,
  overlayLive,
} from "../src/index";
import {
  fakeFetch,
  fixture,
  golden,
  jsonResponse,
  rejection,
  SNAPSHOT_URL,
  serve,
} from "./helpers";

const REGISTRY = "https://registry.test";
const NOW = new Date("2026-11-23T10:00:00.000Z");

const liveClient = (f: ReturnType<typeof serve>, timeoutMs?: number) =>
  createLiveClient({
    snapshot: createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    }),
    registryUrl: REGISTRY,
    fetch: f.fetch,
    now: () => NOW,
    timeoutMs,
  });

describe("registry live client", () => {
  it("F-502 IO-30 ADR-0009: the live client pages modules/list for kind Process and Workflow and plugins with size 100 until last, as OpenAPI 0.14.0 describes", async () => {
    const page2 = JSON.parse(fixture("plugins-1.json")) as Record<
      string,
      unknown
    >;
    const f = serve((url) => {
      if (url.includes("/plugins?size=100&page=1"))
        return jsonResponse(JSON.stringify({ ...page2, last: false }));
      if (url.includes("/plugins?size=100&page=2"))
        return jsonResponse(
          JSON.stringify({ plugins: [{ id: "nf-more" }], last: true }),
        );
      return undefined;
    });
    const client = liveClient(f);
    expect(client.source).toBe("live");
    await client.index();
    expect(
      f.calls
        .map((c) => c.url)
        .filter((u) => u.startsWith(REGISTRY))
        .sort(),
    ).toEqual([
      `${REGISTRY}/api/v1/modules/list?size=100&page=1&kind=Process`,
      `${REGISTRY}/api/v1/modules/list?size=100&page=1&kind=Workflow`,
      `${REGISTRY}/api/v1/plugins?size=100&page=1`,
      `${REGISTRY}/api/v1/plugins?size=100&page=2`,
    ]);
  });

  it("F-502 IO-30: the overlay keeps snapshot details for modules still listed, adds unlisted ones with version, component and typed null, drops revoked and missing modules, and only prunes plugins", async () => {
    const snapshot = golden() as unknown as RegistrySnapshotIndex;
    const index = overlayLive(
      snapshot,
      {
        modules: [
          {
            name: "nf-core/fastqc",
            kind: "process",
            description: "live text",
            revoked: false,
          },
          {
            name: "nf-core/newtool",
            kind: "workflow",
            description: "New",
            revoked: false,
          },
          {
            name: "nf-core/gone",
            kind: "process",
            description: "Revoked",
            revoked: true,
          },
        ],
        pluginIds: ["nf-schema", "nf-brand-new"],
      },
      "2026-11-23T10:00:00.000Z",
    );
    expect(index.source).toBe("live");
    expect(index.asOf).toBe("2026-11-23T10:00:00.000Z");
    expect(index.snapshotAt).toBe(snapshot.generatedAt);
    expect(index.liveFailure).toBeNull();
    expect(index.modules.map((m) => m.name)).toEqual([
      "nf-core/fastqc",
      "nf-core/newtool",
    ]);
    expect(index.modules[0]).toEqual(snapshot.modules[2]);
    expect(index.modules[1]).toEqual({
      name: "nf-core/newtool",
      version: null,
      kind: "workflow",
      component: null,
      typed: null,
      description: "New",
      keywords: [],
    });
    expect(index.plugins).toEqual([snapshot.plugins[1]]);
  });

  it("F-502 IO-30: live requests are simple GETs: no custom headers and credentials omitted, so no preflight", async () => {
    const f = serve();
    await liveClient(f).index();
    const live = f.calls.filter((c) => c.url.startsWith(REGISTRY));
    expect(live).toHaveLength(3);
    for (const c of live) {
      expect(c.init?.credentials).toBe("omit");
      expect(c.init?.headers).toBeUndefined();
      expect(c.init?.method ?? "GET").toBe("GET");
    }
  });

  it("F-502 IO-30: a TypeError (as CORS gives), HTTP 429 or 5xx, a non-JSON body or the timeout rejects with network, http, invalid or timeout", async () => {
    const live = (url: string) => url.startsWith(REGISTRY);
    const cors = serve((url) => {
      if (live(url)) throw new TypeError("Failed to fetch");
    });
    expect((await rejection(liveClient(cors).index())).code).toBe("network");

    for (const status of [429, 503]) {
      const f = serve((url) =>
        live(url) ? jsonResponse("{}", "application/json", status) : undefined,
      );
      const e = await rejection(liveClient(f).index());
      expect(e.code).toBe("http");
      expect(e.status).toBe(status);
    }

    const html = serve((url) =>
      live(url) ? jsonResponse("<html>", "text/html") : undefined,
    );
    expect((await rejection(liveClient(html).index())).code).toBe("invalid");

    const shape = serve((url) =>
      live(url)
        ? jsonResponse(JSON.stringify({ unexpected: true }))
        : undefined,
    );
    expect((await rejection(liveClient(shape).index())).code).toBe("invalid");

    const hang = serve();
    const slow = fakeFetch((url, init) =>
      live(url)
        ? new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          })
        : hang.fetch(url, init),
    );
    expect((await rejection(liveClient(slow, 20).index())).code).toBe(
      "timeout",
    );
  });
});
