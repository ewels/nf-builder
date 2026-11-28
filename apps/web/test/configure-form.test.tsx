// @vitest-environment jsdom
import type {
  FieldProblem,
  FormChoices,
  TypedProcessForm,
} from "@nf-builder/engine";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigureForm } from "../src/popup/configure-form";
import { draftProblems } from "../src/popup/popup-store";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const form: TypedProcessForm = {
  kind: "typedProcess",
  name: "GREET",
  description: "Says hello.",
  docTags: null,
  inputs: [
    { origin: 0, kind: "named", name: "name", type: "String", nullable: false },
    { origin: 1, kind: "code", text: "record(id: String)" },
  ],
  stage: [{ origin: 0, directive: "stageAs", args: "'x'" }],
  outputs: [{ origin: 0, name: "text", type: "Path", value: "file('a.txt')" }],
  topics: [{ origin: 0, kind: "emit", value: "'v1'", topic: "versions" }],
  directives: [
    {
      origin: 0,
      kind: "named",
      name: "cpus",
      args: "1",
      deprecated: false,
      known: true,
    },
    {
      origin: 1,
      kind: "named",
      name: "storeDir",
      args: "'x'",
      deprecated: true,
      known: true,
    },
  ],
  script: { label: "script", text: "echo hi" },
  stub: "touch a.txt",
  kept: ["when: section"],
};
const choices: FormChoices = {
  directives: [
    { name: "cpus", summary: "CPUs.", kind: "integer", defaultArgs: "1" },
  ],
  stage: [{ name: "stageAs", hint: "stageAs(pattern)" }],
  types: ["Path", "String"],
};

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

const render = (props: Partial<Parameters<typeof ConfigureForm>[0]> = {}) =>
  act(async () =>
    root.render(
      <ConfigureForm
        draft={form}
        choices={choices}
        fields={[]}
        onChange={() => undefined}
        {...props}
      />,
    ),
  );

describe("F-303 configure form", () => {
  it("F-303 step 4 UX-42: the form has no kind control, and the legends are exactly UX-41's sections", async () => {
    await render();
    expect(
      [...host.querySelectorAll("legend")].map((l) => l.textContent),
    ).toEqual([
      "Name",
      "Description",
      "Inputs",
      "Stage",
      "Outputs",
      "Topics",
      "Directives",
      "Script",
      "Stub",
    ]);
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    const labels = [...host.querySelectorAll("label, legend")].map(
      (l) => l.textContent?.toLowerCase() ?? "",
    );
    expect(labels.some((t) => /\bkind\b/.test(t))).toBe(false);
  });

  it("F-303 UX-41: rows the form can't model show as written with a note, and the kept sections are listed", async () => {
    await render();
    expect(host.textContent).toContain("record(id: String)");
    expect(host.textContent).toContain(
      "Kept as written. Edit it in the Code tab.",
    );
    expect(host.textContent).toContain("Kept as written: when: section");
    expect(host.textContent).toContain("Deprecated");
  });

  it("F-303 UX-44: field problems mark their inputs aria-invalid, show their message and focus the first", async () => {
    const fields: FieldProblem[] = [
      {
        field: { section: "outputs", row: 0, part: "value" },
        message: "Not an expression.",
      },
      {
        field: { section: "inputs", row: 0, part: "name" },
        message: "Bad name.",
      },
    ];
    await render({ fields });
    const bad = [...host.querySelectorAll('[aria-invalid="true"]')];
    expect(bad).toHaveLength(2);
    expect(document.activeElement).toBe(
      host.querySelector('[data-field="outputs.0.value"]'),
    );
    const described = (document.activeElement as HTMLElement).getAttribute(
      "aria-describedby",
    );
    expect(host.querySelector(`#${described}`)?.textContent).toBe(
      "Not an expression.",
    );
  });

  it("F-303 UX-41: editing a field and the add and remove buttons report changes as draft functions", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    const name = host.querySelector('[data-field="name"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      set?.call(name, "SAY");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange.mock.calls.at(-1)?.[0](form)).toMatchObject({
      name: "SAY",
    });
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;
    await act(async () => button("Add input").click());
    const added = onChange.mock.calls.at(-1)?.[0](form) as TypedProcessForm;
    expect(added.inputs).toHaveLength(3);
    expect(added.inputs[2]).toMatchObject({
      origin: null,
      kind: "named",
      nullable: false,
    });
    await act(async () => button("Remove input name").click());
    const removed = onChange.mock.calls.at(-1)?.[0](form) as TypedProcessForm;
    expect(removed.inputs).toHaveLength(1);
    await act(async () => button("Move input name down").click());
    const moved = onChange.mock.calls.at(-1)?.[0](form) as TypedProcessForm;
    expect(moved.inputs.map((r) => r.origin)).toEqual([1, 0]);
  });

  it("F-303 UX-44: a disabled form (while applying) disables its fields and buttons", async () => {
    await render({ disabled: true });
    expect(host.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
  });
});

describe("F-303 draft problems", () => {
  it("F-303 UX-44: names must be identifiers and unique, and directives need a value", () => {
    const bad: TypedProcessForm = {
      ...form,
      name: "1x",
      inputs: [
        {
          origin: null,
          kind: "named",
          name: "a",
          type: "String",
          nullable: false,
        },
        {
          origin: null,
          kind: "named",
          name: "a",
          type: "String",
          nullable: false,
        },
        {
          origin: null,
          kind: "named",
          name: "",
          type: "String",
          nullable: false,
        },
      ],
      outputs: [
        { origin: null, name: "o", type: "", value: "x" },
        { origin: null, name: "o", type: "", value: "y" },
      ],
      directives: [
        {
          origin: null,
          kind: "named",
          name: "container",
          args: " ",
          deprecated: false,
          known: true,
        },
      ],
    };
    const messages = draftProblems(bad).map((p) => [
      p.field.section,
      p.field.row,
      p.message,
    ]);
    expect(messages).toEqual([
      ["name", null, expect.stringContaining("isn't a valid name")],
      ["inputs", 1, "Another input is already called a."],
      ["inputs", 2, "Enter a name for the input."],
      ["outputs", 1, "Another output is already called o."],
      ["directives", 0, "Enter a value for container."],
    ]);
    expect(draftProblems(form)).toEqual([]);
  });
});
