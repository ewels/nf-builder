import { describe, expect, it } from "vitest";
import {
  createRegistryClient,
  LIVE_REGISTRY,
  RegistryError,
  toFailure,
} from "../src/index";
import { jsonResponse, rejection, SNAPSHOT_URL, serve } from "./helpers";

const REGISTRY = "https://registry.test";
const NOW = new Date("2026-11-23T10:00:00.000Z");
const make = (f: ReturnType<typeof serve>, live: boolean) =>
  createRegistryClient({
    snapshotUrl: SNAPSHOT_URL,
    fetch: f.fetch,
    live,
    registryUrl: REGISTRY,
    now: () => NOW,
  });

describe("registry client", () => {
  it("F-502 step 1 IO-30 ADR-0009: with live off, index() reads only the snapshot and requests nothing from registry.nextflow.io", async () => {
    const f = serve();
    const index = await make(f, false).index();
    expect(index.source).toBe("snapshot");
    expect(f.calls.map((c) => c.url)).toEqual([`${SNAPSHOT_URL}index.json`]);
  });

  it("F-502 step 2 IO-30: with live on and the registry answering, index() returns source live and asOf = now", async () => {
    const index = await make(serve(), true).index();
    expect(index.source).toBe("live");
    expect(index.asOf).toBe(NOW.toISOString());
    expect(index.snapshotAt).toBe("2026-11-22T00:00:00.000Z");
    expect(index.modules.map((m) => m.name)).toEqual([
      "nextflow-io/hello",
      "nf-core/bam_applybqsr",
      "nf-core/fastqc",
      "nf-core/newtool",
    ]);
  });

  it("F-502 step 1 IO-30: with live on and the registry failing, index() falls back to the snapshot and sets liveFailure", async () => {
    const f = serve((url) => {
      if (url.startsWith(REGISTRY)) throw new TypeError("Failed to fetch");
    });
    const index = await make(f, true).index();
    expect(index.source).toBe("snapshot");
    expect(index.asOf).toBe("2026-11-22T00:00:00.000Z");
    expect(index.liveFailure?.code).toBe("network");
    expect(index.modules).toHaveLength(3);
  });

  it("F-502 IO-30: when the snapshot fails, index() rejects with its error, even with live on", async () => {
    const f = serve((url) =>
      url.startsWith(SNAPSHOT_URL)
        ? jsonResponse("<html>", "text/html", 404)
        : undefined,
    );
    expect((await rejection(make(f, true).index())).code).toBe("unavailable");
  });

  it("F-502 ADR-0050: LIVE_REGISTRY is off until the registry sends CORS headers", () => {
    expect(LIVE_REGISTRY).toBe(false);
  });

  it("F-502 IO-30: one refresh with live on makes exactly one snapshot request", async () => {
    const f = serve();
    await make(f, true).index({ refresh: true });
    expect(f.calls.filter((c) => c.url.startsWith(SNAPSHOT_URL))).toHaveLength(
      1,
    );
  });

  it("F-502 IO-30: toFailure maps RegistryError as is, a TypeError to network and any other error to invalid", () => {
    expect(toFailure(new RegistryError("http", "u", "m", 500))).toEqual({
      code: "http",
      message: "m",
    });
    expect(toFailure(new TypeError("Failed to fetch")).code).toBe("network");
    expect(toFailure(new RangeError("bug")).code).toBe("invalid");
    expect(toFailure("odd")).toEqual({ code: "invalid", message: "odd" });
  });
});
