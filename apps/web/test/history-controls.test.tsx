import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryControlsView } from "../src/history/history-controls";

const none = { undo: null, redo: null, undoCount: 0, redoCount: 0 };
const noop = () => undefined;

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(\w+)<\/button>/g)].map((m) => ({
    name: m[1],
    disabled: /disabled/.test(m[0]),
    title: /title="([^"]*)"/.exec(m[0])?.[1],
    keys: /aria-keyshortcuts="([^"]*)"/.exec(m[0])?.[1],
  }));

describe("F-209 history controls", () => {
  it("F-209 UX-26 QA-11: Undo and Redo name the top step and shortcut, are disabled with nothing to undo or redo, and a polite status carries the notice", () => {
    const empty = renderToStaticMarkup(
      <HistoryControlsView
        history={none}
        notice={null}
        apple={false}
        onUndo={noop}
        onRedo={noop}
      />,
    );
    expect(buttons(empty)).toEqual([
      {
        name: "Undo",
        disabled: true,
        title: "Undo (Ctrl+Z)",
        keys: "Control+Z",
      },
      {
        name: "Redo",
        disabled: true,
        title: "Redo (Ctrl+Shift+Z)",
        keys: "Control+Shift+Z Control+Y",
      },
    ]);
    const html = renderToStaticMarkup(
      <HistoryControlsView
        history={{
          undo: "Add call to ALIGN",
          redo: "Create process REPORT",
          undoCount: 2,
          redoCount: 1,
        }}
        notice="Undone: Connect reads"
        apple={true}
        onUndo={noop}
        onRedo={noop}
      />,
    );
    expect(buttons(html)).toEqual([
      {
        name: "Undo",
        disabled: false,
        title: "Undo: Add call to ALIGN (⌘Z)",
        keys: "Meta+Z",
      },
      {
        name: "Redo",
        disabled: false,
        title: "Redo: Create process REPORT (⇧⌘Z)",
        keys: "Meta+Shift+Z",
      },
    ]);
    expect(html).toMatch(
      /<span[^>]*role="status"[^>]*aria-live="polite"[^>]*>Undone: Connect reads<\/span>|<span[^>]*aria-live="polite"[^>]*role="status"[^>]*>Undone: Connect reads<\/span>/,
    );
    expect(html).toContain("visually-hidden");
  });
});
