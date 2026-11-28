import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/edit/patches";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const files = {
  "main.nf": "workflow {\n}\n",
  "modules/local/a/main.nf": "process A {\n    script:\n    'a'\n}\n",
  "README.md": "# Hi\n",
};

describe("F-210 CreateFile", () => {
  it("F-210 UX-16 AR-20: createFile creates an empty file with one create patch whose inverse deletes it", async () => {
    const state = await stateFor(files);
    const r = accepted(state, { kind: "createFile", path: "docs/notes.txt" });
    expect(r.patches).toEqual([
      { kind: "create", path: "docs/notes.txt", text: "" },
    ]);
    expect(r.inverse).toEqual([{ kind: "delete", path: "docs/notes.txt" }]);
    expect(r.files).toEqual([{ path: "docs/notes.txt", text: "" }]);
  });

  it("F-210 AR-23: applying createFile's inverse restores the exact previous files", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const r = accepted(state, { kind: "createFile", path: "assets/.gitkeep" });
    commit(state, r);
    expect(texts(state)).toEqual({ ...before, "assets/.gitkeep": "" });
    const back = applyPatches(new Map(Object.entries(texts(state))), r.inverse);
    expect(Object.fromEntries(back.files)).toEqual(before);
  });

  it("F-210 UX-16: createFile refuses an existing file, an existing folder, a path under a file, an unsafe path and anything under .nf-builder/, each with its message", async () => {
    const state = await stateFor({
      ...files,
      ".nf-builder/layout.json": "{}\n",
    });
    const message = (path: string) => {
      const r = refused(state, { kind: "createFile", path });
      expect(r.code).toBe("invalid");
      return r.message;
    };
    expect(message("README.md")).toBe("README.md already exists.");
    expect(message("modules/local")).toBe(
      "There is already a folder called modules/local.",
    );
    expect(message("README.md/x.txt")).toBe(
      "README.md is a file, so it can't hold x.txt.",
    );
    expect(message("../x.txt")).toBe(
      '"../x.txt" isn\'t a valid path (.. segment).',
    );
    expect(message("")).toBe('"" isn\'t a valid path (empty path).');
    const managed =
      "nf-builder keeps .nf-builder/ up to date itself. Choose another folder.";
    expect(message(".nf-builder/new.json")).toBe(managed);
    expect(message(".nf-builder")).toBe(managed);
  });

  it("F-210 AR-24: empty .nf and .config files parse without problems, so createFile is accepted for them", async () => {
    const state = await stateFor(files);
    for (const path of ["empty.nf", "empty.config", "empty.md", "d/.gitkeep"])
      expect(accepted(state, { kind: "createFile", path }).files).toEqual([
        { path, text: "" },
      ]);
  });
});
