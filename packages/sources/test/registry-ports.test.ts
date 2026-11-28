import { describe, expect, it } from "vitest";
import { createRegistryClient, createSnapshotClient } from "../src/index";
import {
  fakeFetch,
  goldenText,
  jsonResponse,
  portsGolden,
  portsText,
  rejection,
  SNAPSHOT_URL,
  serve,
} from "./helpers";

const PORTS = `${SNAPSHOT_URL}ports.json`;
const portsCalls = (f: { calls: { url: string; init?: RequestInit }[] }) =>
  f.calls.filter((c) => c.url === PORTS);

describe("registry ports", () => {
  it("F-503 ADR-0050: ports(nf-core/fastqc) reads ports.json once under snapshotUrl and returns its meta.yml ports; a second call makes no request", async () => {
    const f = serve();
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    const ports = await client.ports("nf-core/fastqc");
    expect(ports?.inputs).toEqual([["meta:map", "reads:file"]]);
    expect(ports?.outputs.map((o) => o.name)).toEqual([
      "html",
      "zip",
      "versions_fastqc",
    ]);
    expect(portsCalls(f)).toHaveLength(1);
    const before = f.calls.length;
    await client.ports("nextflow-io/hello");
    expect(f.calls).toHaveLength(before);
  });

  it("F-503 ADR-0050: ports of a name the file lacks resolves null", async () => {
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: serve().fetch,
    });
    expect(await client.ports("nf-core/newtool")).toBeNull();
  });

  it("F-503 IO-30: ports.json 404 rejects with unavailable; a non-JSON or format 2 body with invalid", async () => {
    const make = (response: () => Response) =>
      createSnapshotClient({
        snapshotUrl: SNAPSHOT_URL,
        fetch: serve((url) => (url === PORTS ? response() : undefined)).fetch,
      });
    const missing = await rejection(
      make(() => jsonResponse("<html>", "text/html", 404)).ports("a/b"),
    );
    expect(missing.code).toBe("unavailable");
    expect(missing.message).toBe("This registry snapshot has no ports file.");
    expect(
      (
        await rejection(
          make(() => jsonResponse("<html>", "text/html")).ports("a/b"),
        )
      ).code,
    ).toBe("invalid");
    expect(
      (
        await rejection(
          make(() =>
            jsonResponse(JSON.stringify({ ...portsGolden(), format: 2 })),
          ).ports("a/b"),
        )
      ).code,
    ).toBe("invalid");
  });

  it("F-503 IO-30: a ports generatedAt that differs from the index re-reads once with cache no-cache, then rejects invalid if it still differs", async () => {
    const stale = JSON.stringify({
      ...portsGolden(),
      generatedAt: "2026-11-01T00:00:00.000Z",
    });
    const still = serve((url) =>
      url === PORTS ? jsonResponse(stale) : undefined,
    );
    const e = await rejection(
      createSnapshotClient({
        snapshotUrl: SNAPSHOT_URL,
        fetch: still.fetch,
      }).ports("nf-core/fastqc"),
    );
    expect(e.code).toBe("invalid");
    expect(e.message).toBe("Registry ports are out of step with the index.");
    const reads = portsCalls(still);
    expect(reads).toHaveLength(2);
    expect(reads[1]?.init?.cache).toBe("no-cache");

    let n = 0;
    const heals = serve((url) =>
      url === PORTS ? jsonResponse(n++ === 0 ? stale : portsText()) : undefined,
    );
    const ports = await createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: heals.fetch,
    }).ports("nf-core/fastqc");
    expect(ports).not.toBeNull();
    expect(portsCalls(heals)).toHaveLength(2);
  });

  it("F-503 ADR-0050: with live on, ports() reads only the snapshot and requests nothing from registry.nextflow.io", async () => {
    const f = fakeFetch((url) =>
      url === PORTS
        ? jsonResponse(portsText())
        : url.startsWith(SNAPSHOT_URL)
          ? jsonResponse(goldenText())
          : jsonResponse("{}", "application/json", 500),
    );
    const client = createRegistryClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
      live: true,
      registryUrl: "https://registry.test",
    });
    expect(await client.ports("nf-core/fastqc")).not.toBeNull();
    expect(f.calls.every((c) => c.url.startsWith(SNAPSHOT_URL))).toBe(true);
  });
});
