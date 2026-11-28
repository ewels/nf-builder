import type { ReactElement, ReactNode } from "react";
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
    onClose: noop,
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
          readOnly: null,
        },
      ]),
    );
    expect(empty).toHaveLength(some.length);
    expect(empty.indexOf(controls)).toBe(1);
    expect(some.indexOf(controls)).toBe(1);
  });
});
