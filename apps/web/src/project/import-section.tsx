// The Import route of the New project dialog (F-403, IO-12, UX-61): a source (Zip file for now), the file input and the
// summary of what would be imported before anything is. Presentational; the state is in `zip-import.ts` (AR-31).
import { formatBytes, formatCount, type SkipReason } from "@nf-builder/sources";
import { type JSX, useId } from "react";
import type { ZipImportView } from "./zip-import";

export const SKIP_LABELS: Record<SkipReason, string> = {
  ignored: "Ignored by the list",
  "too-large": "Over 1 MB",
  binary: "Binary files",
  "unsafe-path": "Unsafe paths",
  duplicate: "Duplicate paths",
  unsupported: "Unsupported compression",
};

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`;

export function ImportSection(props: {
  readonly view: ZipImportView;
  readonly busy: boolean;
}): JSX.Element {
  const ids = useId();
  const { state } = props.view;
  const helpId = `${ids}-help`;
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
            onChange={(event) =>
              props.view.choose(event.target.files?.[0] ?? null)
            }
          />
        </label>
        {state.status === "reading" ? (
          <p className="muted" role="status">
            Reading {state.name}…
          </p>
        ) : null}
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
          {state.summary.skipped.length > 0 ? (
            <details>
              <summary>
                Skipped files (
                {formatCount(
                  state.summary.skipped.reduce((n, g) => n + g.count, 0),
                )}
                )
              </summary>
              {state.summary.skipped.map((group) => (
                <div key={group.reason}>
                  <h4>
                    {SKIP_LABELS[group.reason]}:{" "}
                    {plural(group.count, "file", "files")},{" "}
                    {formatBytes(group.bytes)}
                  </h4>
                  <ul className="import-paths">
                    {group.paths.map((path) => (
                      <li key={path}>{path}</li>
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
          ) : null}
          <label className="dialog-field" htmlFor={`${ids}-ignore`}>
            Ignore list
          </label>
          <textarea
            id={`${ids}-ignore`}
            className="import-ignore"
            rows={6}
            spellCheck={false}
            value={state.ignore}
            aria-describedby={helpId}
            aria-invalid={state.summary.ignoreProblems.length > 0}
            onChange={(event) => props.view.setIgnore(event.target.value)}
          />
          <p className="muted" id={helpId}>
            One pattern per line, as in .gitignore. A trailing / matches a
            folder and a leading / anchors to the top. Binary files and files
            over 1 MB are always skipped.
          </p>
          {state.summary.ignoreProblems.length > 0 ? (
            <ul className="dialog-error">
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
