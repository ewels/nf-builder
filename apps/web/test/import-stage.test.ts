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
    });
    const again = await stager.restage("s1", "work/\n");
    expect(again).toMatchObject({ ok: true, summary: { files: 2 } });
    expect(await stager.files("s1", "work/\n")).toEqual({
      ok: true,
      files: [
        { path: "data/a.txt", text: "data\n" },
        { path: "main.nf", text: "workflow {}\n" },
      ],
    });
  });

  it("F-403: files reports ignore-list problems and an import with no files", async () => {
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

  it("F-403: a newer stage replaces the older one, and discard makes an id gone", async () => {
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
});
