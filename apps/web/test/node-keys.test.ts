// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openNode, opensPopup } from "../src/canvas/node-keys";

const node = (id: string, inner = "span") => {
  const el = document.createElement("div");
  el.className = "react-flow__node";
  el.setAttribute("data-id", id);
  const child = document.createElement(inner);
  el.append(child);
  document.body.append(el);
  return { el, child };
};

describe("F-303 node keys", () => {
  it("F-303 UX-40 UX-70: Enter on the selected node opens it", () => {
    const { el } = node("n1");
    expect(opensPopup({ key: "Enter", target: el }, "n1")).toBe("n1");
  });

  it("F-303 UX-40 F-206: Enter on another node, or with nothing selected, only selects it", () => {
    const { el } = node("n2");
    expect(opensPopup({ key: "Enter", target: el }, "n1")).toBeNull();
    expect(opensPopup({ key: "Enter", target: el }, null)).toBeNull();
  });

  it("F-303 UX-40: Space, other keys and Enter in a text field or on a button don't open it", () => {
    const { el } = node("n3");
    expect(opensPopup({ key: " ", target: el }, "n3")).toBeNull();
    expect(opensPopup({ key: "a", target: el }, "n3")).toBeNull();
    for (const tag of ["input", "textarea", "button"]) {
      const { child } = node("n3", tag);
      expect(opensPopup({ key: "Enter", target: child }, "n3")).toBeNull();
    }
  });

  it("F-303 UX-40: a target outside every node opens nothing", () => {
    const outside = document.createElement("div");
    expect(opensPopup({ key: "Enter", target: outside }, "n1")).toBeNull();
  });
});

describe("F-307 UX-40 UX-50: one handler routes opening a node", () => {
  const calls: string[] = [];
  const handlers = {
    onOpenCallee: (id: string) => calls.push(`tab:${id}`),
    onOpenNode: (id: string) => calls.push(`popup:${id}`),
  };

  it("F-307 UX-50: a workflow node opens its tab, even read-only (no popup handler)", () => {
    calls.length = 0;
    openNode(true, "w", null, handlers);
    openNode(true, "w", null, { onOpenCallee: handlers.onOpenCallee });
    expect(calls).toEqual(["tab:w", "tab:w"]);
  });

  it("F-303 UX-40: a process node opens its popup, and nothing read-only", () => {
    calls.length = 0;
    openNode(false, "p", null, handlers);
    openNode(false, "p", null, { onOpenCallee: handlers.onOpenCallee });
    expect(calls).toEqual(["popup:p"]);
  });
});
