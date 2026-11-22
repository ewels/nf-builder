import type { TemplateList } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NewProjectDialog,
  type NewProjectDialogProps,
  newProjectRequest,
} from "../src/project/new-project-dialog";
import type { ProjectMeta } from "../src/workspace/types";

const list: TemplateList = {
  version: "26.10",
  blank: { id: "blank", name: "Blank", description: "Nothing yet." },
  templates: [
    { id: "hello-world", name: "Hello world", description: "Says hello." },
    { id: "qc", name: "Samplesheet to MultiQC", description: "Runs QC." },
  ],
};
const meta = (id: string, name: string): ProjectMeta => ({
  id,
  name,
  languageVersion: "26.10",
  createdAt: 1,
  updatedAt: 1,
  openedAt: 1,
});
const none = async () => undefined;
const dialog = (over: Partial<NewProjectDialogProps> = {}) =>
  renderToStaticMarkup(
    <NewProjectDialog
      languageVersions={["26.10", "26.04"]}
      templates={{ status: "ready", list }}
      projects={[]}
      currentId={null}
      initialRoute="blank"
      onCreate={none}
      onOpen={none}
      onClose={() => undefined}
      {...over}
    />,
  );

describe("F-203 new project dialog", () => {
  it("F-203 UX-60 LA-01: name (Untitled project), a version select of installed packs only, and the Start blank and From a template routes", () => {
    const html = dialog();
    expect(html).toContain("New project");
    expect(html).toContain('value="Untitled project"');
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(options).toEqual(["26.10", "26.04"]);
    expect(html).toMatch(
      /<input[^>]*type="radio"[^>]*checked=""[^>]*>[\s\S]*?Start blank/,
    );
    expect(html).toContain("From a template");
    expect(html).not.toContain("Hello world");
    expect(html).toContain("Cancel");
    expect(html).toContain("Create");
  });

  it("F-203 UX-60: From a template lists each template as a radio with its description, the first selected", () => {
    const html = dialog({ initialRoute: "template" });
    const group = html.slice(html.indexOf("Template</legend>"));
    const radios = [...group.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('checked=""');
    expect(radios[1]).not.toContain('checked=""');
    for (const text of [
      "Hello world",
      "Says hello.",
      "Samplesheet to MultiQC",
      "Runs QC.",
    ])
      expect(group).toContain(text);
    expect(html).not.toMatch(/value="blank"/);
  });

  it("F-203 UX-60 FI-40: Publish docs to GitHub Pages is checked by default", () => {
    const html = dialog();
    expect(html).toMatch(
      /<input[^>]*type="checkbox"[^>]*checked=""[^>]*>[\s\S]*?Publish docs to GitHub Pages/,
    );
  });

  it("F-203 UX-60 ADR-0002: the dialog says projects are stored in this browser only and lists them, the open one current; with none it says so", () => {
    const html = dialog({
      projects: [meta("a", "Alpha"), meta("b", "Beta")],
      currentId: "b",
    });
    expect(html).toContain(
      "Projects are stored in this browser only. Clearing site data deletes them.",
    );
    expect(html).toMatch(/<button[^>]*>Alpha<\/button>/);
    expect(html).toMatch(/aria-current="true"[^>]*>Beta</);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Alpha</);
    expect(dialog()).toContain("No projects in this browser yet.");
  });

  it("F-203 QA-10: every control is labelled; descriptions are linked with aria-describedby; the dialog is labelled by its heading", () => {
    const html = dialog({ initialRoute: "template" });
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toMatch(
      new RegExp(`<h2[^>]*id="${labelledBy}"[^>]*>New project</h2>`),
    );
    expect(html).toMatch(/<form/);
    expect(html).toMatch(/<legend>How to start<\/legend>/);
    for (const field of [
      "Name",
      "Nextflow version",
      "Publish docs to GitHub Pages",
    ])
      expect(html).toContain(field);
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(described).toHaveLength(2);
    for (const id of described) expect(html).toMatch(new RegExp(`id="${id}"`));
    expect(html).not.toContain("tabindex");
  });

  it("F-203 UX-60: loading and failed template lists; Start blank stays usable", () => {
    const loading = dialog({
      initialRoute: "template",
      templates: { status: "loading" },
    });
    expect(loading).toContain("Loading templates…");
    const failed = dialog({
      initialRoute: "template",
      templates: { status: "error", message: "worker failed" },
    });
    expect(failed).toContain("Templates couldn&#x27;t be loaded.");
    for (const html of [loading, failed]) {
      expect(html).toMatch(
        /<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Create<\/button>/,
      );
      expect(html).toMatch(
        /<input[^>]*type="radio"(?![^>]*disabled)[^>]*>[\s\S]*?Start blank/,
      );
    }
  });

  it("F-203 UX-60: newProjectRequest rejects a bad name and returns the route's template id and the Publish docs value", () => {
    const form = {
      name: "  RNA ",
      languageVersion: "26.10",
      route: "blank" as const,
      templateId: null,
      publishDocs: true,
    };
    expect(newProjectRequest(form, list)).toEqual({
      name: "RNA",
      languageVersion: "26.10",
      template: "blank",
      publishDocs: true,
    });
    expect(
      newProjectRequest(
        { ...form, route: "template", templateId: "qc", publishDocs: false },
        list,
      ),
    ).toEqual({
      name: "RNA",
      languageVersion: "26.10",
      template: "qc",
      publishDocs: false,
    });
    for (const name of ["", "   ", "x".repeat(101)])
      expect(newProjectRequest({ ...form, name }, list)).toMatchObject({
        error: expect.stringContaining("1 to 100"),
      });
    expect(newProjectRequest(form, null)).toMatchObject({
      error: expect.any(String),
    });
    expect(
      newProjectRequest({ ...form, route: "template", templateId: null }, list),
    ).toMatchObject({ error: expect.stringContaining("template") });
  });
});
