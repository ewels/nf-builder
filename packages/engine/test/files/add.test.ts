import { describe, expect, it } from "vitest";
import { planAdd } from "../../src/files/add";
import { projectTreeOf } from "../../src/files/paths";

describe("F-210 planAdd", () => {
  it("F-210 UX-16: planAdd prefixes the folder, lists replaced files, and skips managed, folder and under-file clashes, including clashes inside the added set", () => {
    const tree = projectTreeOf([
      "main.nf",
      "assets/old.csv",
      "assets/sub/x.txt",
      "assets/notes",
      ".nf-builder/layout.json",
    ]);
    const plan = planAdd({
      paths: [
        "old.csv",
        "new.csv",
        "sub",
        ".nf-builder/x.json",
        "notes/inner.txt",
        "deep/a.txt",
        "deep/a.txt/b.txt",
        "later/x",
        "later",
      ],
      folder: "assets",
      tree,
    });
    expect(plan.writes).toEqual([
      { from: "old.csv", to: "assets/old.csv" },
      { from: "new.csv", to: "assets/new.csv" },
      { from: "deep/a.txt", to: "assets/deep/a.txt" },
      { from: "later/x", to: "assets/later/x" },
    ]);
    expect(plan.replaced).toEqual(["assets/old.csv"]);
    expect(plan.conflicts).toEqual([
      { path: "assets/sub", reason: "folder" },
      { path: "assets/.nf-builder/x.json", reason: "managed" },
      {
        path: "assets/notes/inner.txt",
        reason: "under-file",
        ancestor: "assets/notes",
      },
      {
        path: "assets/deep/a.txt/b.txt",
        reason: "under-file",
        ancestor: "assets/deep/a.txt",
      },
      { path: "assets/later", reason: "folder" },
    ]);
  });

  it("F-210 UX-16: planAdd at the project root skips anything under .nf-builder/ and a file under an existing file", () => {
    const tree = projectTreeOf(["main.nf", "notes"]);
    const plan = planAdd({
      paths: [".nf-builder/layout.json", "notes/a.txt", "ok.txt"],
      folder: "",
      tree,
    });
    expect(plan.writes).toEqual([{ from: "ok.txt", to: "ok.txt" }]);
    expect(plan.conflicts).toEqual([
      { path: ".nf-builder/layout.json", reason: "managed" },
      { path: "notes/a.txt", reason: "under-file", ancestor: "notes" },
    ]);
  });
});
