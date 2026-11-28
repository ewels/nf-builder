// The summary of what an import would bring in, shared by the zip and GitHub sources (F-403, F-401; IO-12, UX-61). Presentational
// (AR-31): the numbers come from `planImport` or the worker's stage, and the ignore list is an editable text box.
import {
  formatBytes,
  formatCount,
  type ImportSummary,
  type LimitBreach,
  type SkipReason,
} from "@nf-builder/sources";
import { type JSX, useId } from "react";

export const SKIP_LABELS: Record<SkipReason, string> = {
  ignored: "Ignored by the list",
  "too-large": "Over 1 MB",
  binary: "Binary or non-UTF-8 files",
  "unsafe-path": "Unsafe paths",
  duplicate: "Duplicate paths",
  unsupported: "Unsupported compression",
};

export const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`;

const breachText = (b: LimitBreach): string =>
  b.limit === "files"
    ? `${formatCount(b.actual)} files is over the limit of ${formatCount(b.max)}. Add patterns to the ignore list, such as docs/ or tests/.`
    : `${formatBytes(b.actual)} is over the limit of ${formatBytes(b.max)}. Add patterns to the ignore list, such as data/.`;

/** The skipped files, grouped by reason, as a closed `<details>`. */
export function SkippedList(props: {
  readonly groups: ImportSummary["skipped"];
}): JSX.Element | null {
  const total = props.groups.reduce((n, g) => n + g.count, 0);
  if (total === 0) return null;
  return (
    <details>
      <summary>Skipped files ({formatCount(total)})</summary>
      {props.groups.map((group) => (
        <div key={group.reason}>
          <h4>
            {SKIP_LABELS[group.reason]}: {plural(group.count, "file", "files")},{" "}
            {formatBytes(group.bytes)}
          </h4>
          <ul className="import-paths">
            {group.paths.map((path, index) => (
              // the same path can be listed twice (duplicate entries)
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is static between renders
              <li key={`${index}:${path}`}>{path}</li>
            ))}
            {group.count > group.paths.length ? (
              <li className="muted">
                and {formatCount(group.count - group.paths.length)} more
              </li>
            ) : null}
          </ul>
        </div>
      ))}
    </details>
  );
}

export function ImportSummaryView(props: {
  readonly summary: ImportSummary;
  /** The text in the box, which may be ahead of the summary. */
  readonly ignore: string;
  onIgnoreChange(text: string): void;
  /** The GitHub source's limits; the zip's are refused when it is read. */
  readonly breaches?: readonly LimitBreach[];
  /** False shows the "No Nextflow scripts" warning (IO-14). Not passed for a zip. */
  readonly hasNextflow?: boolean;
}): JSX.Element {
  const ids = useId();
  const { summary } = props;
  const helpId = `${ids}-help`;
  const problemsId = `${ids}-problems`;
  return (
    <section className="import-summary" aria-labelledby={`${ids}-summary`}>
      <h3 id={`${ids}-summary`}>Import summary</h3>
      <p>
        {plural(summary.files, "file", "files")}, {formatBytes(summary.bytes)}
      </p>
      {summary.stripped !== null ? (
        <p className="muted">
          Removed the top-level folder {summary.stripped}/.
        </p>
      ) : null}
      {props.hasNextflow === false ? (
        <p className="muted">No Nextflow scripts (.nf) found.</p>
      ) : null}
      {props.breaches?.map((b) => (
        <p className="dialog-error" key={b.limit}>
          {breachText(b)}
        </p>
      ))}
      <SkippedList groups={summary.skipped} />
      <label className="dialog-field" htmlFor={`${ids}-ignore`}>
        Ignore list
      </label>
      <textarea
        id={`${ids}-ignore`}
        className="import-ignore"
        rows={6}
        spellCheck={false}
        value={props.ignore}
        aria-describedby={
          summary.ignoreProblems.length > 0 ? `${problemsId} ${helpId}` : helpId
        }
        aria-invalid={summary.ignoreProblems.length > 0}
        onChange={(event) => props.onIgnoreChange(event.target.value)}
      />
      <p className="muted" id={helpId}>
        One pattern per line, as in .gitignore. A trailing / matches a folder
        and a leading / anchors to the top. Binary or non-UTF-8 files and files
        over 1 MB are always skipped.
      </p>
      {summary.ignoreProblems.length > 0 ? (
        <ul className="dialog-error" id={problemsId}>
          {summary.ignoreProblems.map((problem) => (
            <li key={problem.line}>
              Line {problem.line}: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
