// The Import route of the New project dialog (F-403, IO-12, UX-61): a source (Zip file for now), the file input and the
// summary of what would be imported before anything is. Presentational; the state is in `zip-import.ts` (AR-31).
import {
  formatBytes,
  formatCount,
  type ImportSummary,
  type SkipReason,
} from "@nf-builder/sources";
import { type JSX, useId } from "react";
import type { ZipImportView } from "./zip-import";

const SKIP_LABELS: Record<SkipReason, string> = {
  ignored: "Ignored by the list",
  "too-large": "Over 1 MB",
  binary: "Binary or non-UTF-8 files",
  "unsafe-path": "Unsafe paths",
  duplicate: "Duplicate paths",
  unsupported: "Unsupported compression",
};

export const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`;

/** The skipped files of an import, grouped by reason (F-403); also shown by the Add files dialog (F-210). */
export function SkippedFiles({
  summary,
}: {
  readonly summary: ImportSummary;
}): JSX.Element | null {
  return summary.skipped.length > 0 ? (
    <details>
      <summary>
        Skipped files (
        {formatCount(summary.skipped.reduce((n, g) => n + g.count, 0))})
      </summary>
      {summary.skipped.map((group) => (
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
  ) : null;
}

/** Passes the chosen file on and empties the input, so choosing the same file again still fires `change`. */
export function takeChosenFile(
  view: Pick<ZipImportView, "choose">,
  input: { files: FileList | null; value: string },
): void {
  const file = input.files?.[0] ?? null;
  input.value = "";
  view.choose(file);
}

export function ImportSection(props: {
  readonly view: ZipImportView;
  readonly busy: boolean;
}): JSX.Element {
  const ids = useId();
  const { state } = props.view;
  const helpId = `${ids}-help`;
  const problemsId = `${ids}-problems`;
  return (
    <>
      <fieldset className="dialog-group">
        <legend>Import from</legend>
        <label className="dialog-choice">
          <input
            type="radio"
            name={`${ids}-source`}
            checked
            onChange={() => undefined}
          />
          <span>Zip file</span>
        </label>
        <label className="dialog-field">
          <span>Zip file to import</span>
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={props.busy}
            onChange={(event) => takeChosenFile(props.view, event.target)}
          />
        </label>
        {/* one live region that stays in the page, so its changes are announced */}
        <p className="muted" role="status">
          {state.status === "reading" ? `Reading ${state.name}…` : null}
          {state.status === "ready" && state.updating ? "Updating…" : null}
        </p>
        {state.status === "refused" ? (
          <p className="dialog-error" role="alert">
            {state.message}
          </p>
        ) : null}
      </fieldset>
      {state.status === "ready" ? (
        <section className="import-summary" aria-labelledby={`${ids}-summary`}>
          <h3 id={`${ids}-summary`}>Import summary</h3>
          <p>
            {plural(state.summary.files, "file", "files")},{" "}
            {formatBytes(state.summary.bytes)}
          </p>
          {state.summary.stripped !== null ? (
            <p className="muted">
              Removed the top-level folder {state.summary.stripped}/.
            </p>
          ) : null}
          <SkippedFiles summary={state.summary} />
          <label className="dialog-field" htmlFor={`${ids}-ignore`}>
            Ignore list
          </label>
          <textarea
            id={`${ids}-ignore`}
            className="import-ignore"
            rows={6}
            spellCheck={false}
            value={state.ignore}
            aria-describedby={
              state.summary.ignoreProblems.length > 0
                ? `${problemsId} ${helpId}`
                : helpId
            }
            aria-invalid={state.summary.ignoreProblems.length > 0}
            onChange={(event) => props.view.setIgnore(event.target.value)}
          />
          <p className="muted" id={helpId}>
            One pattern per line, as in .gitignore. A trailing / matches a
            folder and a leading / anchors to the top. Binary or non-UTF-8 files
            and files over 1 MB are always skipped.
          </p>
          {state.summary.ignoreProblems.length > 0 ? (
            <ul className="dialog-error" id={problemsId}>
              {state.summary.ignoreProblems.map((problem) => (
                <li key={problem.line}>
                  Line {problem.line}: {problem.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
