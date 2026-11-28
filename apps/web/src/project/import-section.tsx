// The Import route of the New project dialog (F-403, F-401; IO-10, IO-12, UX-61): a source (Zip file or GitHub repository), its
// inputs and the summary of what would be imported before anything is. Presentational; the state is in `zip-import.ts` and
// `use-github-import.ts` (AR-31).
import type { JSX } from "react";
import { useId } from "react";
import { ImportSummaryView } from "../import/import-summary";
import type { GithubImportView } from "../import/use-github-import";
import type { ZipImportView } from "./zip-import";

export type ImportSource = "zip" | "github";

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
  readonly github: GithubImportView;
  readonly source: ImportSource;
  readonly busy: boolean;
  onSource(source: ImportSource): void;
}): JSX.Element {
  const ids = useId();
  const { state } = props.view;
  const gh = props.github;
  const input = (
    <>
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
    </>
  );
  const repository = (
    <>
      <label className="dialog-field">
        <span>Repository</span>
        <input
          type="text"
          value={gh.repo}
          placeholder="nf-core/fetchngs or github.com/nf-core/fetchngs"
          disabled={props.busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => gh.setRepo(event.target.value)}
        />
      </label>
      <label className="dialog-field">
        <span>Branch, tag or commit</span>
        <input
          type="text"
          value={gh.ref}
          disabled={props.busy}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${ids}-ref-help`}
          onChange={(event) => gh.setRef(event.target.value)}
        />
      </label>
      <p className="muted" id={`${ids}-ref-help`}>
        Leave empty for the default branch
      </p>
      <p className="muted" role="status">
        {gh.state.status === "checking" ? `Checking ${gh.state.slug}…` : null}
      </p>
      {gh.state.status === "failed" ? (
        <p className="dialog-error" role="alert">
          {gh.state.message}
        </p>
      ) : null}
    </>
  );
  return (
    <>
      <fieldset className="dialog-group">
        <legend>Import from</legend>
        <label className="dialog-choice">
          <input
            type="radio"
            name={`${ids}-source`}
            checked={props.source === "zip"}
            onChange={() => props.onSource("zip")}
          />
          <span>Zip file</span>
        </label>
        <label className="dialog-choice">
          <input
            type="radio"
            name={`${ids}-source`}
            checked={props.source === "github"}
            onChange={() => props.onSource("github")}
          />
          <span>GitHub repository</span>
        </label>
        {props.source === "zip" ? input : repository}
      </fieldset>
      {props.source === "zip" && state.status === "ready" ? (
        <ImportSummaryView
          summary={state.summary}
          ignore={state.ignore}
          onIgnoreChange={props.view.setIgnore}
        />
      ) : null}
      {props.source === "github" && gh.state.status === "ready" ? (
        <ImportSummaryView
          summary={gh.state.plan.summary}
          ignore={gh.state.ignore}
          onIgnoreChange={gh.setIgnore}
          breaches={gh.state.plan.breaches}
          hasNextflow={gh.state.plan.hasNextflow}
        />
      ) : null}
    </>
  );
}
