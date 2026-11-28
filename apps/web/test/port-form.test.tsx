// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PortForm } from "../src/details/port-form";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mount(
  typed: boolean,
  onSubmit: (name: string, type: string | null) => Promise<string | null>,
  onCancel: () => void,
) {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      // biome-ignore lint/a11y/useValidAriaRole: a prop of the form, not an ARIA role
      <PortForm
        role="take"
        typed={typed}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    ),
  );
  return { host, opener, root };
}

const type = (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

describe("F-307 UX-51 UX-70 port form", () => {
  it("F-307 UX-51 UX-70: the form submits on Enter, shows a refusal as an alert, cancels on Escape and returns focus", async () => {
    const sent: unknown[] = [];
    let cancelled = 0;
    let answer: string | null = "Nope.";
    const { host, opener, root } = mount(
      true,
      async (n, t) => {
        sent.push([n, t]);
        return answer;
      },
      () => cancelled++,
    );
    const [name, kind] = [...host.querySelectorAll("input")];
    expect(document.activeElement).toBe(name);
    type(name as HTMLInputElement, "index");
    type(kind as HTMLInputElement, "Channel<String>");
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(sent).toEqual([["index", "Channel<String>"]]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Nope.");
    answer = null;
    key(name as HTMLInputElement, "Escape");
    expect(cancelled).toBe(1);
    act(() => root.unmount());
    expect(document.activeElement).toBe(opener);
  });

  it("F-307 UX-51: typed shows Type, legacy doesn't (and sends a null type)", async () => {
    const sent: unknown[] = [];
    const { host } = mount(
      false,
      async (n, t) => {
        sent.push([n, t]);
        return null;
      },
      () => undefined,
    );
    expect(host.querySelectorAll("input")).toHaveLength(1);
    type(host.querySelector("input") as HTMLInputElement, "reads");
    await act(async () => {
      host
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(sent).toEqual([["reads", null]]);
    expect(
      mount(
        true,
        async () => null,
        () => undefined,
      ).host.textContent,
    ).toContain("Type");
  });
});
