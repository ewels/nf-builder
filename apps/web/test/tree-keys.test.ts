import type { FileTreeRow } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import { TYPEAHEAD_RESET_MS, treeKey } from "../src/files/tree-keys";

const row = (
  path: string,
  over: Partial<FileTreeRow> & { kind?: "folder" | "file" } = {},
): FileTreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind: "file",
  level: 1,
  setSize: 1,
  posInSet: 1,
  parent: null,
  expanded: null,
  language: null,
  registry: null,
  problems: 0,
  failed: false,
  readOnly: null,
  ...over,
});
const folder = (
  path: string,
  expanded: boolean,
  parent: string | null = null,
) => row(path, { kind: "folder", expanded, parent });

const rows = [
  row("README.md"),
  row("main.nf"),
  folder("modules", true),
  row("modules/a.nf", { parent: "modules", level: 2 }),
  folder("conf", false),
];
const NONE = { text: "", at: 0 };
const key = (k: string, extra: object = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});
const act = (focused: string | null, k: string, extra: object = {}) =>
  treeKey(rows, focused, key(k, extra), NONE, 1000).action;

describe("F-210 tree keys", () => {
  it("F-210 UX-70 QA-10: Down, Up, Home and End move through visible rows without wrapping", () => {
    expect(act("README.md", "ArrowDown")).toEqual({
      kind: "focus",
      path: "main.nf",
    });
    expect(act("main.nf", "ArrowUp")).toEqual({
      kind: "focus",
      path: "README.md",
    });
    expect(act("README.md", "ArrowUp")).toEqual({ kind: "none" });
    expect(act("conf", "ArrowDown")).toEqual({ kind: "none" });
    expect(act("main.nf", "Home")).toEqual({
      kind: "focus",
      path: "README.md",
    });
    expect(act("main.nf", "End")).toEqual({ kind: "focus", path: "conf" });
    expect(act(null, "ArrowDown")).toEqual({
      kind: "focus",
      path: "README.md",
    });
  });

  it("F-210 UX-70: Right expands a closed folder, then moves to its first child; Left collapses an open folder, then moves to its parent", () => {
    expect(act("conf", "ArrowRight")).toEqual({ kind: "expand", path: "conf" });
    expect(act("modules", "ArrowRight")).toEqual({
      kind: "focus",
      path: "modules/a.nf",
    });
    expect(act("main.nf", "ArrowRight")).toEqual({ kind: "none" });
    expect(act("modules", "ArrowLeft")).toEqual({
      kind: "collapse",
      path: "modules",
    });
    expect(act("modules/a.nf", "ArrowLeft")).toEqual({
      kind: "focus",
      path: "modules",
    });
    expect(act("conf", "ArrowLeft")).toEqual({ kind: "none" });
    expect(act("main.nf", "ArrowLeft")).toEqual({ kind: "none" });
  });

  it("F-210 UX-70: Enter opens a file and toggles a folder; Ctrl and Meta combinations are not handled", () => {
    expect(act("main.nf", "Enter")).toEqual({ kind: "open", path: "main.nf" });
    expect(act("modules", "Enter")).toEqual({
      kind: "toggle",
      path: "modules",
    });
    expect(act("main.nf", "ArrowDown", { ctrlKey: true })).toEqual({
      kind: "none",
    });
    expect(act("main.nf", "z", { metaKey: true })).toEqual({ kind: "none" });
    expect(act("main.nf", "z", { ctrlKey: true })).toEqual({ kind: "none" });
  });

  it("F-210 UX-70: typing moves to the next row starting with the typed text, wrapping, and the buffer resets after 500 ms", () => {
    const first = treeKey(rows, "README.md", key("m"), NONE, 1000);
    expect(first.action).toEqual({ kind: "focus", path: "main.nf" });
    // the same buffer narrows from the focused row
    const second = treeKey(rows, "main.nf", key("o"), first.typeAhead, 1100);
    expect(second.typeAhead.text).toBe("mo");
    expect(second.action).toEqual({ kind: "focus", path: "modules" });
    // a pause resets the buffer; case-insensitive, wrapping
    const third = treeKey(
      rows,
      "conf",
      key("R"),
      second.typeAhead,
      1100 + TYPEAHEAD_RESET_MS + 1,
    );
    expect(third.typeAhead.text).toBe("R");
    expect(third.action).toEqual({ kind: "focus", path: "README.md" });
    // no match: nothing moves
    expect(treeKey(rows, "main.nf", key("q"), NONE, 1000).action).toEqual({
      kind: "none",
    });
  });
});
