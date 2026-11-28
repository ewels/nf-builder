import type { TypedProcessForm } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { formChanged, inputOrigins } from "../../src/form/form-diff";

const form: TypedProcessForm = {
  kind: "typedProcess",
  name: "P",
  description: "",
  docTags: null,
  inputs: [
    { origin: 0, kind: "named", name: "a", type: "String", nullable: false },
    { origin: 1, kind: "code", text: "record(b: String)" },
  ],
  stage: [],
  outputs: [],
  topics: [],
  directives: [],
  script: { label: "script", text: "'x'" },
  stub: null,
  kept: [],
};

describe("F-303 form diff", () => {
  it("F-303 UX-44: a form equal to itself is unchanged; any field, row order or row count change is a change", () => {
    expect(formChanged(form, structuredClone(form))).toBe(false);
    expect(formChanged(form, { ...form, name: "Q" })).toBe(true);
    expect(formChanged(form, { ...form, stub: "'y'" })).toBe(true);
    expect(
      formChanged(form, { ...form, inputs: [...form.inputs].reverse() }),
    ).toBe(true);
    expect(
      formChanged(form, { ...form, inputs: form.inputs.slice(0, 1) }),
    ).toBe(true);
  });

  it("F-303 UX-44: inputOrigins lists each row's origin, null for new rows", () => {
    expect(
      inputOrigins({
        ...form,
        inputs: [
          {
            origin: null,
            kind: "named",
            name: "n",
            type: "String",
            nullable: false,
          },
          ...form.inputs,
        ],
      }),
    ).toEqual([null, 0, 1]);
  });
});
