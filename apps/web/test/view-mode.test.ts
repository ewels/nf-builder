import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
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
