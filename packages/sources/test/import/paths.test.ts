import { describe, expect, it } from "vitest";
import { entryPath, stripFolder, topFolder } from "../../src/import/paths";

const tops = (...raw: string[]) => topFolder(raw.map(entryPath));

describe("import paths", () => {
  it("F-403 IO-11: backslashes become slashes and a trailing slash marks a folder", () => {
    expect(entryPath("a\\b\\main.nf")).toEqual({
      kind: "file",
      path: "a/b/main.nf",
    });
    expect(entryPath("a/b/")).toEqual({ kind: "folder", path: "a/b" });
    expect(entryPath("a/b.nf")).toEqual({ kind: "file", path: "a/b.nf" });
  });

  it("F-403 QA-32: absolute paths, drive letters, control characters, empty, ., .. and __proto__ segments and paths over 1,024 characters are unsafe", () => {
    const unsafe = [
      "",
      "/",
      "/etc/passwd",
      "C:/x.nf",
      "c:x.nf",
      "a/\u0000b",
      "a/\u001fb",
      "a/\u007fb",
      "a//b",
      "./a.nf",
      "a/./b",
      "../a.nf",
      "a/../b",
      "a/__proto__/b",
      "__proto__",
      `${"a".repeat(1025)}`,
    ];
    for (const raw of unsafe)
      expect(entryPath(raw).kind, JSON.stringify(raw)).toBe("unsafe");
    expect(entryPath("../a.nf")).toMatchObject({
      kind: "unsafe",
      path: "../a.nf",
    });
    expect(entryPath("a".repeat(1024)).kind).toBe("file");
  });

  it("F-403 IO-11: one top-level folder is stripped; a file at the top, two top-level names or a file named like the folder strip nothing", () => {
    expect(tops("T/", "T/a.nf", "T/b/c.nf")).toBe("T");
    expect(tops("T/a.nf")).toBe("T");
    expect(tops("T/a.nf", "main.nf")).toBeNull();
    expect(tops("T/a.nf", "U/b.nf")).toBeNull();
    expect(tops("T/a.nf", "T")).toBeNull();
    expect(tops("T/")).toBeNull();
    expect(tops()).toBeNull();
    expect(stripFolder("T/a/b.nf", "T")).toBe("a/b.nf");
    expect(stripFolder("T/a/b.nf", null)).toBe("T/a/b.nf");
    expect(stripFolder("Tx/a.nf", "T")).toBe("Tx/a.nf");
  });

  it("F-403 IO-11: __MACOSX/ entries don't count when deciding the folder, and only one level is stripped", () => {
    expect(tops("T/a.nf", "__MACOSX/", "__MACOSX/T/._a.nf")).toBe("T");
    expect(tops("__MACOSX/T/._a.nf")).toBeNull();
    expect(stripFolder("__MACOSX/T/._a.nf", "T")).toBe("__MACOSX/T/._a.nf");
    expect(stripFolder(stripFolder("a/b/main.nf", "a"), null)).toBe(
      "b/main.nf",
    );
  });
});
