// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "../src/canvas/breadcrumb";
import { fileTabFor, type WorkflowTab } from "../src/canvas/canvas-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const crumb = (path: string, workflow: string | null, label: string) => ({
  path,
  workflow,
  label,
});
const tab: WorkflowTab = {
  kind: "workflow",
  id: "sub.nf#SORT",
  path: "sub.nf",
  workflow: "SORT",
  label: "SORT",
  mode: "graph",
  readOnly: null,
  trail: [crumb("main.nf", null, "main.nf"), crumb("a.nf", "ALIGN", "ALIGN")],
};

function mount(t: WorkflowTab, onOpen: (c: unknown) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<Breadcrumb tab={t} onOpen={onOpen} />));
  return host;
}

describe("F-307 UX-50 QA-11 breadcrumb", () => {
  it("F-307 UX-50 QA-11: a nav labelled Workflow path lists ancestor buttons in order and the current workflow with aria-current=page; clicking a crumb calls onOpen with it", () => {
    const opened: unknown[] = [];
    const host = mount(tab, (c) => opened.push(c));
    const nav = host.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Workflow path");
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["main.nf", "ALIGN"]);
    expect(host.querySelector("[aria-current=page]")?.textContent).toBe("SORT");
    act(() => buttons[1]?.click());
    expect(opened).toEqual([crumb("a.nf", "ALIGN", "ALIGN")]);
  });

  it("F-307 UX-50: a workflow with an empty trail shows only itself, and a file tab nothing", () => {
    const host = mount({ ...tab, trail: [] }, () => undefined);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector("[aria-current=page]")?.textContent).toBe("SORT");
    expect(mount(fileTabFor("README.md"), () => undefined).innerHTML).toBe("");
  });
});
