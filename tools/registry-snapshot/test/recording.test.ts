import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { recordingFetch, replayFetch } from "../src/recording.ts";

const recorded = fileURLToPath(new URL("./fixtures/recorded", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("F-501 recording and replay", () => {
  it("F-501: replay serves the recorded response, binary bodies from files, and names an unknown URL", async () => {
    const replay = replayFetch(recorded);
    const info = await replay(
      "https://registry.nextflow.io/api/v1/service-info",
    );
    expect(await info.json()).toEqual({
      serviceInfo: { version: "0.29.1", commitId: "2d1f430" },
    });
    const redirect = await replay(
      "https://registry.nextflow.io/api/v1/modules/nextflow-io%2Fhello/1.0.0/download",
      { redirect: "manual" },
    );
    expect(redirect.status).toBe(307);
    const blob = await replay(redirect.headers.get("location") as string);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array(
        readFileSync(join(recorded, "nextflow-io-hello-1.0.0.tar.gz")),
      ),
    );
    expect(replay.requested).toHaveLength(3);
    await expect(replay("https://registry.example/unknown")).rejects.toThrow(
      "https://registry.example/unknown",
    );
  });

  it("F-501: a recording replays to the same responses", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nf-rec-"));
    dirs.push(dir);
    const inner = (async (url: string | URL | Request) =>
      String(url).endsWith("/bin")
        ? new Response(new Uint8Array([0, 255, 7]), { status: 200 })
        : new Response('{"a":1}', {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as typeof fetch;
    const rec = recordingFetch(dir, inner);
    await rec("https://x.example/json");
    await rec("https://x.example/bin");
    const replay = replayFetch(dir);
    expect(await (await replay("https://x.example/json")).json()).toEqual({
      a: 1,
    });
    expect([
      ...new Uint8Array(
        await (await replay("https://x.example/bin")).arrayBuffer(),
      ),
    ]).toEqual([0, 255, 7]);
  });
});
