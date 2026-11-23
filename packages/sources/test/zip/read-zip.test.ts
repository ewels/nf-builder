import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_LIMITS } from "../../src/import/limits";
import {
  checkArchiveSize,
  readZip,
  type ZipRead,
} from "../../src/zip/read-zip";
import {
  rawEntryZip,
  renameEntry,
  withCompression,
  withRecordedSizes,
  zipOf,
} from "../fixtures/zips";

const admitted = vi.hoisted(() => ({ count: 0 }));

vi.mock("fflate", async (importOriginal) => {
  const real = await importOriginal<typeof import("fflate")>();
  return {
    ...real,
    unzipSync: (
      data: Uint8Array,
      options?: Parameters<typeof real.unzipSync>[1],
    ) => {
      const filter = options?.filter;
      if (filter === undefined) return real.unzipSync(data, options);
      return real.unzipSync(data, {
        ...options,
        filter: (info) => {
          const take = filter(info);
          if (take) admitted.count += 1;
          return take;
        },
      });
    },
  };
});

function read(
  zip: Uint8Array,
  options?: Parameters<typeof readZip>[1],
): ZipRead {
  const result = readZip(zip, options);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result;
}

const pathsOf = (r: ZipRead) => r.candidates.map((c) => c.path);

describe("readZip", () => {
  it("F-403 IO-11: a git archive-style zip (a folder entry per folder, a comment, stored and deflated entries) reads with its top-level folder stripped", () => {
    const zip = zipOf(
      {
        "repo-abc/": new Uint8Array(),
        "repo-abc/main.nf": "workflow {}\n",
        "repo-abc/modules/": new Uint8Array(),
        "repo-abc/modules/a.nf": [
          new TextEncoder().encode("process A {}\n"),
          { level: 0 },
        ],
        "repo-abc/nextflow.config": [
          new TextEncoder().encode("params.x = 1\n".repeat(50)),
          { level: 6 },
        ],
      },
      { comment: "abc" },
    );
    const result = read(zip);
    expect(result.stripped).toBe("repo-abc");
    expect(result.entries).toBe(5);
    expect(result.candidates).toEqual([
      { path: "main.nf", size: 12, text: "workflow {}\n", reason: null },
      { path: "modules/a.nf", size: 13, text: "process A {}\n", reason: null },
      {
        path: "nextflow.config",
        size: 650,
        text: "params.x = 1\n".repeat(50),
        reason: null,
      },
    ]);
  });

  it("F-403 IO-11: a zip with no single top-level folder keeps its paths", () => {
    const result = read(zipOf({ "main.nf": "a", "lib/b.nf": "b" }));
    expect(result.stripped).toBeNull();
    expect(pathsOf(result)).toEqual(["lib/b.nf", "main.nf"]);
  });

  it("F-403 IO-12: text files over 1 MB are skipped without being inflated, binary files are skipped, and compression other than stored or deflated is unsupported", () => {
    const big = new Uint8Array(1_000_001).fill(97);
    const zip = withCompression(
      zipOf({
        "ok.nf": "ok",
        "exact.txt": new Uint8Array(1_000_000).fill(98),
        "big.txt": big,
        "pic.png": new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
        "latin.txt": new Uint8Array([0xe9, 0xe8]),
        "lzma.nf": "xx",
      }),
      "lzma.nf",
      14,
    );
    admitted.count = 0;
    const result = read(zip);
    const by = Object.fromEntries(result.candidates.map((c) => [c.path, c]));
    expect(by["ok.nf"]).toMatchObject({ text: "ok", reason: null });
    expect(by["exact.txt"]?.reason).toBeNull();
    expect(by["big.txt"]).toMatchObject({
      text: null,
      reason: "too-large",
      size: 1_000_001,
    });
    expect(by["pic.png"]).toMatchObject({
      text: null,
      reason: "binary",
      size: 7,
    });
    expect(by["latin.txt"]).toMatchObject({ text: null, reason: "binary" });
    expect(by["lzma.nf"]).toMatchObject({ text: null, reason: "unsupported" });
    // pass 1 admits nothing; pass 2 admits ok.nf, exact.txt, pic.png and latin.txt only
    expect(admitted.count).toBe(4);
  });

  it("F-403 QA-32: unsafe entry paths are skipped as unsafe-path, naming the raw entry", () => {
    const zip = renameEntry(
      zipOf({ "a/okay.nf": "x", "a/XXXXXXX": "evil" }),
      "a/XXXXXXX",
      "a/../../x",
    );
    const result = read(zip);
    const by = Object.fromEntries(result.candidates.map((c) => [c.path, c]));
    expect(result.stripped).toBe("a");
    expect(by["a/../../x"]).toMatchObject({
      reason: "unsafe-path",
      text: null,
    });
    expect(by["okay.nf"]).toMatchObject({ reason: null, text: "x" });
  });

  it("F-403 QA-32: a __proto__ entry cannot reach the prototype", () => {
    const zip = renameEntry(
      zipOf({ "ok.nf": "x", XXXXXXXXX: "evil" }),
      "XXXXXXXXX",
      "__proto__",
    );
    const result = read(zip);
    const by = Object.fromEntries(result.candidates.map((c) => [c.path, c]));
    expect(by.__proto__).toMatchObject({ reason: "unsafe-path" });
    expect(({} as { text?: string }).text).toBeUndefined();
  });

  it("F-403 IO-12: duplicate paths keep the first entry", () => {
    const zip = renameEntry(
      zipOf({ "a.nfX": "first", "a.nfY": "second" }),
      "a.nfY",
      "a.nfX",
    );
    const result = read(zip);
    expect(result.candidates).toEqual([
      { path: "a.nfX", size: 5, text: "first", reason: null },
      { path: "a.nfX", size: 6, text: null, reason: "duplicate" },
    ]);
  });

  it("F-403 step 2 IO-12 QA-32: checkArchiveSize refuses a zip over 200 MB, and anything under 22 bytes", () => {
    expect(checkArchiveSize(200_000_000)).toBeNull();
    expect(checkArchiveSize(22)).toBeNull();
    expect(checkArchiveSize(200_000_001)).toMatchObject({
      ok: false,
      code: "too-big",
      message: "This zip is 200 MB. Imports take zips of up to 200 MB.",
    });
    expect(checkArchiveSize(230_000_000)?.message).toBe(
      "This zip is 230 MB. Imports take zips of up to 200 MB.",
    );
    expect(checkArchiveSize(21)).toMatchObject({ ok: false, code: "not-zip" });
    expect(checkArchiveSize(0)).toMatchObject({ ok: false, code: "not-zip" });
  });

  it("F-403 step 2 IO-12 QA-32: a zip with 20,001 entries is refused with the entries message", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= IMPORT_LIMITS.maxEntries; i += 1) files[`f${i}`] = "";
    const zip = zipOf(files);
    admitted.count = 0;
    expect(readZip(zip)).toEqual({
      ok: false,
      code: "too-many-entries",
      message:
        "This zip has more than 20,000 files and folders. Imports take up to 20,000.",
    });
    expect(admitted.count).toBe(0);
    delete files.f20000;
    expect(read(zipOf(files)).entries).toBe(20_000);
  });

  it("F-403 step 2 IO-12 QA-32: recorded sizes over 200 MB in total are refused before anything is inflated", () => {
    let zip = zipOf({ "a.txt": "aaaa", "b.txt": "bbbb", "c.txt": "cccc" });
    zip = withRecordedSizes(zip, "a.txt", { originalSize: 150_000_000 });
    zip = withRecordedSizes(zip, "b.txt", { originalSize: 60_000_000 });
    admitted.count = 0;
    expect(readZip(zip)).toEqual({
      ok: false,
      code: "too-large-uncompressed",
      message:
        "This zip expands to more than 200 MB. Imports take up to 200 MB uncompressed.",
    });
    expect(admitted.count).toBe(0);
  });

  it("F-403 QA-32: an entry whose compressed size exceeds its recorded size by more than an eighth plus 1 kB is refused as damaged, naming it", () => {
    let seed = 403;
    const noise = Uint8Array.from({ length: 5000 }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return (seed >>> 16) & 255;
    });
    const zip = zipOf({ "ok.nf": "ok", "bad.nf": [noise, { level: 6 }] });
    const lie = withRecordedSizes(zip, "bad.nf", { originalSize: 100 });
    expect(readZip(lie)).toEqual({
      ok: false,
      code: "damaged",
      message: "This zip is damaged: bad.nf doesn't match its recorded size.",
    });
    const stored = zipOf({
      "s.nf": [new TextEncoder().encode("abcdef"), { level: 0 }],
    });
    expect(
      readZip(withRecordedSizes(stored, "s.nf", { originalSize: 3 })),
    ).toMatchObject({
      ok: false,
      code: "damaged",
    });
  });

  it("F-403 QA-32: an entry whose data expands past its recorded size yields at most its recorded size, quickly", () => {
    const compressed = deflateRawSync(Buffer.alloc(50_000_000, 97), {
      level: 9,
    });
    const zip = rawEntryZip("bomb.txt", compressed, {
      method: 8,
      originalSize: 100_000,
    });
    const started = performance.now();
    const result = read(zip);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.text).toHaveLength(100_000);
  });

  it("F-403 QA-32: once 30 seconds have passed, unpacking stops before the next entry with the too-slow message", () => {
    const zip = zipOf({ "a.nf": "a", "b.nf": "b", "c.nf": "c" });
    let clock = 0;
    const now = () => {
      clock += 20_000;
      return clock;
    };
    expect(readZip(zip, { now })).toEqual({
      ok: false,
      code: "too-slow",
      message:
        "This zip took more than 30 seconds to unpack and was stopped. It may be damaged.",
    });
    expect(readZip(zip, { now: () => 0 }).ok).toBe(true);
  });

  it("F-403 IO-14: random bytes and an empty file are refused as not a zip", () => {
    const noise = Uint8Array.from(
      { length: 4096 },
      (_, i) => (i * 31 + 7) % 256,
    );
    for (const bytes of [
      noise,
      new Uint8Array(),
      new TextEncoder().encode("hello world, not a zip"),
    ]) {
      expect(readZip(bytes)).toMatchObject({ ok: false, code: "not-zip" });
    }
  });

  it("F-403 IO-14: a truncated archive is refused as not a zip", () => {
    const zip = zipOf({ "a.nf": "hello", "b.nf": "world" });
    expect(readZip(zip.slice(0, zip.length - 10))).toMatchObject({ ok: false });
  });

  it("F-403 ADR-0003: every ZipRead and refusal survives structuredClone", () => {
    const ok = readZip(
      zipOf({ "t/a.nf": "a", "t/b.png": new Uint8Array([0, 1]) }),
    );
    const refused = readZip(new Uint8Array(30));
    expect(structuredClone(ok)).toEqual(ok);
    expect(structuredClone(refused)).toEqual(refused);
  });
});
