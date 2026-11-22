import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distPath, distUrl, loadPin } from "../src/pin.ts";

const tmpJson = (value: unknown): string => {
  const file = join(
    mkdtempSync(join(tmpdir(), "oracle-pin-")),
    "upstream.json",
  );
  writeFileSync(file, JSON.stringify(value));
  return file;
};
const HASH = "a".repeat(64);
const good = (over: {
  version?: unknown;
  url?: unknown;
  sha256?: unknown;
}) => ({
  nextflow: { version: over.version ?? "1.2.3" },
  nextflowDist: {
    url: over.url ?? distUrl(String(over.version ?? "1.2.3")),
    sha256: over.sha256 ?? HASH,
  },
});

describe("F-005 pin", () => {
  it("F-005 ADR-0019: upstream.json pins one Nextflow version (x.y.z) and the 64-hex SHA-256 of its -dist asset", () => {
    const pin = loadPin();
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("F-005: loadPin names the file and the problem for a missing version, a non-x.y.z version and a malformed sha256", () => {
    const missing = tmpJson({ nextflowDist: { url: "u", sha256: HASH } });
    expect(() => loadPin(missing)).toThrow(
      new RegExp(`${missing}.*nextflow\\.version`),
    );
    const bad = tmpJson(good({ version: "26.10" }));
    expect(() => loadPin(bad)).toThrow(
      new RegExp(`${bad}.*nextflow\\.version`),
    );
    const sha = tmpJson(good({ sha256: "ABC" }));
    expect(() => loadPin(sha)).toThrow(
      new RegExp(`${sha}.*nextflowDist\\.sha256`),
    );
  });

  it("F-005: loadPin rejects a nextflowDist.url that does not match the version", () => {
    const file = tmpJson(good({ version: "1.2.3", url: distUrl("1.2.4") }));
    expect(() => loadPin(file)).toThrow(
      new RegExp(`${file}: nextflowDist\\.url`),
    );
    expect(loadPin(tmpJson(good({ version: "1.2.3" })))).toEqual({
      version: "1.2.3",
      sha256: HASH,
    });
  });

  it("F-005: distUrl and distPath derive the release asset URL and the cache path from the version", () => {
    expect(distUrl("1.2.3")).toBe(
      "https://github.com/nextflow-io/nextflow/releases/download/v1.2.3/nextflow-1.2.3-dist",
    );
    expect(distPath("1.2.3", "/c")).toBe("/c/1.2.3/nextflow-1.2.3-dist");
  });
});
