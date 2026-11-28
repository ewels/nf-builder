import type { ImportPlan } from "@nf-builder/sources";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportSummaryView } from "../src/import/import-summary";

const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  files: [],
  summary: {
    source: "nf-core/fetchngs",
    stripped: null,
    files: 155,
    bytes: 2_287_680,
    skipped: [
      { reason: "binary", count: 4, bytes: 336_000, paths: ["a.png", "b.png"] },
    ],
    ignore: "work/\n",
    ignoreProblems: [],
  },
  breaches: [],
  hasNextflow: true,
  ...over,
});
const render = (p: ImportPlan) =>
  renderToStaticMarkup(
    <ImportSummaryView
      summary={p.summary}
      ignore={p.summary.ignore}
      onIgnoreChange={() => undefined}
      breaches={p.breaches}
      hasNextflow={p.hasNextflow}
    />,
  );

describe("F-401 import summary", () => {
  it("F-401 UX-61 IO-12: the summary shows files, size and skipped counts by reason, lists skipped paths, has a labelled ignore list, and shows breaches and the .nf warning", () => {
    const html = render(plan());
    expect(html).toContain("155 files, 2.3 MB");
    expect(html).toContain("Skipped files (4)");
    expect(html).toContain("a.png");
    expect(html).toMatch(/<label[^>]*>Ignore list<\/label>/);
    expect(html).not.toContain("No Nextflow scripts");
    const bad = render(
      plan({
        hasNextflow: false,
        breaches: [{ limit: "files", actual: 25_000, max: 20_000 }],
      }),
    );
    expect(bad).toContain("No Nextflow scripts (.nf) found.");
    expect(bad).toContain("25,000 files is over the limit of 20,000");
  });
});
