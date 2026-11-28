import type { TemplateList } from "@nf-builder/engine";
import { BLANK_TEMPLATE } from "@nf-builder/engine";
import type { ImportSummary } from "@nf-builder/sources";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { githubProjectName } from "../src/import/github-import";
import type { GithubImportView } from "../src/import/use-github-import";
import { takeChosenFile } from "../src/project/import-section";
import {
  NewProjectDialog,
  type NewProjectDialogProps,
  newProjectRequest,
  submitOutcome,
} from "../src/project/new-project-dialog";
import type { TemplatesState } from "../src/project/templates";
import type { ZipImportState, ZipImportView } from "../src/project/zip-import";
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
const view = (state: TemplatesState) => () => ({
  state,
  reload: () => undefined,
});
const none = async () => undefined;
const zipView = (state: ZipImportState): ZipImportView => ({
  state,
  choose: () => undefined,
  setIgnore: () => undefined,
  reset: () => undefined,
});
const githubView = (
  over: Partial<GithubImportView> = {},
): GithubImportView => ({
  state: { status: "idle" },
  repo: "",
  ref: "",
  setRepo: () => undefined,
  setRef: () => undefined,
  setIgnore: () => undefined,
  review: async () => undefined,
  reset: () => undefined,
  ...over,
});
const EMPTY_ZIP: ZipImportState = { status: "empty" };
const readyZip = (over: Partial<ImportSummary> = {}): ZipImportState => ({
  status: "ready",
  name: "rnaseq-nf-main.zip",
  id: "stage-1",
  ignore: "data/\n",
  updating: false,
  summary: {
    source: "rnaseq-nf-main.zip",
    stripped: "rnaseq-nf-main",
    files: 22,
    bytes: 30562,
    skipped: [
      { reason: "ignored", count: 12, bytes: 6083492, paths: ["data/a.fq"] },
      {
        reason: "binary",
        count: 1,
        bytes: 40309,
        paths: ["multiqc/nextflow_logo.png"],
      },
    ],
    ignore: "data/\n",
    ignoreProblems: [],
    ...over,
  },
});
const dialog = (
  over: Partial<NewProjectDialogProps> = {},
  zip: ZipImportState = EMPTY_ZIP,
) =>
  renderToStaticMarkup(
    <NewProjectDialog
      useZipImport={() => zipView(zip)}
      useGithubImport={() => githubView()}
      onImportGithub={none}
      languageVersions={["26.10", "26.04"]}
      useTemplates={view({ status: "ready", list })}
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

  it("F-203 LA-01: the version the dialog has selected is what reaches the templates hook", () => {
    const seen: string[] = [];
    dialog({
      languageVersions: ["26.04", "26.10"],
      useTemplates: (version) => {
        seen.push(version);
        return { state: { status: "ready", list }, reload: () => undefined };
      },
    });
    expect(seen).toEqual(["26.04"]);
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

  it("F-203 UX-60: while the list loads the dialog says so, and only a failure says the templates couldn't be loaded", () => {
    const loading = dialog({
      initialRoute: "template",
      useTemplates: view({ status: "loading" }),
    });
    expect(loading).toContain("Loading templates…");
    expect(loading).not.toContain("couldn&#x27;t be loaded");
    const failed = dialog({
      initialRoute: "template",
      useTemplates: view({ status: "error", message: "worker failed" }),
    });
    expect(failed).toContain("Templates couldn&#x27;t be loaded.");
    expect(failed).not.toContain("Loading templates");
    for (const html of [loading, failed]) {
      expect(html).toMatch(
        /<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Create<\/button>/,
      );
    }
  });

  it("F-203 UX-60 ADR-0047: Start blank sends BLANK_TEMPLATE while the list loads and after it failed; From a template waits, or retries after a failure", () => {
    const form = {
      name: "RNA",
      languageVersion: "26.10",
      route: "blank" as const,
      templateId: null,
      publishDocs: true,
      zip: EMPTY_ZIP,
    };
    const blank = {
      request: {
        name: "RNA",
        languageVersion: "26.10",
        template: BLANK_TEMPLATE,
        publishDocs: true,
      },
    };
    const failed = { status: "error", message: "worker failed" } as const;
    for (const state of [{ status: "loading" } as const, failed])
      expect(submitOutcome(form, state)).toEqual(blank);
    expect(submitOutcome(form, { status: "ready", list })).toEqual(blank);
    const fromTemplate = { ...form, route: "template" as const };
    expect(submitOutcome(fromTemplate, { status: "loading" })).toEqual({
      error: expect.stringContaining("still loading"),
    });
    expect(submitOutcome(fromTemplate, failed)).toEqual({ reload: true });
    expect(
      submitOutcome(
        { ...fromTemplate, templateId: "qc" },
        { status: "ready", list },
      ),
    ).toMatchObject({ request: { template: "qc" } });
    expect(submitOutcome({ ...fromTemplate, name: " " }, failed)).toMatchObject(
      { error: expect.stringContaining("1 to 100") },
    );
  });

  it("F-203 QA-10: the Projects in this browser section is labelled by its heading", () => {
    const html = dialog();
    const labelledBy = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toMatch(
      new RegExp(
        `<h3[^>]*id="${labelledBy}"[^>]*>Projects in this browser</h3>`,
      ),
    );
    expect(html).not.toContain('aria-label="Projects');
  });

  it("F-203 UX-60: newProjectRequest rejects a bad name and returns the route's template id and the Publish docs value", () => {
    const form = {
      name: "  RNA ",
      languageVersion: "26.10",
      route: "blank" as const,
      templateId: null,
      publishDocs: true,
      zip: EMPTY_ZIP,
    };
    expect(newProjectRequest(form, list)).toEqual({
      name: "RNA",
      languageVersion: "26.10",
      template: BLANK_TEMPLATE,
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
      template: BLANK_TEMPLATE,
    });
    expect(
      newProjectRequest({ ...form, route: "template" }, null),
    ).toMatchObject({ error: expect.any(String) });
    expect(
      newProjectRequest({ ...form, route: "template", templateId: null }, list),
    ).toMatchObject({ error: expect.stringContaining("template") });
  });

  it("F-403 UX-60: a third route, Import, with Zip file as its source and a labelled file input", () => {
    const blank = dialog();
    expect(blank).toContain("Import");
    expect(blank).not.toContain("Import from");
    const html = dialog({ initialRoute: "import" });
    expect(html).toMatch(/<legend>Import from<\/legend>/);
    expect(html).toMatch(
      /<input[^>]*type="radio"[^>]*checked=""[^>]*>[\s\S]*?Zip file<\/span>/,
    );
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*accept="\.zip,application\/zip,application\/x-zip-compressed"/,
    );
    expect(html).toContain("Zip file to import");
    // F-401 adds GitHub repository as the second source, not selected by default
    expect(html).toContain("GitHub repository");
    expect(html).not.toContain("<span>Repository</span>");
  });

  it("F-403 IO-12 UX-61 QA-10: a staged zip shows files and size, the removed folder, skipped groups and the labelled ignore list; a refusal is an alert", () => {
    const html = dialog({ initialRoute: "import" }, readyZip());
    expect(html).toContain("Import summary");
    expect(html).toContain("22 files, 31 kB");
    expect(html).toContain("Removed the top-level folder rnaseq-nf-main/.");
    expect(html).toContain("Skipped files (13)");
    expect(html).toContain("Binary or non-UTF-8 files");
    expect(html).toContain("multiqc/nextflow_logo.png");
    expect(html).toMatch(/<textarea[^>]*>data\/\n?<\/textarea>/);
    const labelled = /<label[^>]*for="([^"]+)"[^>]*>Ignore list<\/label>/.exec(
      html,
    )?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${labelled}"`));
    expect(html).toContain("One pattern per line, as in .gitignore.");
    expect(
      dialog({ initialRoute: "import" }, readyZip({ files: 1 })),
    ).toContain("1 file, 31 kB");
    const problem = dialog(
      { initialRoute: "import" },
      readyZip({
        ignoreProblems: [{ line: 2, text: "!x", message: "Not supported." }],
      }),
    );
    expect(problem).toContain("Line 2: Not supported.");
    const refused = dialog(
      { initialRoute: "import" },
      { status: "refused", name: "x.zip", message: "This zip is damaged." },
    );
    expect(refused).toMatch(/<p[^>]*role="alert"[^>]*>This zip is damaged\.</);
    const reading = dialog(
      { initialRoute: "import" },
      { status: "reading", name: "x.zip" },
    );
    expect(reading).toMatch(/role="status"[^>]*>Reading x\.zip…/);
    const updating = dialog({ initialRoute: "import" }, {
      ...(readyZip() as object),
      updating: true,
    } as ZipImportState);
    expect(updating).toMatch(/role="status"[^>]*>Updating…/);
    // the live region is in the page in every state, empty when there is nothing to say
    for (const zip of [EMPTY_ZIP, readyZip()])
      expect(dialog({ initialRoute: "import" }, zip)).toMatch(
        /<p[^>]*role="status"[^>]*><\/p>/,
      );
    const described = /<textarea[^>]*aria-describedby="([^"]+)"/.exec(
      problem,
    )?.[1];
    const listId = /<ul[^>]*id="([^"]+)"[^>]*>\s*<li>Line 2/.exec(problem)?.[1];
    expect(listId).toBeTruthy();
    expect(described?.split(" ")).toContain(listId);
  });

  it("F-403 UX-60 IO-12: newProjectRequest for Import needs a read zip with files and no list problems, and carries its id and ignore text without a template", () => {
    const form = (zip: ZipImportState) => ({
      name: "RNA",
      languageVersion: "26.10",
      route: "import" as const,
      templateId: null,
      publishDocs: true,
      zip,
    });
    expect(newProjectRequest(form(readyZip()), null)).toEqual({
      name: "RNA",
      languageVersion: "26.10",
      publishDocs: false,
      import: { id: "stage-1", ignore: "data/\n" },
    });
    expect(newProjectRequest(form(EMPTY_ZIP), null)).toEqual({
      error: "Choose a zip file to import.",
    });
    expect(
      newProjectRequest(form({ status: "reading", name: "a.zip" }), null),
    ).toMatchObject({ error: expect.stringContaining("Reading") });
    expect(
      newProjectRequest(
        form({ status: "refused", name: "a.zip", message: "No." }),
        null,
      ),
    ).toEqual({ error: "Choose a zip file to import." });
    expect(
      newProjectRequest(
        form(
          readyZip({
            ignoreProblems: [{ line: 3, text: "[a]", message: "Bad." }],
          }),
        ),
        null,
      ),
    ).toEqual({ error: "Fix the ignore list first. Line 3: Bad." });
    expect(
      newProjectRequest(
        form({ ...(readyZip() as object), updating: true } as ZipImportState),
        null,
      ),
    ).toEqual({ error: "Updating the summary. Try again in a moment." });
    expect(newProjectRequest(form(readyZip({ files: 0 })), null)).toEqual({
      error: "Nothing to import: every file was skipped.",
    });
  });

  it("F-403 IO-12: choosing a file empties the input, so the same file can be chosen again after a refusal", () => {
    const chosen: (File | null)[] = [];
    const picked = new File(["x"], "a.zip");
    const input = {
      files: [picked] as unknown as FileList,
      value: "C:\\a.zip",
    };
    takeChosenFile({ choose: (f) => void chosen.push(f) }, input);
    expect(chosen).toEqual([picked]);
    expect(input.value).toBe("");
    takeChosenFile(
      { choose: (f) => void chosen.push(f) },
      { files: null, value: "x" },
    );
    expect(chosen.at(-1)).toBeNull();
  });

  it("F-403 IO-12: a skipped group that lists the same path twice renders without duplicate keys", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const html = dialog(
        { initialRoute: "import" },
        readyZip({
          skipped: [
            {
              reason: "duplicate",
              count: 2,
              bytes: 2,
              paths: ["a.nf", "a.nf"],
            },
          ],
        }),
      );
      expect(html.match(/<li>a\.nf<\/li>/g)).toHaveLength(2);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("F-401 new project dialog, GitHub source", () => {
  it("F-401 UX-60 QA-10: the GitHub source has a labelled Repository and Branch, tag or commit field, no token field and no Publish docs checkbox", () => {
    const html = dialog({ initialRoute: "import", initialSource: "github" });
    expect(html).toContain("GitHub repository");
    expect(html).toMatch(/<span>Repository<\/span>/);
    expect(html).toMatch(/<span>Branch, tag or commit<\/span>/);
    expect(html).toContain("Leave empty for the default branch");
    expect(html).not.toMatch(/token/i);
    expect(html).not.toContain("Publish docs to GitHub Pages");
    expect(html).toContain(">Review</button>");
    // the other routes keep it
    expect(dialog({ initialRoute: "template" })).toContain(
      "Publish docs to GitHub Pages",
    );
  });

  it("F-401 UX-60: Publish docs is hidden on the whole Import route, the zip source too", () => {
    expect(dialog({ initialRoute: "import" })).not.toContain(
      "Publish docs to GitHub Pages",
    );
  });

  it("F-401 UX-60: the name follows the repository name until the user edits it", () => {
    expect(githubProjectName("nf-core/fetchngs")).toBe("fetchngs");
    expect(githubProjectName("https://github.com/nf-core/fetchngs.git")).toBe(
      "fetchngs",
    );
    expect(githubProjectName("nonsense")).toBeNull();
  });

  it("F-401 UX-61: a reviewed repository shows the summary and an Import button with the file count", () => {
    const summary = {
      source: "nf-core/fetchngs",
      stripped: null,
      files: 155,
      bytes: 2_287_680,
      skipped: [],
      ignore: "work/\n",
      ignoreProblems: [],
    };
    const html = dialog({
      initialRoute: "import",
      initialSource: "github",
      useGithubImport: () =>
        githubView({
          repo: "nf-core/fetchngs",
          state: {
            status: "ready",
            review: {} as never,
            ignore: "work/\n",
            plan: { files: [], summary, breaches: [], hasNextflow: true },
          },
        }),
    });
    expect(html).toContain("155 files, 2.3 MB");
    expect(html).toContain(">Import 155 files</button>");
  });
});
