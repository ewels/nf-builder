import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AddFilesState } from "../src/files/add-files";
import { AddFilesDialog } from "../src/files/add-files-dialog";

type Ready = AddFilesState & { status: "ready" };
const ready = (over: Partial<Ready> = {}, adds = 3): Ready => ({
  status: "ready",
  name: "extra.zip",
  zip: true,
  ignore: ".git/\n",
  keepFolder: false,
  updating: false,
  adding: false,
  preview: {
    ok: true,
    id: "z1",
    folder: "assets",
    adds,
    replaced: ["assets/a.csv"],
    replacedCount: 1,
    conflicts: [
      { path: ".nf-builder/x.json", reason: "managed" },
      { path: "assets/dir", reason: "folder" },
      { path: "assets/f/x.nf", reason: "under-file", ancestor: "assets/f" },
    ],
    conflictCount: 3,
    summary: {
      source: "extra.zip",
      stripped: "extra-main",
      files: 4,
      bytes: 2048,
      skipped: [{ reason: "binary", count: 1, bytes: 10, paths: ["logo.png"] }],
      ignore: ".git/\n",
      ignoreProblems: [],
    },
  },
  ...over,
});
const html = (state: Ready) =>
  renderToStaticMarkup(
    <AddFilesDialog
      view={{
        state,
        start: () => undefined,
        setIgnore: () => undefined,
        setKeepFolder: () => undefined,
        confirm: async () => true,
        cancel: () => undefined,
      }}
      onClose={() => undefined}
    />,
  );

describe("F-210 add files dialog", () => {
  it("F-210 UX-16 IO-12 UX-61: the dialog shows the target, files and size, the removed folder with its Keep checkbox, skipped groups, replaced files, conflicts, the ignore list for zips only, the undo note and the Add button's count", () => {
    const zip = html(ready());
    expect(zip).toContain("Add files from extra.zip");
    expect(zip).toContain("To assets/");
    expect(zip).toContain("4 files, ");
    expect(zip).toContain("Removed the top-level folder extra-main/.");
    expect(zip).toContain("Keep the folder extra-main/");
    expect(zip).toContain("Binary or non-UTF-8 files");
    expect(zip).toContain("Replaces 1 existing file");
    expect(zip).toContain("assets/a.csv");
    expect(zip).toContain("Not added (3)");
    expect(zip).toContain("Managed by nf-builder");
    expect(zip).toContain("A folder has this name");
    expect(zip).toContain("assets/f is a file");
    expect(zip).toContain("Ignore list");
    expect(zip).toContain(
      "Adding files can&#x27;t be undone, and it clears the undo history.",
    );
    expect(zip).toContain("Add and replace");

    const base = ready({ zip: false, name: "a.csv" }, 1);
    const loose: Ready = {
      ...base,
      preview: {
        ...base.preview,
        folder: "",
        replaced: [],
        replacedCount: 0,
        conflicts: [],
        conflictCount: 0,
        summary: { ...base.preview.summary, stripped: null, skipped: [] },
      },
    };
    const plain = html(loose);
    expect(plain).toContain(">Add files<");
    expect(plain).toContain("To the top of the project");
    expect(plain).not.toContain("Ignore list");
    expect(plain).not.toContain("Keep the folder");
    expect(plain).not.toContain("Not added");
    expect(plain).toContain("Add 1 file<");
    expect(plain).not.toContain("disabled");
    // nothing to add: the button is disabled
    expect(html(ready({}, 0))).toMatch(
      /<button[^>]*disabled=""[^>]*>Add and replace/,
    );
  });
});
