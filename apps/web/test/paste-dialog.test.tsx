import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasteAliasDialog } from "../src/canvas/paste-dialog";

describe("F-310 paste dialog", () => {
  it("F-310 ADR-0039: lists each alias with its reason, and offers Paste and Cancel", () => {
    const markup = renderToStaticMarkup(
      <PasteAliasDialog
        aliases={[
          { name: "FASTQC", alias: "FASTQC_2", reason: "called" },
          { name: "SIZE", alias: "SIZE_2", reason: "taken" },
        ]}
        onPaste={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(markup).toContain(">Paste with new names?<");
    expect(markup).toContain(
      "FASTQC is already called in this workflow. It will be included again as FASTQC_2.",
    );
    expect(markup).toContain(
      "The name SIZE is already used in this file. It will be included as SIZE_2.",
    );
    expect(markup).toContain(">Paste<");
    expect(markup).toContain(">Cancel<");
  });
});
