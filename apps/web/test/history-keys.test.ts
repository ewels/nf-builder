import { describe, expect, it } from "vitest";
import {
  ariaKeyShortcuts,
  type HistoryKeyEvent,
  historyActionForKey,
  isApplePlatform,
  shortcutText,
} from "../src/history/history-keys";

const press = (over: Partial<HistoryKeyEvent>): HistoryKeyEvent => ({
  key: "z",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  target: null,
  ...over,
});

const apple = (over: Partial<HistoryKeyEvent>): HistoryKeyEvent =>
  press({ ctrlKey: false, metaKey: true, ...over });

/** A target whose `closest` matches when the selector names `match`. */
const target = (match: string): EventTarget =>
  ({
    closest: (selector: string) => (selector.includes(match) ? {} : null),
  }) as unknown as EventTarget;

describe("F-209 history keys", () => {
  it("F-209 UX-70: Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redo on Windows and Linux; ⌘Z and ⇧⌘Z on Apple platforms", () => {
    expect(historyActionForKey(press({}), false)).toBe("undo");
    expect(historyActionForKey(press({ key: "Z" }), false)).toBe("undo");
    expect(
      historyActionForKey(press({ key: "Z", shiftKey: true }), false),
    ).toBe("redo");
    expect(historyActionForKey(press({ key: "y" }), false)).toBe("redo");
    expect(historyActionForKey(press({ key: "Y" }), false)).toBe("redo");
    expect(historyActionForKey(apple({}), true)).toBe("undo");
    expect(historyActionForKey(apple({ key: "Z", shiftKey: true }), true)).toBe(
      "redo",
    );
    // other keys, and a lone letter, are not history keys
    expect(historyActionForKey(press({ key: "x" }), false)).toBeNull();
    expect(historyActionForKey(press({ ctrlKey: false }), false)).toBeNull();
    // Ctrl+Shift+Y and ⌘Y are not redo
    expect(
      historyActionForKey(press({ key: "y", shiftKey: true }), false),
    ).toBeNull();
    expect(historyActionForKey(apple({ key: "y" }), true)).toBeNull();
  });

  it("F-209 UX-70 F-208: editable targets (input, textarea, contenteditable, .code-editor-host), dialogs, Alt, the other platform's modifier, repeats, composition and prevented events give nothing", () => {
    for (const over of [
      { target: target("input") },
      { target: target("textarea") },
      { target: target("[contenteditable]") },
      { target: target(".code-editor-host") },
      { target: target("dialog") },
      { altKey: true },
      { metaKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ])
      expect(historyActionForKey(press(over), false)).toBeNull();
    for (const over of [{ ctrlKey: true }, { altKey: true }])
      expect(historyActionForKey(apple(over), true)).toBeNull();
    expect(
      historyActionForKey(press({ target: target("nothing") }), false),
    ).toBe("undo");
  });

  it("F-209 UX-70: the platform is Apple for Mac, iPhone and iPad names only; shortcut texts follow it", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("iPhone")).toBe(true);
    expect(isApplePlatform("Win32")).toBe(false);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(shortcutText("undo", false)).toBe("Ctrl+Z");
    expect(shortcutText("redo", false)).toBe("Ctrl+Shift+Z");
    expect(shortcutText("undo", true)).toBe("⌘Z");
    expect(shortcutText("redo", true)).toBe("⇧⌘Z");
    expect(ariaKeyShortcuts("undo", false)).toBe("Control+Z");
    expect(ariaKeyShortcuts("redo", false)).toBe("Control+Shift+Z Control+Y");
    expect(ariaKeyShortcuts("undo", true)).toBe("Meta+Z");
    expect(ariaKeyShortcuts("redo", true)).toBe("Meta+Shift+Z");
  });
});
