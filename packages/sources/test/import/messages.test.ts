import { describe, expect, it } from "vitest";
import { refuse } from "../../src/import/messages";

describe("import messages", () => {
  it("F-403 QA-32: refusals carry the documented copy", () => {
    expect(refuse("too-big", { size: 230_000_000 })).toEqual({
      ok: false,
      code: "too-big",
      message: "This zip is 230 MB. Imports take zips of up to 200 MB.",
    });
    expect(refuse("too-many-entries").message).toBe(
      "This zip has more than 20,000 files and folders. Imports take up to 20,000.",
    );
    expect(refuse("too-large-uncompressed").message).toBe(
      "This zip expands to more than 200 MB. Imports take up to 200 MB uncompressed.",
    );
    expect(refuse("not-zip").message).toBe(
      "This file isn't a zip archive, or it is damaged.",
    );
    expect(refuse("damaged", { path: "a.nf" }).message).toBe(
      "This zip is damaged: a.nf doesn't match its recorded size.",
    );
    expect(
      refuse("damaged", { path: "a.nf", cause: "invalid zip data" }).message,
    ).toBe(
      "This zip couldn't be unpacked at a.nf (invalid zip data). It may be damaged or password-protected.",
    );
    expect(refuse("too-slow").message).toBe(
      "This zip took more than 30 seconds to unpack and was stopped. It may be damaged.",
    );
    expect(refuse("gone").message).toBe(
      "That import is no longer available. Choose the zip file again.",
    );
  });
});
