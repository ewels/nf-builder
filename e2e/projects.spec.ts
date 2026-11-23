import { expect, type Page, test } from "@playwright/test";
import { SMOKE_TAG } from "./browsers.ts";
import { canvasReady } from "./canvas.ts";
import { watchForCspViolations } from "./csp.ts";
import {
  createProjectInUi,
  editReadme,
  readFile,
  readStoredDatabase,
  recordSaveStates,
  saveState,
  stubStorage,
  switcher,
} from "./projects.ts";
import { templateFilesOnDisk } from "./templates.ts";
import { PREVIEW_URL } from "./urls.ts";

const warning = (page: Page) =>
  page
    .getByRole("banner")
    .getByRole("alert")
    .filter({ hasText: /Storage \d+% full/ });

async function rename(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole("button", { name: "Rename project…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename project" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await dialog.waitFor({ state: "hidden" });
}

test("F-202 step 1 IO-01 LA-01 QA-30: create a project, rename it, edit a file, reload: the project reopens with its new name and the edit", {
  tag: SMOKE_TAG,
}, async ({ page }) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(switcher(page)).toHaveText(/No project/);
  await createProjectInUi(page, "First draft");
  await rename(page, "Renamed draft");
  await expect(switcher(page)).toHaveText(/Renamed draft/);
  await editReadme(page, "one\n", "two\n");
  await expect(saveState(page)).toHaveText("Saved");
  await page.reload();
  await expect(switcher(page)).toHaveText(/Renamed draft/);
  await expect
    .poll(() => readFile(page, "README.md"), { timeout: 15_000 })
    .toBe("two\n");
  await page.waitForLoadState("load");
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-202 step 2 IO-01: after an edit the header shows Saving… and then Saved, no sooner than 500 ms after the command", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Timing");
  // F-207: the new project's canvas lays out its nodes and saves the sidecar; let that finish before timing an edit
  await canvasReady(page);
  await expect
    .poll(() => readFile(page, ".nf-builder/layout.json"))
    .not.toBeNull();
  await expect(saveState(page)).toHaveText("Saved");
  await recordSaveStates(page);
  const t0 = await editReadme(page, "a\n", "b\n");
  await expect(saveState(page)).toHaveText("Saved");
  await expect
    .poll(() => page.evaluate(() => window.__saveLog?.length ?? 0))
    .toBeGreaterThanOrEqual(3);
  const log = (await page.evaluate(() => window.__saveLog)) ?? [];
  expect(log.map((e) => e.text)).toEqual(["Saved", "Saving…", "Saved"]);
  const savedAt = log.at(-1)?.at ?? 0;
  expect(savedAt - t0).toBeGreaterThanOrEqual(500);
});

test("F-202 step 3 IO-03: a simulated quota at 85% shows the storage warning", async ({
  page,
}) => {
  await stubStorage(page, { fraction: 0.85, persisted: true });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(warning(page)).toHaveText("Storage 85% full");
});

test("F-202 step 3 IO-03: at 79% no warning shows; after a save that takes usage to 85% it appears", async ({
  page,
}) => {
  await stubStorage(page, { fraction: 0.79, persisted: true });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Quota");
  await expect(saveState(page)).toHaveText("Saved");
  await expect(warning(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.__usageFraction = 0.85;
  });
  await editReadme(page, "a\n", "b\n");
  await expect(warning(page)).toHaveText("Storage 85% full");
});

test("F-202 IO-03: persistent storage is requested once, after the first save, and not when already persisted", async ({
  page,
}) => {
  await stubStorage(page, { fraction: 0.1, persisted: false });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__persistCalls)).toBe(0);
  await createProjectInUi(page, "Persist");
  await expect.poll(() => page.evaluate(() => window.__persistCalls)).toBe(1);
  await editReadme(page, "a\n", "b\n");
  await expect(saveState(page)).toHaveText("Saved");
  await editReadme(page, "b\n", "c\n");
  await expect(saveState(page)).toHaveText("Saved");
  expect(await page.evaluate(() => window.__persistCalls)).toBe(1);
});

test("F-202 IO-03: nothing is requested when storage is already persistent", async ({
  page,
}) => {
  await stubStorage(page, { fraction: 0.1, persisted: true });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Already persistent");
  await editReadme(page, "a\n", "b\n");
  await expect(saveState(page)).toHaveText("Saved");
  expect(await page.evaluate(() => window.__persistCalls)).toBe(0);
});

test("F-202 UX-01 UX-70: switch between two projects with the keyboard; each keeps its own files", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Alpha");
  await editReadme(page, "alpha\n", "alpha edited\n");
  await expect(saveState(page)).toHaveText("Saved");
  await createProjectInUi(page, "Beta");
  await editReadme(page, "beta\n", "beta edited\n");
  await expect(saveState(page)).toHaveText("Saved");
  expect(await readFile(page, "README.md")).toBe("beta edited\n");

  await switcher(page).focus();
  await page.keyboard.press("Enter");
  await expect(switcher(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(switcher(page)).toHaveAttribute("aria-expanded", "false");
  await expect(switcher(page)).toBeFocused();
  await page.keyboard.press("Enter");
  const beta = page.getByRole("button", { name: "Beta" }).last();
  await expect(beta).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Alpha" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(switcher(page)).toHaveText(/Alpha/);
  await expect.poll(() => readFile(page, "README.md")).toBe("alpha edited\n");
});

test("F-202 UX-01: Cancel keeps a project; Delete removes it and it stays gone after reload", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Keeper");
  await createProjectInUi(page, "Doomed");
  await switcher(page).click();
  await page.getByRole("button", { name: "Delete project…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete project" });
  await expect(dialog).toContainText("Delete “Doomed”?");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toHaveText(/Doomed/);
  await switcher(page).click();
  await page.getByRole("button", { name: "Delete project…" }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toHaveText(/No project/);
  await page.reload();
  await expect(switcher(page)).toHaveText(/Keeper/);
  await switcher(page).click();
  await expect(
    page.getByRole("button", { name: "Keeper" }).last(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Doomed" })).toHaveCount(0);
});

test("F-202 ADR-0002 IO-01: the stored records match the recorded IndexedDB format", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createProjectInUi(page, "Format");
  await editReadme(page, "x\n", "y\n");
  await expect(saveState(page)).toHaveText("Saved");
  const db = await readStoredDatabase(page);
  expect(db.version).toBe(1);
  expect(Object.keys(db.stores).sort()).toEqual(["files", "projects"]);
  expect(db.stores.projects?.keyPath).toBe("id");
  expect(db.stores.files?.keyPath).toEqual(["projectId", "path"]);
  const projects = db.stores.projects?.records as Record<string, unknown>[];
  expect(projects).toHaveLength(1);
  expect(Object.keys(projects[0] ?? {}).sort()).toEqual([
    "createdAt",
    "id",
    "languageVersion",
    "name",
    "openedAt",
    "updatedAt",
  ]);
  expect(projects[0]?.name).toBe("Format");
  // F-203: Start blank stores the blank template's files; the edit replaced README.md.
  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  const stored = (db.stores.files?.records ?? []) as {
    path: string;
    text: string;
  }[];
  // F-207: showing the project's canvas laid out its nodes, so the layout sidecar is stored too, beside the template's files
  const sidecar = stored.filter((f) => f.path === ".nf-builder/layout.json");
  expect(sidecar).toHaveLength(1);
  expect(JSON.parse(sidecar[0]?.text ?? "{}").version).toBe(1);
  const files = stored
    .filter((f) => f.path !== ".nf-builder/layout.json")
    .sort(byPath);
  expect(files).toEqual(
    templateFilesOnDisk("blank")
      .map((f) => ({
        projectId: projects[0]?.id,
        path: f.path,
        text: f.path === "README.md" ? "y\n" : f.text,
      }))
      .sort(byPath),
  );
});

test("F-202 QA-10: focus returns to the switcher after Escape, Cancel, Create and choosing a project", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await switcher(page).click();
  await page.keyboard.press("Escape");
  await expect(switcher(page)).toBeFocused();

  await createProjectInUi(page, "Focus A");
  await expect(switcher(page)).toBeFocused();

  await switcher(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toBeFocused();

  await switcher(page).click();
  await page.getByRole("button", { name: "New project…" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(switcher(page)).toBeFocused();

  await createProjectInUi(page, "Focus B");
  await switcher(page).click();
  await page
    .getByRole("button", { name: "Focus A", exact: true })
    .last()
    .click();
  await expect(switcher(page)).toHaveText(/Focus A/);
  await expect(switcher(page)).toBeFocused();
});

test("F-202 IO-03 ADR-0044: when persistent storage is refused a quiet note says the browser may clear projects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const refuse = { persisted: false, persist: false };
    for (const [key, answer] of Object.entries(refuse))
      Object.defineProperty(navigator.storage, key, {
        value: () => Promise.resolve(answer),
        configurable: true,
      });
  });
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await expect(page.locator(".storage-note")).toHaveCount(0);
  await createProjectInUi(page, "Refused");
  await expect(page.locator(".storage-note")).toContainText(
    "This browser may clear these projects when it needs space.",
  );
});

test("F-202 IO-01 ADR-0044: inside a cross-origin iframe a project can be created and is saved", async ({
  page,
}) => {
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  const button = frame.getByRole("banner").locator(".project-switcher-button");
  await expect(button).toBeEnabled();
  await button.click();
  await frame.getByRole("button", { name: "New project…" }).click();
  const dialog = frame.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Name").fill("Framed");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(button).toHaveText(/Framed/);
  await expect(frame.getByRole("banner").locator(".save-state")).toHaveText(
    "Saved",
  );
});
