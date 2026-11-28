import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS } from "../../src/import/limits";
import { checkLooseFiles, looseCandidates } from "../../src/import/loose";

const enc = new TextEncoder();
const text = (name: string, body: string) => {
  const bytes = enc.encode(body);
  return { name, size: bytes.length, bytes };
};

describe("loose files", () => {
  it("F-210 UX-16 IO-12: looseCandidates keeps text files, marks files over 1 MB too-large without bytes, NUL or invalid UTF-8 as binary, unsafe names unsafe-path and repeated names duplicate", () => {
    const read = looseCandidates([
      text("a.nf", "process A {}\n"),
      {
        name: "big.txt",
        size: IMPORT_LIMITS.maxTextFileBytes + 1,
        bytes: null,
      },
      { name: "nul.bin", size: 3, bytes: new Uint8Array([97, 0, 98]) },
      { name: "bad.bin", size: 3, bytes: new Uint8Array([0xff, 0xfe, 0x41]) },
      text("../escape.nf", "x"),
      text("a.nf", "again"),
      text("sub\\b.nf", "b"),
    ]);
    expect(read).toMatchObject({ ok: true, stripped: null, entries: 7 });
    if (!read.ok) return;
    const by = (p: string) => read.candidates.filter((c) => c.path === p);
    expect(by("a.nf")).toEqual([
      { path: "a.nf", size: 13, text: "process A {}\n", reason: null },
      { path: "a.nf", size: 5, text: null, reason: "duplicate" },
    ]);
    expect(by("big.txt")).toEqual([
      {
        path: "big.txt",
        size: IMPORT_LIMITS.maxTextFileBytes + 1,
        text: null,
        reason: "too-large",
      },
    ]);
    expect(by("nul.bin")[0]).toMatchObject({ text: null, reason: "binary" });
    expect(by("bad.bin")[0]).toMatchObject({ text: null, reason: "binary" });
    expect(by("../escape.nf")[0]).toMatchObject({ reason: "unsafe-path" });
    expect(by("sub/b.nf")[0]).toMatchObject({ text: "b", reason: null });
  });

  it("F-210 UX-16 IO-12 QA-32: checkLooseFiles refuses more than 20,000 files and more than 200 MB in total with the upload messages", () => {
    expect(checkLooseFiles(20_000, 200_000_000)).toBeNull();
    expect(checkLooseFiles(20_001, 10)).toEqual({
      ok: false,
      code: "too-many-files",
      message:
        "That's more than 20,000 files. Uploads take up to 20,000 at a time.",
    });
    expect(checkLooseFiles(3, 200_000_001)).toEqual({
      ok: false,
      code: "files-too-large",
      message:
        "These files add up to more than 200 MB. Uploads take up to 200 MB at a time.",
    });
  });
});
