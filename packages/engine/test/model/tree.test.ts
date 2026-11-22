import { describe, expect, it } from "vitest";
import { FileTree, recordingTree } from "../../src/model/tree";

describe("FileTree", () => {
  it("F-105 AR-04: the file tree derives directories from file paths and reports which appear or disappear", () => {
    const tree = new FileTree(["main.nf", "modules/a/main.nf"]);
    expect(tree.isFile("main.nf")).toBe(true);
    expect(tree.isFile("modules")).toBe(false);
    expect(tree.isDirectory("modules")).toBe(true);
    expect(tree.isDirectory("modules/a")).toBe(true);
    expect(tree.isDirectory("modules/a/main.nf")).toBe(false);
    expect(tree.isDirectory("")).toBe(true);
    expect(tree.isDirectory("../x")).toBe(false);

    expect(tree.add("modules/a/meta.yml")).toEqual([]);
    expect(tree.add("modules/b/c/x.nf")).toEqual(["modules/b", "modules/b/c"]);
    expect(tree.add("modules/b/c/x.nf")).toEqual([]);
    expect(tree.remove("modules/b/c/x.nf")).toEqual([
      "modules/b",
      "modules/b/c",
    ]);
    expect(tree.isDirectory("modules/b")).toBe(false);
    expect(tree.remove("modules/a/main.nf")).toEqual([]);
    expect(tree.isDirectory("modules/a")).toBe(true);
    expect(tree.remove("modules/a/meta.yml")).toEqual(["modules", "modules/a"]);
    expect(tree.remove("nothing.nf")).toEqual([]);
    expect(new FileTree().isDirectory("")).toBe(false);
  });

  it("F-105 AR-04: a recording tree records every file and directory query", () => {
    const { tree, watch } = recordingTree(new FileTree(["a/b.nf"]));
    expect(tree.isFile("a/b.nf")).toBe(true);
    expect(tree.isFile("x.nf")).toBe(false);
    expect(tree.isDirectory("a")).toBe(true);
    expect([...watch.files]).toEqual(["a/b.nf", "x.nf"]);
    expect([...watch.directories]).toEqual(["a"]);
  });
});
