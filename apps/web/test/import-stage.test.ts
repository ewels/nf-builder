import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  createImportStager,
  type SourcesModule,
} from "../src/workspace/import-stage";

const enc = new TextEncoder();
const zip = (files: Record<string, string>): Blob => {
  const data: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files))
    data[name] = enc.encode(text);
  return new Blob([zipSync(data)]);
};

describe("F-403 import stager", () => {
  it("F-403 QA-01: the sources module is loaded on the first stageZip only", async () => {
    const load = vi.fn(
      (): Promise<SourcesModule> => import("@nf-builder/sources"),
    );
    const stager = createImportStager({ load });
    expect(load).not.toHaveBeenCalled();
    await stager.stageZip(zip({ "a/main.nf": "x" }), "a.zip");
    await stager.stageZip(zip({ "a/main.nf": "x" }), "b.zip");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("F-403 IO-11: a blob over 200 MB is refused without being read", async () => {
    const arrayBuffer = vi.fn(() => {
      throw new Error("must not be read");
    });
    const huge = { size: 200_000_001, arrayBuffer } as unknown as Blob;
    const result = await createImportStager().stageZip(huge, "huge.zip");
    expect(result).toMatchObject({ ok: false, code: "too-big" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("F-403 IO-11 IO-12: a staged zip gives a summary; restage and files apply the ignore list it is given", async () => {
    const stager = createImportStager({ newId: () => "s1" });
    const staged = await stager.stageZip(
      zip({
        "top/main.nf": "workflow {}\n",
        "top/data/a.txt": "data\n",
        "top/work/b.txt": "work\n",
      }),
      "top.zip",
    );
    if (!staged.ok) throw new Error(staged.message);
    expect(staged.id).toBe("s1");
    expect(staged.summary).toMatchObject({
      source: "top.zip",
      stripped: "top",
      files: 1,
    });
    expect(await stager.files("s1", staged.summary.ignore)).toEqual({
      ok: true,
      files: [{ path: "main.nf", text: "workflow {}\n" }],
      source: { kind: "zip", name: "top.zip", sha256: expect.any(String) },
    });
    const again = await stager.restage("s1", "work/\n");
    expect(again).toMatchObject({ ok: true, summary: { files: 2 } });
    expect(await stager.files("s1", "work/\n")).toMatchObject({
      ok: true,
      files: [
        { path: "data/a.txt", text: "data\n" },
        { path: "main.nf", text: "workflow {}\n" },
      ],
    });
  });

  it("F-401 IO-13: files returns the zip source with the file name and the SHA-256 of the zip bytes", async () => {
    const stager = createImportStager({ newId: () => "s1" });
    const blob = zip({ "main.nf": "x" });
    await stager.stageZip(blob, "my.zip");
    const expected = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await stager.files("s1", "")).toMatchObject({
      ok: true,
      source: { kind: "zip", name: "my.zip", sha256: expected },
    });
  });

  it("F-403 IO-12: files reports ignore-list problems and an import with no files", async () => {
    const stager = createImportStager({ newId: () => "s1" });
    await stager.stageZip(zip({ "main.nf": "x" }), "a.zip");
    expect(await stager.files("s1", "!main.nf\n")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/^Fix the ignore list first\. Line 1/),
    });
    expect(await stager.files("s1", "*\n")).toEqual({
      ok: false,
      message: "Nothing to import: every file was skipped.",
    });
  });

  it("F-403 IO-11: a newer stage replaces the older one, and discard makes an id gone", async () => {
    let n = 0;
    const stager = createImportStager({ newId: () => `s${++n}` });
    await stager.stageZip(zip({ "a.nf": "a" }), "a.zip");
    await stager.stageZip(zip({ "b.nf": "b" }), "b.zip");
    expect(await stager.restage("s1", "")).toMatchObject({
      ok: false,
      code: "gone",
    });
    expect(await stager.restage("s2", "")).toMatchObject({ ok: true });
    stager.discard("s2");
    expect(await stager.restage("s2", "")).toMatchObject({
      ok: false,
      code: "gone",
    });
    expect(await stager.files("s2", "")).toMatchObject({ ok: false });
  });

  it("F-403 step 2 QA-32: a refused zip is returned as data and leaves nothing staged", async () => {
    const stager = createImportStager({ newId: () => "s1" });
    await stager.stageZip(zip({ "a.nf": "a" }), "a.zip");
    const refused = await stager.stageZip(
      new Blob([new Uint8Array(100)]),
      "x.zip",
    );
    expect(refused).toMatchObject({ ok: false, code: "not-zip" });
    expect(await stager.restage("s1", "")).toMatchObject({ code: "gone" });
  });

  it("F-403 IO-11: the newest stageZip wins when an older, larger read finishes last", async () => {
    let n = 0;
    const stager = createImportStager({ newId: () => `s${++n}` });
    const slow = zip({ "a.nf": "a" });
    const late = {
      size: slow.size,
      arrayBuffer: () =>
        new Promise<ArrayBuffer>((resolve) =>
          setTimeout(() => resolve(slow.arrayBuffer()), 30),
        ),
    } as unknown as Blob;
    const first = stager.stageZip(late, "a.zip");
    const second = await stager.stageZip(zip({ "b.nf": "b" }), "b.zip");
    expect(second).toMatchObject({ ok: true, id: "s1" });
    expect(await first).toMatchObject({ ok: false, code: "gone" });
    expect(await stager.restage("s1", "")).toMatchObject({ ok: true });
  });
});

const named = (name: string, body: string | Uint8Array) => {
  const data = typeof body === "string" ? enc.encode(body) : body;
  return { name, blob: new Blob([data as BlobPart]) };
};

describe("F-210 import stager: loose files", () => {
  it("F-210 UX-16 IO-12: stageFiles stages text files, skips binary files and files over 1 MB without reading them, and refuses too many files or too much in total before reading", async () => {
    const stager = createImportStager({ newId: () => "l1" });
    const arrayBuffer = vi.fn(() => {
      throw new Error("must not be read");
    });
    const big = {
      name: "big.txt",
      blob: { size: 1_000_001, arrayBuffer } as unknown as Blob,
    };
    const staged = await stager.stageFiles([
      named("a.nf", "workflow {}\n"),
      named("pic.png", new Uint8Array([137, 0, 80])),
      big,
    ]);
    if (!staged.ok) throw new Error(staged.message);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(staged.id).toBe("l1");
    expect(staged.summary).toMatchObject({
      source: "3 files",
      stripped: null,
      files: 1,
    });
    expect(staged.summary.skipped.map((g) => [g.reason, g.count])).toEqual([
      ["too-large", 1],
      ["binary", 1],
    ]);
    // the ignore list doesn't apply to files the user chose
    expect(await stager.files("l1", "*.nf\n")).toMatchObject({
      ok: true,
      files: [{ path: "a.nf", text: "workflow {}\n" }],
    });

    const many = Array.from({ length: 20_001 }, (_, i) => ({
      name: `f${i}.txt`,
      blob: { size: 1, arrayBuffer } as unknown as Blob,
    }));
    expect(await stager.stageFiles(many)).toMatchObject({
      ok: false,
      code: "too-many-files",
    });
    const heavy = [
      {
        name: "a",
        blob: { size: 150_000_000, arrayBuffer } as unknown as Blob,
      },
      { name: "b", blob: { size: 50_000_001, arrayBuffer } as unknown as Blob },
    ];
    expect(await stager.stageFiles(heavy)).toMatchObject({
      ok: false,
      code: "files-too-large",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(await stager.files("l1", "")).toMatchObject({ ok: false });
  });

  it("F-210 IO-11: files(id, ignore, {keepFolder: true}) puts the stripped folder back on every path", async () => {
    const stager = createImportStager({ newId: () => "s1" });
    await stager.stageZip(
      zip({ "top/main.nf": "x", "top/sub/a.txt": "a" }),
      "top.zip",
    );
    expect(await stager.files("s1", "", { keepFolder: true })).toMatchObject({
      ok: true,
      files: [
        { path: "top/main.nf", text: "x" },
        { path: "top/sub/a.txt", text: "a" },
      ],
    });
    expect(await stager.files("s1", "", { keepFolder: false })).toMatchObject({
      ok: true,
      files: [
        { path: "main.nf", text: "x" },
        { path: "sub/a.txt", text: "a" },
      ],
    });
  });
});
