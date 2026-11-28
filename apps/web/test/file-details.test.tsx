import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileDetailsView, isScriptPath } from "../src/details/file-details";

const item = (kind: never, name: string, line: number) => ({
  kind,
  name,
  detail: "",
  line,
  range: { start: 0, end: 1 },
});

describe("F-605 file details", () => {
  it("F-605 FI-31: a .nf file with no workflow lists its declarations with kind, name and line", () => {
    const html = renderToStaticMarkup(
      <FileDetailsView
        path="lib/samples.nf"
        language="Nextflow"
        outline={{
          status: "ready",
          items: [
            item("enum" as never, "Kind", 3),
            item("record" as never, "Sample", 8),
            item("function" as never, "greet", 13),
          ],
        }}
      />,
    );
    expect(html).toContain("<h3>Declarations</h3>");
    const rows = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
      (m[1] ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    expect(rows).toEqual([
      "enum Kind line 3",
      "record Sample line 8",
      "function greet line 13",
    ]);
  });

  it("F-605 FI-31 ADR-0056: read-only outline rows are plain text, not buttons", () => {
    const html = renderToStaticMarkup(
      <FileDetailsView
        path="lib/samples.nf"
        language="Nextflow"
        readOnly
        outline={{
          status: "ready",
          items: [item("enum" as never, "Kind", 3)],
        }}
      />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("enum");
    expect(html).toContain("Kind");
    expect(html).toContain("line 3");
  });

  it("F-605 FI-31 AR-01: only a lower-case .nf is a script", () => {
    expect(isScriptPath("main.nf")).toBe(true);
    expect(isScriptPath("main.NF")).toBe(false);
    expect(isScriptPath("nextflow.config")).toBe(false);
  });

  it("F-605 FI-32: another file shows its path and language name", () => {
    const html = renderToStaticMarkup(
      <FileDetailsView path="conf/params.yml" language="YAML" outline={null} />,
    );
    expect(html).toContain("conf/params.yml");
    expect(html).toContain("YAML");
    expect(html).not.toContain("Declarations");
  });
});
