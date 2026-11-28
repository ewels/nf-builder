import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createLiveClient,
  createRegistryClient,
  createSnapshotClient,
} from "../src/index";
import { jsonResponse, rejection, SNAPSHOT_URL, serve } from "./helpers";

const pluginText = (id: string, version: string) =>
  readFileSync(
    new URL(
      `../../../tools/registry-snapshot/test/fixtures/expected/registry/plugins/${id}/${version}.json`,
      import.meta.url,
    ),
    "utf8",
  );
const URL_SCHEMA = `${SNAPSHOT_URL}plugins/nf-schema/3.1.0.json`;
const serveSchema = (
  override: (url: string) => Response | undefined = () => undefined,
) =>
  serve((url) => {
    const o = override(url);
    if (o) return o;
    return url === URL_SCHEMA
      ? jsonResponse(pluginText("nf-schema", "3.1.0"))
      : undefined;
  });

describe("registry plugin spec", () => {
  it("F-505 IO-33 IO-30: plugin(id, version) reads plugins/<id>/<version>.json from the snapshot once and validates it", async () => {
    const f = serveSchema();
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    const spec = await client.plugin("nf-schema", "3.1.0");
    expect(spec.id).toBe("nf-schema");
    expect(spec.definitions).toHaveLength(21);
    await client.plugin("nf-schema", "3.1.0");
    const reads = f.calls.filter((c) => c.url === URL_SCHEMA);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.init?.credentials).toBe("omit");
    const odd = serve((url) =>
      url.includes("plugins/")
        ? jsonResponse(pluginText("nf-ffq", "0.2.0"))
        : undefined,
    );
    await createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: odd.fetch,
    }).plugin("nf-ffq", "0.2.0");
    expect(odd.calls[0]?.url).toBe(`${SNAPSHOT_URL}plugins/nf-ffq/0.2.0.json`);
    const encoded = serve(() => jsonResponse("{}", "application/json", 404));
    await rejection(
      createSnapshotClient({
        snapshotUrl: SNAPSHOT_URL,
        fetch: encoded.fetch,
      }).plugin("a b", "1/2"),
    );
    expect(encoded.calls[0]?.url).toBe(
      `${SNAPSHOT_URL}plugins/a%20b/1%2F2.json`,
    );
  });

  it("F-505 IO-30: plugin is snapshot-only; the combined and live clients delegate and never call registry.nextflow.io", async () => {
    const f = serveSchema();
    const snapshot = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    const combined = createRegistryClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
      live: true,
    });
    const live = createLiveClient({
      snapshot,
      fetch: f.fetch,
    } as Parameters<typeof createLiveClient>[0]);
    expect((await combined.plugin("nf-schema", "3.1.0")).version).toBe("3.1.0");
    expect((await live.plugin("nf-schema", "3.1.0")).version).toBe("3.1.0");
    expect(f.calls.some((c) => c.url.includes("registry.nextflow.io"))).toBe(
      false,
    );
  });

  it("F-505 IO-30: 404 is unavailable, HTML is invalid, a mismatched id or version is invalid, and a failed read is retried", async () => {
    const make = (response: () => Response) =>
      createSnapshotClient({
        snapshotUrl: SNAPSHOT_URL,
        fetch: serveSchema((url) =>
          url === URL_SCHEMA ? response() : undefined,
        ).fetch,
      });
    const missing = await rejection(
      make(() => jsonResponse("<html>", "text/html", 404)).plugin(
        "nf-schema",
        "3.1.0",
      ),
    );
    expect(missing.code).toBe("unavailable");
    expect(missing.message).toBe(
      "This registry snapshot has no spec for nf-schema 3.1.0.",
    );
    expect(
      (
        await rejection(
          make(() => jsonResponse("<html>", "text/html")).plugin(
            "nf-schema",
            "3.1.0",
          ),
        )
      ).code,
    ).toBe("invalid");
    for (const patch of [{ id: "other" }, { version: "9.9.9" }]) {
      const body = JSON.stringify({
        ...JSON.parse(pluginText("nf-schema", "3.1.0")),
        ...patch,
      });
      expect(
        (
          await rejection(
            make(() => jsonResponse(body)).plugin("nf-schema", "3.1.0"),
          )
        ).code,
      ).toBe("invalid");
    }
    let fail = true;
    const f = serveSchema((url) =>
      url === URL_SCHEMA && fail
        ? jsonResponse("x", "text/html", 500)
        : undefined,
    );
    const client = createSnapshotClient({
      snapshotUrl: SNAPSHOT_URL,
      fetch: f.fetch,
    });
    await rejection(client.plugin("nf-schema", "3.1.0"));
    fail = false;
    expect((await client.plugin("nf-schema", "3.1.0")).id).toBe("nf-schema");
  });
});
