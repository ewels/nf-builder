import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/edit/patches";
import { accepted, commit, refused, stateFor, texts } from "./helpers";

const GREET =
  "nextflow.enable.types = true\n\ninclude { HELPER } from '../helper/main.nf'\n\nprocess GREET {\n    script:\n    'x'\n}\n";
const files = {
  "main.nf":
    "nextflow.enable.types = true\n\ninclude { GREET } from './modules/local/greet/main.nf'\n\nworkflow {\n    GREET()\n}\n",
  "modules/local/greet/main.nf": GREET,
  "modules/local/greet/meta.yml": "name: greet\n",
  "modules/local/helper/main.nf":
    "nextflow.enable.types = true\n\nprocess HELPER {\n    script:\n    'y'\n}\n",
};

describe("F-303 point 5 LA-12 MoveFile", () => {
  it("F-303 point 5 LA-12: moving a folder moves every file under it and rewrites the include sources of the includers and of the moved script", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "moveFile",
      path: "modules/local/greet",
      newPath: "modules/local/say",
    });
    commit(state, r);
    const now = texts(state);
    expect(Object.keys(now).sort()).toEqual([
      "main.nf",
      "modules/local/helper/main.nf",
      "modules/local/say/main.nf",
      "modules/local/say/meta.yml",
    ]);
    expect(now["modules/local/say/meta.yml"]).toBe("name: greet\n");
    expect(now["main.nf"]).toContain("from './modules/local/say/main.nf'");
    expect(now["modules/local/say/main.nf"]).toBe(GREET);
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-303 point 5: moving a script into another depth rewrites its own relative includes", async () => {
    const state = await stateFor(files);
    const r = accepted(state, {
      kind: "moveFile",
      path: "modules/local/greet/main.nf",
      newPath: "modules/local/deep/er/main.nf",
    });
    commit(state, r);
    expect(texts(state)["modules/local/deep/er/main.nf"]).toContain(
      "from '../../helper/main.nf'",
    );
    expect(state.model.diagnostics()).toEqual([]);
  });

  it("F-303 AR-23: MoveFile's inverse restores the paths and the exact bytes", async () => {
    const state = await stateFor(files);
    const before = texts(state);
    const r = accepted(state, {
      kind: "moveFile",
      path: "modules/local/greet",
      newPath: "modules/local/say",
    });
    commit(state, r);
    const back = applyPatches(new Map(Object.entries(texts(state))), r.inverse);
    expect(Object.fromEntries(back.files)).toEqual(before);
  });

  it("F-303 point 5: MoveFile refuses a missing path, an existing target, the same path, a move into itself and .nf-builder/", async () => {
    const state = await stateFor({
      ...files,
      ".nf-builder/layout.json": "{}\n",
    });
    const why = (path: string, newPath: string) => {
      const r = refused(state, { kind: "moveFile", path, newPath });
      expect(r.code).toBe(path === "nope" ? "not-found" : "invalid");
      return r.message;
    };
    expect(why("nope", "x")).toBe("There is no file or folder nope.");
    expect(why("main.nf", "modules/local/helper/main.nf")).toBe(
      "modules/local/helper/main.nf already exists.",
    );
    expect(why("main.nf", "main.nf")).toBe("main.nf is already there.");
    expect(why("modules/local", "modules/local/x")).toBe(
      "modules/local can't move into itself.",
    );
    expect(why("main.nf", ".nf-builder/main.nf")).toContain(".nf-builder/");
    expect(why(".nf-builder/layout.json", "layout.json")).toContain(
      ".nf-builder/",
    );
  });
});
