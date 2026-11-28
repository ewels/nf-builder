import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  folderOf,
  isManagedPath,
  joinFolder,
  newFolderProblem,
  newPathProblem,
  projectTreeOf,
  readOnlyReason,
} from "../../src/files/paths";

const tree = projectTreeOf([
  "main.nf",
  "assets/a.csv",
  ".nf-builder/layout.json",
]);

describe("F-210 files paths", () => {
  it("F-210 UX-16: newPathProblem and newFolderProblem give the dialog's messages; a trailing slash is trimmed for folders and refused for files", () => {
    expect(newPathProblem("notes.txt", tree)).toBeNull();
    expect(newPathProblem("main.nf", tree)).toBe("main.nf already exists.");
    expect(newPathProblem("assets", tree)).toBe(
      "There is already a folder called assets.",
    );
    expect(newPathProblem("main.nf/x", tree)).toBe(
      "main.nf is a file, so it can't hold x.",
    );
    expect(newPathProblem("a//b", tree)).toBe(
      '"a//b" isn\'t a valid path (empty segment).',
    );
    expect(newPathProblem("docs/", tree)).toBe(
      '"docs/" isn\'t a valid path (empty segment).',
    );
    expect(newFolderProblem("docs/", tree)).toBeNull();
    expect(newFolderProblem("assets/", tree)).toBe(
      "There is already a folder called assets.",
    );
    expect(newFolderProblem(".nf-builder/x/", tree)).toMatch(
      /keeps .nf-builder/,
    );
  });

  it("F-210 UX-16: path helpers split, join and classify paths", () => {
    expect(folderOf("a/b/c.nf")).toBe("a/b");
    expect(folderOf("c.nf")).toBe("");
    expect(ancestorsOf("a/b/c.nf")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("c.nf")).toEqual([]);
    expect(joinFolder("", "x")).toBe("x");
    expect(joinFolder("a/b", "x")).toBe("a/b/x");
    expect(isManagedPath(".nf-builder/layout.json")).toBe(true);
    expect(isManagedPath(".nf-builderx/a")).toBe(false);
    expect(readOnlyReason(".nf-builder/layout.json")).toBe("managed");
    expect(readOnlyReason("main.nf")).toBeNull();
  });
});
