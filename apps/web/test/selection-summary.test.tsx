import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelectionSummary } from "../src/details/selection-summary";

const nodes = [
  { id: "a", label: "FASTQC", kind: "Process call" },
  { id: "b", label: "MULTIQC", kind: "Process call" },
];

describe("F-310 selection summary", () => {
  it("F-310 UX-30: two nodes show 'N nodes selected', the labels, Copy and Delete", () => {
    const markup = renderToStaticMarkup(
      <SelectionSummary
        nodes={nodes}
        onSelect={() => undefined}
        onCopy={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(markup).toContain(">2 nodes selected<");
    expect(markup).toContain(">FASTQC<");
    expect(markup).toContain(">MULTIQC<");
    expect(markup).toContain(">Copy<");
    expect(markup).toContain(">Delete<");
    expect(markup).toContain('data-details-state="selection"');
  });

  it("F-310 ADR-0056: no Delete button without a delete handler, and none for Copy without one", () => {
    const markup = renderToStaticMarkup(
      <SelectionSummary nodes={nodes} onSelect={() => undefined} />,
    );
    expect(markup).not.toContain(">Copy<");
    expect(markup).not.toContain(">Delete<");
    expect(markup).toContain(">2 nodes selected<");
  });
});
