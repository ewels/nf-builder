import { describe, expect, it } from "vitest";
import { dropKind, isFileDrag } from "../src/files/drop";

const file = (name: string, type = ""): File => new File(["x"], name, { type });

describe("F-210 drop", () => {
  it("F-210 UX-16: isFileDrag needs Files; dropKind gives zip for one .zip, files otherwise, folder when any entry is a directory, none for nothing", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    expect(isFileDrag(["text/plain", "Files"])).toBe(true);
    expect(isFileDrag(["text/plain"])).toBe(false);
    expect(isFileDrag([])).toBe(false);

    const zip = file("Pipeline.ZIP");
    expect(dropKind([zip], [null])).toEqual({ kind: "zip", file: zip });
    const typed = file("download", "application/x-zip-compressed");
    expect(dropKind([typed], [])).toEqual({ kind: "zip", file: typed });
    // a zip among other files is just a file
    const a = file("a.nf");
    expect(dropKind([zip, a], [null, null])).toEqual({
      kind: "files",
      files: [zip, a],
    });
    expect(dropKind([a], [{ isDirectory: false }])).toEqual({
      kind: "files",
      files: [a],
    });
    expect(dropKind([a, file("dir")], [null, { isDirectory: true }])).toEqual({
      kind: "folder",
    });
    expect(dropKind([], [])).toEqual({ kind: "none" });
  });
});
