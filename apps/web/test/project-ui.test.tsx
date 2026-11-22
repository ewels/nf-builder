import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "../src/app-shell";
import {
  DeleteProjectDialog,
  ProjectNameDialog,
} from "../src/project/project-dialogs";
import {
  CanvasPlaceholder,
  formatOpening,
  PersistenceNote,
  StorageWarning,
  saveLabel,
} from "../src/project/project-status";
import { INITIAL_STATUS } from "../src/project/project-store";
import { ProjectSwitcher } from "../src/project/project-switcher";
import type { ProjectMeta, WorkspaceStatus } from "../src/workspace/types";

const meta = (id: string, name: string): ProjectMeta => ({
  id,
  name,
  languageVersion: "26.10",
  createdAt: 1,
  updatedAt: 1,
  openedAt: 1,
});
const noop = () => undefined;
const switcher = (over: Partial<Parameters<typeof ProjectSwitcher>[0]> = {}) =>
  renderToStaticMarkup(
    <ProjectSwitcher
      projects={[]}
      current={null}
      onOpen={noop}
      onNew={noop}
      onRename={noop}
      onDelete={noop}
      {...over}
    />,
  );

describe("F-202 project UI", () => {
  it("F-202 IO-01 UX-01: the save state reads Nothing to save without a project, then Saved, Saving… or Save failed", () => {
    const ok = { status: "saved", error: null } as const;
    expect(saveLabel(false, { status: "saving", error: null })).toBe(
      "Nothing to save",
    );
    expect(saveLabel(true, ok)).toBe("Saved");
    expect(saveLabel(true, { status: "saving", error: null })).toBe("Saving…");
    expect(saveLabel(true, { status: "failed", error: "full" })).toBe(
      "Save failed",
    );
  });

  it("F-202 UX-01: the switcher shows the open project's name or No project and controls the project panel", () => {
    expect(switcher()).toMatch(/<button[^>]*aria-expanded="false"[^>]*>/);
    expect(switcher()).toContain("No project");
    const html = switcher({ current: meta("a", "Alpha") });
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(html).toMatch(new RegExp(`<div[^>]*id="${id}"`));
    expect(html).toContain("Alpha");
  });

  it("F-202 UX-01: the panel lists projects with the open one current, then New, Rename and Delete; Rename and Delete are disabled with no project", () => {
    const a = meta("a", "Alpha");
    const b = meta("b", "Beta");
    const html = switcher({
      projects: [b, a],
      current: a,
      initiallyOpen: true,
    });
    const panel = html.slice(html.indexOf("project-panel"));
    expect(panel.indexOf("Beta")).toBeLessThan(panel.indexOf("Alpha"));
    expect(html).toMatch(/aria-current="true"[^>]*>Alpha</);
    expect(html).not.toMatch(/aria-current="true"[^>]*>Beta</);
    const order = ["New project…", "Rename project…", "Delete project…"].map(
      (t) => panel.indexOf(t),
    );
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order[0]).toBeGreaterThan(panel.indexOf("Alpha"));
    expect(html).not.toMatch(/disabled=""[^>]*>Rename project…/);
    const empty = switcher({ initiallyOpen: true });
    expect(empty).toMatch(/disabled=""[^>]*>Rename project…/);
    expect(empty).toMatch(/disabled=""[^>]*>Delete project…/);
    expect(empty).not.toMatch(/disabled=""[^>]*>New project…/);
  });

  it("F-202 ADR-0002: the New project dialog says projects are stored in this browser only", () => {
    const html = renderToStaticMarkup(
      <ProjectNameDialog
        mode="create"
        initialName="Untitled project"
        onSubmit={async () => undefined}
        onClose={noop}
      />,
    );
    expect(html).toContain("Projects are stored in this browser only.");
    expect(html).toContain('value="Untitled project"');
    expect(html).toContain("New project");
    const del = renderToStaticMarkup(
      <DeleteProjectDialog
        project={meta("a", "Alpha")}
        onConfirm={async () => undefined}
        onClose={noop}
      />,
    );
    expect(del).toContain("Delete “Alpha”?");
    expect(del).toContain("can&#x27;t be recovered");
  });

  it('F-202 QA-03: the canvas area shows "Opening X: 3 of 17 files" with a progress bar', () => {
    const status: WorkspaceStatus = {
      ...INITIAL_STATUS,
      storage: "ready",
      opening: {
        project: meta("a", "Sarek"),
        progress: { phase: "parsing", done: 3, total: 17, path: null },
      },
    };
    expect(formatOpening("Sarek", status.opening?.progress ?? null)).toBe(
      "Opening Sarek: 3 of 17 files",
    );
    const html = renderToStaticMarkup(<CanvasPlaceholder status={status} />);
    expect(html).toContain("Opening Sarek: 3 of 17 files");
    expect(html).toMatch(/<progress[^>]*max="17"[^>]*value="3"/);
    expect(html).toContain('role="status"');
  });

  it("F-202 UX-01 IO-14: the canvas area explains unavailable storage, open errors, an open project and none", () => {
    const base: WorkspaceStatus = { ...INITIAL_STATUS, storage: "ready" };
    const text = (s: WorkspaceStatus) =>
      renderToStaticMarkup(<CanvasPlaceholder status={s} />);
    expect(
      text({ ...base, storage: "unavailable", storageError: "blocked" }),
    ).toContain("Projects can&#x27;t be stored in this browser: blocked");
    expect(
      text({
        ...base,
        openError: { project: meta("a", "Alpha"), message: "broken" },
      }),
    ).toContain("Couldn&#x27;t open Alpha: broken");
    expect(text({ ...base, current: meta("a", "Alpha") })).toContain(
      "No workflow open",
    );
    expect(text(base)).toContain("No project open");
  });

  it("F-202 step 3 IO-03: the header shows the storage warning only at or above 80%", () => {
    const html = renderToStaticMarkup(
      <StorageWarning usage={{ usage: 85, quota: 100, fraction: 0.85 }} />,
    );
    expect(html).toMatch(/role="alert"[^>]*>Storage 85% full</);
    expect(renderToStaticMarkup(<AppShell />)).not.toContain("Storage ");
  });

  it("F-202 IO-03 ADR-0044: the persistence note is quiet text, not an alert", () => {
    const html = renderToStaticMarkup(<PersistenceNote />);
    expect(html).toContain(
      "This browser may clear these projects when it needs space.",
    );
    expect(html).not.toContain("role=");
  });
});
