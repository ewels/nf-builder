import { expect, type Page, test } from "@playwright/test";
import { VISUAL_TAG } from "./browsers.ts";
import { canvasReady, expectBaseline, layoutSettled, node } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  createProjectInUi,
  readStoredDatabase,
  switcher,
  type WorkspaceHook,
} from "./projects.ts";
import {
  BLANK_NODES,
  canvasNodeIds,
  createFromTemplate,
  newProjectDialog,
  openNewProjectDialog,
  TEMPLATES,
  type TemplateCase,
  templateFilesOnDisk,
} from "./templates.ts";

const readFile = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (
        window as unknown as { nfBuilderEngine: WorkspaceHook }
      ).nfBuilderEngine.readFile(p),
    path,
  );

async function expectNodes(page: Page, nodes: TemplateCase["nodes"]) {
  await canvasReady(page);
  expect(await canvasNodeIds(page)).toEqual(nodes.map((n) => n.id).sort());
  for (const n of nodes) {
    const badge = node(page, n.id).locator(".canvas-badge");
    if (n.kind !== "call") continue;
    if (n.typed) await expect(badge).toHaveText("typed");
    else await expect(badge).toHaveCount(0);
  }
}

const hello = TEMPLATES[0] as TemplateCase;
const samplesheet = TEMPLATES[1] as TemplateCase;

test("F-203 step 1 UX-60 LA-11: Start blank opens main.nf's entry workflow with the expected nodes", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Blank one");
  await expectNodes(page, BLANK_NODES);
});

for (const template of [hello, samplesheet]) {
  test(`F-203 step 1 UX-60 LA-11 ${template.id === "hello-world" ? "UX-23" : "LA-41"}: ${template.name} shows the expected nodes, calls badged typed`, async ({
    page,
  }) => {
    await page.goto("./");
    await expect(switcher(page)).toBeEnabled();
    await createFromTemplate(page, template.name, template.name);
    await expectNodes(page, template.nodes);
  });
}

test(
  "F-203 step 1 ADR-0021: each template's canvas matches its approved baseline @visual",
  { tag: VISUAL_TAG },
  async ({ page }, testInfo) => {
    await page.goto("./");
    await expect(switcher(page)).toBeEnabled();
    for (const template of TEMPLATES) {
      await createFromTemplate(page, template.name, template.name);
      await canvasReady(page);
      await layoutSettled(page);
      await expectBaseline(page, testInfo, `template-${template.id}.png`, {
        target: page.locator(".workflow-canvas"),
      });
    }
  },
);

test("F-203 IO-01 LA-02: a project created from a template holds exactly the template's files, also after reload", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createFromTemplate(page, samplesheet.name, "Files check");
  const files = templateFilesOnDisk(samplesheet.id);
  const check = async () => {
    for (const file of files)
      await expect
        .poll(() => readFile(page, file.path), { timeout: 15_000 })
        .toBe(file.text);
    const db = await readStoredDatabase(page);
    const paths = ((db.stores.files?.records ?? []) as { path: string }[])
      .map((r) => r.path)
      .filter((p) => !p.startsWith(".nf-builder/"))
      .sort();
    expect(paths).toEqual(files.map((f) => f.path).sort());
  };
  await check();
  await page.reload();
  await expect(switcher(page)).toHaveText(/Files check/);
  await check();
});

test("F-203 UX-60 UX-70 QA-11: the dialog works by keyboard alone; Escape cancels and focus returns to the opener", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await switcher(page).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "New project…" }).focus();
  await page.keyboard.press("Enter");
  const dialog = newProjectDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await page.keyboard.type("By keyboard");
  await dialog.getByRole("radio", { name: "From a template" }).focus();
  await page.keyboard.press("Space");
  await dialog.getByRole("radio", { name: "Hello world" }).focus();
  await page.keyboard.press("Space");
  await dialog.getByRole("button", { name: "Create" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toHaveText(/By keyboard/);
  await expect(switcher(page)).toBeFocused();

  await switcher(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toBeFocused();
  await expect(switcher(page)).toHaveText(/By keyboard/);
});

test("F-203 UX-60 ADR-0002: the dialog lists stored projects and opens one", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  let dialog = await openNewProjectDialog(page);
  await expect(
    dialog.getByText("No projects in this browser yet."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await createProjectInUi(page, "Listed one");
  await createProjectInUi(page, "Listed two");
  dialog = await openNewProjectDialog(page);
  await expect(
    dialog.getByText("Projects are stored in this browser only."),
  ).toBeVisible();
  const list = dialog.getByRole("region", {
    name: "Projects in this browser",
  });
  await expect(list.getByRole("button", { name: "Listed one" })).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Listed two" }),
  ).toHaveAttribute("aria-current", "true");
  await list.getByRole("button", { name: "Listed one" }).click();
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toHaveText(/Listed one/);
});

test("F-203 UX-60: an empty name shows an error and creates nothing", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await openNewProjectDialog(page);
  await dialog.getByLabel("Name").fill("   ");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a name");
  await expect(dialog).toBeVisible();
  await expect(switcher(page)).toHaveText(/No project/);
  const db = await readStoredDatabase(page);
  expect(db.stores.projects?.records ?? []).toHaveLength(0);
});

test("F-203 UX-01 UX-60: the header's Templates button opens the dialog on From a template", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Templates" })
    .click();
  const dialog = newProjectDialog(page);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("radio", { name: "From a template" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("radio", { name: "Hello world" }),
  ).toBeChecked();
  await expect(dialog.getByText("Samplesheet to MultiQC")).toBeVisible();
});

test("F-203 QA-30: creating from each template raises no CSP violation or console error", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  for (const template of TEMPLATES) {
    await createFromTemplate(page, template.name, `CSP ${template.name}`);
    await canvasReady(page);
  }
  await page.waitForLoadState("load");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-203 QA-10 UX-01: Escape on the dialog opened from the header's Templates button returns focus to it", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const templates = page
    .getByRole("banner")
    .getByRole("button", { name: "Templates" });
  await templates.focus();
  await page.keyboard.press("Enter");
  const dialog = newProjectDialog(page);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(templates).toBeFocused();
});
