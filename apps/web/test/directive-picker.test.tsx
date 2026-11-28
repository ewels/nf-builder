// @vitest-environment jsdom
import type { DirectiveChoice } from "@nf-builder/engine";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectivePicker } from "../src/popup/directive-picker";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const choices: DirectiveChoice[] = [
  {
    name: "cpus",
    summary: "The number of CPUs.",
    kind: "integer",
    defaultArgs: "1",
  },
  {
    name: "memory",
    summary: "The memory a task may use.",
    kind: "memory",
    defaultArgs: "1.GB",
  },
  {
    name: "container",
    summary: "The image to run in.",
    kind: "string",
    defaultArgs: "",
  },
];

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

const options = () =>
  [...host.querySelectorAll('[role="option"]')].map(
    (o) => (o.querySelector(".directive-name") as HTMLElement).textContent,
  );
const search = () =>
  host.querySelector('[role="combobox"]') as HTMLInputElement;
const type = (text: string) =>
  act(() => {
    const input = search();
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const press = (key: string) =>
  act(() => {
    search().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

describe("F-303 directive picker", () => {
  it("F-303 UX-41 UX-70: typing filters by name and summary, arrows and Enter add, and No directives match. shows when empty", async () => {
    const onPick = vi.fn();
    await act(async () =>
      root.render(<DirectivePicker choices={choices} onPick={onPick} />),
    );
    expect(options()).toEqual(["cpus", "memory", "container"]);
    const list = host.querySelector('[role="listbox"]') as HTMLElement;
    expect(search().getAttribute("aria-controls")).toBe(list.id);
    await type("MEM");
    expect(options()).toEqual(["memory"]);
    await type("image");
    expect(options()).toEqual(["container"]);
    await type("");
    await press("ArrowDown");
    await press("Enter");
    expect(onPick).toHaveBeenCalledWith(choices[1]);
    await type("storeDir");
    expect(options()).toEqual([]);
    expect(host.textContent).toContain("No directives match.");
    await press("Enter");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("F-303 UX-41: the active option is announced with aria-activedescendant, and ArrowUp stops at the first", async () => {
    await act(async () =>
      root.render(
        <DirectivePicker choices={choices} onPick={() => undefined} />,
      ),
    );
    await press("ArrowDown");
    const active = search().getAttribute("aria-activedescendant");
    expect(
      host.querySelector(`#${active}`)?.getAttribute("aria-selected"),
    ).toBe("true");
    await press("ArrowUp");
    await press("ArrowUp");
    expect(options()[0]).toBe("cpus");
    const first = host.querySelector('[role="option"]');
    expect(first?.getAttribute("aria-selected")).toBe("true");
  });

  it("F-303 UX-41: clicking an option adds it", async () => {
    const onPick = vi.fn();
    await act(async () =>
      root.render(<DirectivePicker choices={choices} onPick={onPick} />),
    );
    await act(async () => {
      (host.querySelectorAll('[role="option"]')[2] as HTMLElement).click();
    });
    expect(onPick).toHaveBeenCalledWith(choices[2]);
  });
});
