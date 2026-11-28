// The Import report (F-401, UX-61): what a GitHub import brought in, what it left out, what the parser kept as text and how
// much of the code uses legacy syntax. Session-only; presentational (AR-31).
import { legacyShare, type ProjectReport } from "@nf-builder/engine";
import { formatCount, type SkipGroup } from "@nf-builder/sources";
import { type JSX, useEffect, useId, useRef } from "react";
import { showModalOnce } from "../project/project-dialogs";
import type { GithubSource } from "../workspace/types";
import { plural, SkippedList } from "./import-summary";

export interface ImportReport {
  readonly source: GithubSource;
  readonly projectName: string;
  readonly imported: number;
  readonly skipped: readonly SkipGroup[];
  readonly project: ProjectReport | { readonly error: string };
}

function ProjectSection(props: {
  readonly report: ProjectReport;
}): JSX.Element {
  const { report } = props;
  const share = legacyShare(report);
  const typed = report.processes.typed + report.workflows.typed;
  return (
    <>
      <h3>Parse failures</h3>
      {report.parseFailures.length === 0 ? (
        <p>None</p>
      ) : (
        <ul className="import-paths">
          {report.parseFailures.map((f) => (
            <li key={f.path}>
              {f.unparsed.length > 0
                ? f.unparsed
                    .map(
                      (u) =>
                        `${f.path}: ${[u.keyword, u.name].filter(Boolean).join(" ")} kept as text`,
                    )
                    .join("; ")
                : `${f.path}: ${f.status === "verbatim" ? "kept as text" : "partly kept as text"}`}
            </li>
          ))}
        </ul>
      )}
      <h3>Legacy syntax</h3>
      <p>
        {share.total === 0
          ? "No processes or workflows."
          : `${formatCount(share.legacy)} of ${formatCount(share.total)} processes and workflows (${Math.round((share.legacy / share.total) * 100)}%). ${formatCount(typed)} typed.`}
      </p>
      <h3>Suggestions</h3>
      <p>
        {plural(report.diagnostics.suggestions, "suggestion", "suggestions")}
      </p>
    </>
  );
}

export function ImportReportDialog(props: {
  readonly report: ImportReport;
  onClose(): void;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => showModalOnce(ref.current), []);
  const { report } = props;
  const { source } = report;
  const skipped = report.skipped.reduce((n, g) => n + g.count, 0);
  return (
    <dialog
      ref={ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <h2 id={titleId}>Import report</h2>
      <p>{`Imported ${source.repo} at ${source.ref ?? "the default branch"} (${source.sha.slice(0, 7)}) as ${report.projectName}`}</p>
      <h3>Files</h3>
      <p>{`${formatCount(report.imported)} imported, ${formatCount(skipped)} skipped`}</p>
      <SkippedList groups={report.skipped} />
      {"error" in report.project ? (
        <p className="dialog-error" role="alert">
          The report couldn't be made: {report.project.error}
        </p>
      ) : (
        <ProjectSection report={report.project} />
      )}
      <div className="dialog-buttons">
        <button
          type="button"
          className="primary"
          onClick={() => ref.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
