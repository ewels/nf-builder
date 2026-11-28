import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TabStripView } from "../src/shell/tab-strip";

const controls = <span role="status" />;
const noop = () => undefined;

const strip = (tabs: Parameters<typeof TabStripView>[0]["tabs"]) =>
  TabStripView({
    tabs,
    activeTab: tabs[0]?.id ?? null,
    controls,
    onSelect: noop,
    onMode: noop,
  });

const children = (element: ReactElement): ReactNode[] =>
  [(element.props as { children: ReactNode }).children].flat();

describe("F-209 QA-10 tab strip", () => {
  it("F-209 QA-10: the history controls keep the same child slot with and without tabs, so the live region is not remounted", () => {
    const empty = children(strip([]));
    const some = children(
      strip([
        {
          kind: "workflow",
          id: "main.nf#",
          path: "main.nf",
          workflow: null,
          label: "main.nf",
          mode: "graph",
        },
      ]),
    );
    expect(empty).toHaveLength(some.length);
    expect(empty.indexOf(controls)).toBe(1);
    expect(some.indexOf(controls)).toBe(1);
  });
});

describe("F-703 read-only tab strip", () => {
  it("F-703 UX-04 UX-27 AR-23: the read-only tab strip shows the workflow tabs only, with no view-mode toggle or undo and redo controls", () => {
    const tab = {
      kind: "workflow",
      id: "main.nf#",
      path: "main.nf",
      workflow: null,
      label: "main.nf",
      mode: "split",
    } as const;
    const html = (readOnly: boolean) =>
      renderToStaticMarkup(
        TabStripView({
          tabs: [tab],
          activeTab: tab.id,
          controls: readOnly ? null : <b className="history-controls" />,
          onSelect: noop,
          onMode: noop,
          readOnly,
        }),
      );
    const editable = html(false);
    expect(editable).toContain("history-controls");
    expect(editable).toContain("view-mode");
    const narrow = html(true);
    expect(narrow).toContain('role="tab"');
    expect(narrow).toContain(">main.nf</button>");
    expect(narrow).not.toContain("history-controls");
    expect(narrow).not.toContain("view-mode");
    expect(narrow).not.toContain("radio");
  });
});
