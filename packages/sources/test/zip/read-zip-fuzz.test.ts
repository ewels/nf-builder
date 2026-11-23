import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readZip } from "../../src/zip/read-zip";
import { zipOf } from "../fixtures/zips";

const base = zipOf(
  {
    "top/": new Uint8Array(),
    "top/main.nf": "workflow {}\n".repeat(20),
    "top/lib/a.nf": [
      new TextEncoder().encode("process A {}\n".repeat(40)),
      { level: 0 },
    ],
    "top/bin/tool": new Uint8Array([0, 1, 2, 3, 255]),
    "top/nextflow.config": "params.x = 1\n".repeat(100),
  },
  { comment: "fuzz" },
);

const mutated = fc.oneof(
  fc
    .array(fc.tuple(fc.nat(base.length - 1), fc.nat(255)), {
      minLength: 1,
      maxLength: 12,
    })
    .map((edits) => {
      const out = base.slice();
      for (const [at, byte] of edits) out[at] = byte;
      return out;
    }),
  fc.nat(base.length).map((n) => base.slice(0, n)),
  fc.uint8Array({ maxLength: 200 }).map((tail) => {
    const out = new Uint8Array(base.length + tail.length);
    out.set(base);
    out.set(tail, base.length);
    return out;
  }),
  fc
    .tuple(fc.nat(base.length - 1), fc.uint8Array({ maxLength: 64 }))
    .map(([at, junk]) => {
      const out = new Uint8Array(base.length + junk.length);
      out.set(base.subarray(0, at));
      out.set(junk, at);
      out.set(base.subarray(at), at + junk.length);
      return out;
    }),
);

describe("readZip fuzz", () => {
  it("F-403 QA-32: corrupted, truncated or extended archives always give files or a refusal, never an exception, each within 2 s", () => {
    fc.assert(
      fc.property(mutated, (bytes) => {
        const started = performance.now();
        const result = readZip(bytes);
        expect(performance.now() - started).toBeLessThan(2000);
        if (result.ok) {
          expect(Array.isArray(result.candidates)).toBe(true);
          for (const c of result.candidates)
            expect(c.size).toBeGreaterThanOrEqual(0);
        } else {
          expect(result.message.length).toBeGreaterThan(0);
        }
      }),
      { seed: 403, numRuns: 300 },
    );
  });
});
