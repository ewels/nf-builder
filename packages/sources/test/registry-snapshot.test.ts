import { describe, expect, it } from "vitest";
import { createSnapshotClient, RegistryError } from "../src/index";
import {
  fakeFetch,
  golden,
  goldenText,
  jsonResponse,
  rejection,
  SNAPSHOT_URL,
} from "./helpers";

const serving = () => fakeFetch(() => jsonResponse(goldenText()));

describe("registry snapshot client", () => {
  it("F-502 IO-30 IO-31: the snapshot client reads index.json under snapshotUrl and returns its modules and plugins as source snapshot, with asOf and snapshotAt = generatedAt", async () => {
    const f = serving();
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    const index = await client.index();
    expect(f.calls.map((c) => c.url)).toEqual([`${SNAPSHOT_URL}index.json`]);
    expect(client.source).toBe("snapshot");
    expect(index.source).toBe("snapshot");
    expect(index.asOf).toBe("2026-11-22T00:00:00.000Z");
    expect(index.snapshotAt).toBe(index.asOf);
    expect(index.liveFailure).toBeNull();
    expect(index.modules.map((m) => m.name)).toEqual([
      "nextflow-io/hello",
      "nf-core/bam_applybqsr",
      "nf-core/fastqc",
    ]);
    expect(index.plugins.map((p) => p.id)).toEqual(["nf-ffq", "nf-schema"]);
  });

  it("F-502 IO-30 ADR-0035: a 404 rejects with code unavailable; a 500 with code http", async () => {
    const a = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: fakeFetch(() => jsonResponse("<html>", "text/html", 404)).fetch,
    });
    expect((await rejection(a.index())).code).toBe("unavailable");
    const b = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: fakeFetch(() => jsonResponse("{}", "application/json", 500)).fetch,
    });
    const e = await rejection(b.index());
    expect(e).toBeInstanceOf(RegistryError);
    expect(e.code).toBe("http");
    expect(e.status).toBe(500);
  });

  it("F-502 IO-30 ADR-0040: an HTML 200, unparsable JSON, format 2 or a bad generatedAt each reject with code invalid", async () => {
    const bodies: [string, string][] = [
      ["<html></html>", "text/html; charset=utf-8"],
      ["{not json", "application/json"],
      [JSON.stringify({ ...golden(), format: 2 }), "application/json"],
      [
        JSON.stringify({ ...golden(), generatedAt: "yesterday" }),
        "application/json",
      ],
      [JSON.stringify({ ...golden(), modules: {} }), "application/json"],
    ];
    for (const [body, type] of bodies) {
      const client = createSnapshotClient({
        snapshotUrl: SNAPSHOT_URL,
        fetch: fakeFetch(() => jsonResponse(body, type)).fetch,
      });
      expect((await rejection(client.index())).code).toBe("invalid");
    }
  });

  it("F-502 IO-30: a rejected fetch rejects with code network", async () => {
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: fakeFetch(() => {
        throw new TypeError("Failed to fetch");
      }).fetch,
    });
    const e = await rejection(client.index());
    expect(e.code).toBe("network");
    expect(e.message).toContain("Failed to fetch");
  });

  it("F-502 UX-14: one request per client; a rejected read is forgotten; refresh re-reads with cache no-cache and replaces the copy only on success", async () => {
    let fail = true;
    let generatedAt = "2026-11-22T00:00:00.000Z";
    const f = fakeFetch(() =>
      fail
        ? jsonResponse("x", "text/html", 404)
        : jsonResponse(JSON.stringify({ ...golden(), generatedAt })),
    );
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    await rejection(client.index());
    fail = false;
    const first = await client.index();
    expect(f.calls).toHaveLength(2);
    await client.index();
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]?.init?.cache).toBe("default");

    generatedAt = "2026-11-23T00:00:00.000Z";
    const refreshed = await client.index({ refresh: true });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]?.init?.cache).toBe("no-cache");
    expect(refreshed.asOf).toBe(generatedAt);
    expect((await client.index()).asOf).toBe(generatedAt);

    fail = true;
    await rejection(client.index({ refresh: true }));
    expect((await client.index()).asOf).toBe(generatedAt);
    expect(first.asOf).toBe("2026-11-22T00:00:00.000Z");
  });

  it("F-502 IO-30: requests omit credentials", async () => {
    const f = serving();
    await createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    }).index();
    expect(f.calls[0]?.init?.credentials).toBe("omit");
  });
});
