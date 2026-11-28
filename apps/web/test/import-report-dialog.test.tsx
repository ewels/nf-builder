import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type ImportReport,
  ImportReportDialog,
} from "../src/import/import-report-dialog";

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  source: {
    kind: "github",
    repo: "nf-core/fetchngs",
    ref: "1.13.0",
    sha: "955c892d80927cee633765e6e390f9cc6b7235c9",
  },
  projectName: "fetchngs",
  imported: 155,
  skipped: [{ reason: "binary", count: 1, bytes: 9, paths: ["a.png"] }],
  project: {
    revision: 1,
    files: 155,
    parseFailures: [
      {
        path: "bad.nf",
        status: "partial",
        problems: 1,
        unparsed: [{ keyword: "process", name: "SECOND" }],
      },
    ],
    processes: { typed: 1, legacy: 3 },
    workflows: { typed: 0, legacy: 0 },
    diagnostics: { errors: 0, warnings: 1, suggestions: 7 },
  },
  ...over,
});
const render = (r: ImportReport) =>
  renderToStaticMarkup(
    <ImportReportDialog report={r} onClose={() => undefined} />,
  );

describe("F-401 import report dialog", () => {
  it("F-401 step 3 UX-61: the report shows the source, imported and skipped counts, each parse failure, the legacy share and the suggestions count", () => {
    const html = render(report());
    expect(html).toContain("Import report");
    expect(html).toContain(
      "Imported nf-core/fetchngs at 1.13.0 (955c892) as fetchngs",
    );
    expect(html).toContain("155 imported, 1 skipped");
    expect(html).toContain("a.png");
    expect(html).toContain("bad.nf: process SECOND kept as text");
    expect(html).toContain("3 of 4 processes and workflows (75%)");
    expect(html).toContain("7 suggestions");
    expect(html).toContain("Close");
  });

  it("F-401 UX-61: no failures say None, no ref says the default branch, and a failed report says so", () => {
    const ok = report();
    const clean = render({
      ...ok,
      source: { ...ok.source, ref: null },
      project:
        "error" in ok.project
          ? ok.project
          : { ...ok.project, parseFailures: [] },
    });
    expect(clean).toContain("None");
    expect(clean).toContain("the default branch");
    expect(render(report({ project: { error: "worker gone" } }))).toContain(
      "The report couldn&#x27;t be made: worker gone",
    );
  });
});
