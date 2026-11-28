// @vitest-environment jsdom
import type { CanvasNodeView } from "@nf-builder/engine";
import { ReactFlowProvider } from "@xyflow/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CardNode } from "../src/canvas/canvas-nodes";
import {
  ConnectTargetsContext,
  type TargetStatusMap,
} from "../src/canvas/connect-targets";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const view: CanvasNodeView = {
  id: "main.nf#/B@1",
  kind: "call",
  appearance: "process",
  shape: "card",
  title: "B",
  subtitle: "process",
  badge: null,
  inputs: [
    { id: "x", label: "x", type: "Path" },
    { id: "y", label: "y", type: "Path" },
  ],
  outputs: [{ id: "out", label: "out", type: "Path" }],
  ariaLabel: "B",
  x: 0,
  y: 0,
  width: 208,
  height: 100,
  rowHeight: 20,
};

function render(targets: TargetStatusMap | null): void {
  act(() =>
    root.render(
      <ReactFlowProvider>
        <ConnectTargetsContext.Provider value={targets}>
          <CardNode
            {...({ data: { view, portLabels: true } } as unknown as Parameters<
              typeof CardNode
            >[0])}
          />
        </ConnectTargetsContext.Provider>
      </ReactFlowProvider>,
    ),
  );
}

describe("F-302 canvas nodes", () => {
  it("F-302 UX-25: inputs aren't connection starts and outputs aren't ends; target statuses give the dim classes and titles", () => {
    render(null);
    expect(host.querySelector(".is-target-refused")).toBeNull();
    expect(host.querySelector(".is-dimmed")).toBeNull();
    // handles: target (input) can't start, source (output) can't end
    const inputs = host.querySelectorAll(".react-flow__handle.target");
    const outputs = host.querySelectorAll(".react-flow__handle.source");
    expect(inputs).toHaveLength(2);
    expect(outputs).toHaveLength(1);
    for (const h of inputs)
      expect(h.classList.contains("connectablestart")).toBe(false);
    for (const h of outputs)
      expect(h.classList.contains("connectableend")).toBe(false);

    render(
      new Map([
        [
          view.id,
          new Map([
            ["x", "refused"],
            ["y", "mismatch"],
          ]),
        ],
      ]),
    );
    const handles = [...host.querySelectorAll(".react-flow__handle.target")];
    expect(handles[0]?.classList.contains("is-target-refused")).toBe(true);
    expect(handles[1]?.classList.contains("is-target-mismatch")).toBe(true);
    const rows = host.querySelectorAll(".canvas-port.is-input");
    expect(rows[0]?.classList.contains("is-target-refused")).toBe(true);
    expect(rows[0]?.getAttribute("title")).toMatch(/can't be connected/i);
    expect(rows[1]?.classList.contains("is-target-mismatch")).toBe(true);
    expect(rows[1]?.getAttribute("title")).toMatch(/types/i);
    // one input still accepts a drop, so the card isn't dimmed
    expect(host.querySelector(".canvas-node.is-dimmed")).toBeNull();

    render(
      new Map([
        [
          view.id,
          new Map([
            ["x", "refused"],
            ["y", "refused"],
          ]),
        ],
      ]),
    );
    expect(host.querySelector(".canvas-node.is-dimmed")).not.toBeNull();
    render(
      new Map([
        [
          view.id,
          new Map([
            ["x", "ok"],
            ["y", "ok"],
          ]),
        ],
      ]),
    );
    expect(host.querySelector(".is-target-refused")).toBeNull();
  });
});
