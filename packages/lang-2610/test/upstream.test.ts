import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import upstream from "../upstream.json" with { type: "json" };

const PACK = join(import.meta.dirname, "..");

describe("vendored grammar", () => {
  it("ADR-0005: vendored grammar files match the SHA-256 in upstream.json", () => {
    const files = Object.entries(upstream.grammar.files);
    expect(files).toHaveLength(4);
    for (const [name, sha256] of files) {
      const bytes = readFileSync(join(PACK, "grammar", name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        sha256,
      );
    }
  });

  it("ADR-0005: grammar/SOURCE.md names the tag and commit recorded in upstream.json", () => {
    const source = readFileSync(join(PACK, "grammar", "SOURCE.md"), "utf8");
    expect(source).toContain(upstream.nextflow.tag);
    expect(source).toContain(upstream.nextflow.commit);
    expect(source).toContain(upstream.grammar.path);
  });
});
