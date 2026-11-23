// The New project dialog (F-203, UX-60): name, Nextflow version, Start blank or From a template, Publish docs, and the
// projects stored in this browser. A native <dialog> opened modally; native controls only, so it works by keyboard
// (QA-10, QA-11) and inside a cross-origin frame (ADR 0044). An error shows inline and the dialog stays open.
import { BLANK_TEMPLATE, type TemplateList } from "@nf-builder/engine";
import { importProblem } from "@nf-builder/sources";
import { type FormEvent, type JSX, useEffect, useId, useState } from "react";
import {
  DEFAULT_PROJECT_NAME,
  normaliseProjectName,
  PROJECT_NAME_MAX,
} from "../workspace/project-name";
import type { ImportChoice, ProjectMeta } from "../workspace/types";
import { ImportSection } from "./import-section";
import { useModal } from "./project-dialogs";
import type { TemplatesView } from "./templates";
import {
  type ZipImportState,
  type ZipImportView,
  zipProjectName,
} from "./zip-import";

export type NewProjectRoute = "blank" | "template" | "import";

export interface NewProjectRequest {
  readonly name: string;
  readonly languageVersion: string;
  /** The pack's template id; Start blank is `BLANK_TEMPLATE`, which the worker resolves, so it needs no list. Not set for an import. */
  readonly template?: string;
  /** The staged zip and the ignore list to select its files with (F-403). */
  readonly import?: ImportChoice;
  /** Carried with the request; it has no effect until F-606. */
  readonly publishDocs: boolean;
}

export interface NewProjectForm {
  readonly name: string;
  readonly languageVersion: string;
  readonly route: NewProjectRoute;
  readonly templateId: string | null;
  readonly publishDocs: boolean;
  readonly zip: ZipImportState;
}

/** The request for a filled-in form, or the message to show when it can't be made. */
export function newProjectRequest(
  form: NewProjectForm,
  list: TemplateList | null,
): NewProjectRequest | { readonly error: string } {
  const name = normaliseProjectName(form.name);
  if (name === null)
    return { error: `Enter a name of 1 to ${PROJECT_NAME_MAX} characters.` };
  if (form.route === "import") {
    const { zip } = form;
    // a refusal is already on screen in the Import section, so Create only asks for another file
    if (zip.status === "empty" || zip.status === "refused")
      return { error: "Choose a zip file to import." };
    if (zip.status === "reading")
      return { error: `Reading ${zip.name}. Try again in a moment.` };
    if (zip.updating)
      return { error: "Updating the summary. Try again in a moment." };
    const problem = importProblem(zip.summary);
    if (problem !== null) return { error: problem };
    return {
      name,
      languageVersion: form.languageVersion,
      publishDocs: form.publishDocs,
      import: { id: zip.id, ignore: zip.ignore },
    };
  }
  let template: string | null = BLANK_TEMPLATE;
  if (form.route === "template") {
    if (list === null) return { error: "Templates aren't loaded yet." };
    template = form.templateId;
  }
  if (template === null) return { error: "Choose a template." };
  return {
    name,
    languageVersion: form.languageVersion,
    template,
    publishDocs: form.publishDocs,
  };
}

/** What Create does: send a request, show a message, or ask for the template list again after it failed. */
export type SubmitOutcome =
  | { readonly request: NewProjectRequest }
  | { readonly error: string }
  | { readonly reload: true };

export function submitOutcome(
  form: NewProjectForm,
  templates: TemplatesView["state"],
): SubmitOutcome {
  const list = templates.status === "ready" ? templates.list : null;
  const request = newProjectRequest(form, list);
  if (!("error" in request)) return { request };
  // only a missing list is special; a bad name or no chosen template is reported as it is
  const waiting =
    form.route === "template" &&
    list === null &&
    normaliseProjectName(form.name) !== null;
  if (!waiting) return request;
  if (templates.status === "error") return { reload: true };
  return { error: "Templates are still loading. Try again in a moment." };
}

export interface NewProjectDialogProps {
  readonly languageVersions: readonly string[];
  /** The template hook (`useTemplates`), called with the version chosen in the dialog. */
  readonly useTemplates: (version: string) => TemplatesView;
  readonly projects: readonly ProjectMeta[];
  readonly currentId: string | null;
  readonly initialRoute: NewProjectRoute;
  /** The zip import hook (`useZipImport`): its stage is discarded when the dialog closes. */
  readonly useZipImport: () => ZipImportView;
  onCreate(request: NewProjectRequest): Promise<void>;
  onOpen(id: string): Promise<void>;
  onClose(): void;
}

export function NewProjectDialog(props: NewProjectDialogProps): JSX.Element {
  const modal = useModal(props.onClose);
  const ids = useId();
  const titleId = `${ids}-title`;
  const projectsId = `${ids}-projects`;
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const [languageVersion, setLanguageVersion] = useState(
    props.languageVersions[0] ?? "",
  );
  const { state: templates, reload } = props.useTemplates(languageVersion);
  const [route, setRoute] = useState<NewProjectRoute>(props.initialRoute);
  const [chosen, setChosen] = useState<string | null>(null);
  const [publishDocs, setPublishDocs] = useState(true);
  const list = templates.status === "ready" ? templates.list : null;
  const templateId = chosen ?? list?.templates[0]?.id ?? null;
  const zipView = props.useZipImport();
  const zip = zipView.state;
  // the zip's name becomes the project name while the field still holds the default or the last name taken from a zip
  const [autoName, setAutoName] = useState(DEFAULT_PROJECT_NAME);
  const zipName = zip.status === "ready" ? zip.name : null;
  useEffect(() => {
    if (zipName === null) return;
    const next = zipProjectName(zipName);
    setName((current) => (current === autoName ? next : current));
    setAutoName(next);
  }, [zipName, autoName]);
  const chooseRoute = (next: NewProjectRoute) => {
    if (next !== "import") zipView.reset();
    setRoute(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = submitOutcome(
      { name, languageVersion, route, templateId, publishDocs, zip },
      templates,
    );
    if ("reload" in outcome) {
      modal.setError(null);
      reload();
      return;
    }
    if ("error" in outcome) {
      modal.setError(outcome.error);
      return;
    }
    await modal.run(() => props.onCreate(outcome.request));
  };

  return (
    <dialog
      ref={modal.ref}
      className="project-dialog new-project-dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <form onSubmit={submit}>
        <h2 id={titleId}>New project</h2>
        <label className="dialog-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.target.select()}
            autoFocus
            maxLength={PROJECT_NAME_MAX * 2}
            required
          />
        </label>
        <label className="dialog-field">
          <span>Nextflow version</span>
          <select
            value={languageVersion}
            onChange={(event) => setLanguageVersion(event.target.value)}
          >
            {props.languageVersions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="dialog-group">
          <legend>How to start</legend>
          <label className="dialog-choice">
            <input
              type="radio"
              name={`${ids}-route`}
              checked={route === "blank"}
              onChange={() => chooseRoute("blank")}
            />
            <span>Start blank</span>
          </label>
          <label className="dialog-choice">
            <input
              type="radio"
              name={`${ids}-route`}
              checked={route === "template"}
              onChange={() => chooseRoute("template")}
            />
            <span>From a template</span>
          </label>
          <label className="dialog-choice">
            <input
              type="radio"
              name={`${ids}-route`}
              checked={route === "import"}
              onChange={() => chooseRoute("import")}
            />
            <span>Import</span>
          </label>
        </fieldset>
        {route === "import" ? (
          <ImportSection view={zipView} busy={modal.busy} />
        ) : null}
        {route === "template" ? (
          <fieldset className="dialog-group">
            <legend>Template</legend>
            {templates.status === "loading" ? (
              <p className="muted">Loading templates…</p>
            ) : null}
            {templates.status === "error" ? (
              <p className="muted">Templates couldn't be loaded.</p>
            ) : null}
            {list?.templates.map((template) => (
              <div className="dialog-choice" key={template.id}>
                <input
                  type="radio"
                  id={`${ids}-t-${template.id}`}
                  name={`${ids}-template`}
                  checked={templateId === template.id}
                  onChange={() => setChosen(template.id)}
                  aria-describedby={`${ids}-d-${template.id}`}
                />
                <label htmlFor={`${ids}-t-${template.id}`}>
                  {template.name}
                </label>
                <span
                  className="muted dialog-description"
                  id={`${ids}-d-${template.id}`}
                >
                  {template.description}
                </span>
              </div>
            ))}
          </fieldset>
        ) : null}
        <label className="dialog-choice">
          <input
            type="checkbox"
            checked={publishDocs}
            onChange={(event) => setPublishDocs(event.target.checked)}
          />
          <span>Publish docs to GitHub Pages</span>
        </label>
        <section className="dialog-projects" aria-labelledby={projectsId}>
          <h3 id={projectsId}>Projects in this browser</h3>
          {props.projects.length === 0 ? (
            <p className="muted">No projects in this browser yet.</p>
          ) : (
            <div className="project-list">
              {props.projects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  className="project-item"
                  aria-current={
                    project.id === props.currentId ? "true" : undefined
                  }
                  disabled={modal.busy}
                  onClick={() => modal.run(() => props.onOpen(project.id))}
                >
                  {project.name}
                </button>
              ))}
            </div>
          )}
          <p className="muted">
            Projects are stored in this browser only. Clearing site data deletes
            them.
          </p>
        </section>
        {modal.error ? (
          <p className="dialog-error" role="alert">
            {modal.error}
          </p>
        ) : null}
        <div className="dialog-buttons">
          <button type="button" onClick={() => modal.ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={modal.busy}>
            {modal.busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
