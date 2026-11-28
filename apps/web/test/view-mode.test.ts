import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  modesFor,
  shownMode,
  VIEW_MODES,
  type ViewModeKey,
  viewModeForKey,
} from "../src/views/view-mode";

const press = (over: Partial<ViewModeKey>): ViewModeKey => ({
  key: "g",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  target: null,
  ...over,
});

/** A target whose `closest` matches when the selector names `match`. */
const target = (match: string): EventTarget =>
  ({
    closest: (selector: string) => (selector.includes(match) ? {} : null),
  }) as unknown as EventTarget;

describe("F-208 view modes", () => {
  it("F-208 step 1 UX-70: viewModeForKey maps g, s and c, in either case, to Graph, Split and Code", () => {
    expect(VIEW_MODES.map((m) => m.mode)).toEqual(["graph", "split", "code"]);
    for (const [key, mode] of [
      ["g", "graph"],
      ["G", "graph"],
      ["s", "split"],
      ["S", "split"],
      ["c", "code"],
      ["C", "code"],
    ] as const)
      expect(viewModeForKey(press({ key }))).toBe(mode);
    expect(viewModeForKey(press({ key: "x" }))).toBeNull();
    expect(viewModeForKey(press({ key: "Enter" }))).toBeNull();
  });

  it("F-208 UX-70: modifier keys, repeats, composition, prevented events and editable targets (input, textarea, contenteditable, .code-editor-host) give no mode", () => {
    for (const over of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
      { target: target("input") },
      { target: target("textarea") },
      { target: target("[contenteditable]") },
      { target: target(".code-editor-host") },
    ])
      expect(viewModeForKey(press(over))).toBeNull();
    // a target that is not an element (the document) is not text entry
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
    expect(viewModeForKey(press({ target: target("nothing") }))).toBe("graph");
  });

  it("F-208 UX-70: a target inside a dialog gives no mode", () => {
    expect(viewModeForKey(press({ target: target("dialog") }))).toBeNull();
  });
});

describe("F-703 shown mode", () => {
  it("F-703 UX-04 UX-27: read-only, a tab in Split or Code mode shows only its graph and keeps its mode", () => {
    for (const mode of ["graph", "split", "code"] as const) {
      expect(shownMode(mode, true)).toBe("graph");
      expect(shownMode(mode, false)).toBe(mode);
    }
  });

  it("F-605 UX-27 UX-70: workflow tabs offer Graph, Split and Code, Markdown tabs Preview, Split and Code, other file tabs none; G, S and C pick the first, second and third mode", () => {
    const names = (kind: "workflow" | "file", path: string) =>
      modesFor(kind, path).map((m) => m.mode);
    expect(names("workflow", "main.nf")).toEqual(["graph", "split", "code"]);
    expect(names("file", "README.md")).toEqual(["preview", "split", "code"]);
    expect(names("file", "docs/a.markdown")).toEqual([
      "preview",
      "split",
      "code",
    ]);
    expect(names("file", "README.MD")).toEqual([]);
    expect(names("file", "conf/params.yml")).toEqual([]);
    const md = modesFor("file", "README.md");
    expect(viewModeForKey(press({ key: "g" }), md)).toBe("preview");
    expect(viewModeForKey(press({ key: "S" }), md)).toBe("split");
    expect(viewModeForKey(press({ key: "c" }), md)).toBe("code");
    expect(viewModeForKey(press({ key: "g" }), [])).toBeNull();
  });
});
