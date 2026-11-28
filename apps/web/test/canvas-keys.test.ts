import { describe, expect, it } from "vitest";
import {
  type CanvasKeyEvent,
  canvasKeyAction,
} from "../src/canvas/canvas-keys";

const press = (over: Partial<CanvasKeyEvent>): CanvasKeyEvent => ({
  key: "c",
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
const context = {
  readOnly: false,
  apple: false,
  nodesSelected: true,
  textSelected: false,
};
const target = (match: string): EventTarget =>
  ({
    closest: (selector: string) => (selector.includes(match) ? {} : null),
  }) as unknown as EventTarget;

describe("F-310 canvas keys", () => {
  it("F-310 UX-70: Delete and Backspace delete the selected nodes; with none selected they do nothing", () => {
    for (const key of ["Delete", "Backspace"]) {
      expect(canvasKeyAction(press({ key, ctrlKey: false }), context)).toBe(
        "delete-nodes",
      );
      expect(
        canvasKeyAction(press({ key, ctrlKey: false }), {
          ...context,
          nodesSelected: false,
        }),
      ).toBeNull();
    }
  });

  it("F-310 UX-70: Ctrl+C and Ctrl+V, or ⌘C and ⌘V on Apple platforms", () => {
    expect(canvasKeyAction(press({}), context)).toBe("copy");
    expect(canvasKeyAction(press({ key: "v" }), context)).toBe("paste");
    expect(canvasKeyAction(press({ key: "V" }), context)).toBe("paste");
    const mac = { ...context, apple: true };
    expect(canvasKeyAction(press({}), mac)).toBeNull();
    expect(canvasKeyAction(press({ ctrlKey: false, metaKey: true }), mac)).toBe(
      "copy",
    );
    expect(
      canvasKeyAction(press({ key: "v", ctrlKey: false, metaKey: true }), mac),
    ).toBe("paste");
    expect(canvasKeyAction(press({ metaKey: true }), context)).toBeNull();
    expect(canvasKeyAction(press({ shiftKey: true }), context)).toBeNull();
    expect(canvasKeyAction(press({ altKey: true }), context)).toBeNull();
  });

  it("F-310: copy needs a selection and yields to a text selection; paste needs none", () => {
    const none = { ...context, nodesSelected: false };
    expect(canvasKeyAction(press({}), none)).toBeNull();
    expect(canvasKeyAction(press({ key: "v" }), none)).toBe("paste");
    expect(
      canvasKeyAction(press({}), { ...context, textSelected: true }),
    ).toBeNull();
  });

  it("F-310: ignored in text fields, the editor and dialogs, and when already handled", () => {
    for (const match of ["input", "dialog", "code-editor-host"]) {
      const t = target(match);
      expect(canvasKeyAction(press({ target: t }), context)).toBeNull();
    }
    expect(
      canvasKeyAction(press({ defaultPrevented: true }), context),
    ).toBeNull();
    expect(canvasKeyAction(press({ repeat: true }), context)).toBeNull();
  });

  it("F-310 ADR-0056: delete and paste are null in read-only; copy stays", () => {
    const ro = { ...context, readOnly: true };
    expect(
      canvasKeyAction(press({ key: "Delete", ctrlKey: false }), ro),
    ).toBeNull();
    expect(canvasKeyAction(press({ key: "v" }), ro)).toBeNull();
    expect(canvasKeyAction(press({}), ro)).toBe("copy");
  });
});
