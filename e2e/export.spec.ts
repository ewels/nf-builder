import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { canvasReady, node } from "./canvas.ts";
import { F208_AFTER, F208_BEFORE } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import { exportZip, stripFolder } from "./export.ts";
import { applyThroughStore } from "./history.ts";
import {
  dragNode,
  nodePosition,
  readSidecar,
  SIDECAR,
  waitSaved,
} from "./layout.ts";
import { readFile, switcher } from "./projects.ts";
import {
  canvasNodeIds,
  createFromTemplate,
  openNewProjectDialog,
} from "./templates.ts";
import { PREVIEW_URL } from "./urls.ts";
import {
  chooseZip,
  corpusDir,
  gitArchiveZip,
  pinnedSha,
  RNASEQ_NF_SKIPPED,
  writeZip,
} from "./zips.ts";

const RENAME_TOUCHED = ["modules/fastqc/main.nf", "modules/rnaseq.nf"];
const decode = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes ?? new Uint8Array());
const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Imports a zip through the New project dialog and waits for the project to open. */
async function importZip(
  page: import("@playwright/test").Page,
  zip: string,
  name: string,
) {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await chooseZip(page, zip);
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("banner")
    .getByRole("button", { name, exact: true })
    .waitFor();
}

test("F-404 step 1 IO-20: import rnaseq-nf from a zip, rename FASTQC, export: every file the rename didn't touch is byte-identical to the pinned tree", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "needs the pinned corpus");
  const dir = corpusDir("rnaseq-nf");
  const top = `rnaseq-nf-${pinnedSha("rnaseq-nf")}`;
  const zip = testInfo.outputPath(`${top}.zip`);
  gitArchiveZip(dir, top, zip);
  await importZip(page, zip, "rnaseq nf");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await applyThroughStore(page, {
    kind: "renameDeclaration",
    path: "modules/fastqc/main.nf",
    name: "FASTQC",
    newName: "FASTQC_QC",
  });
  const out = await exportZip(page, { layout: false });
  expect(out.fileName).toBe("rnaseq nf.zip");
  const files = stripFolder(out.files, "rnaseq nf");
  const pinned = readProject(dir).filter((f) => !RNASEQ_NF_SKIPPED(f.path));
  expect(Object.keys(files).sort()).toEqual(pinned.map((f) => f.path).sort());
  const raw = (path: string) => new Uint8Array(readFileSync(join(dir, path)));
  const changed = pinned.filter(
    (f) => !Buffer.from(files[f.path] ?? []).equals(raw(f.path)),
  );
  // the rename touches the declaration and its includes and calls, and nothing else
  expect(changed.map((f) => f.path).sort()).toEqual(RENAME_TOUCHED);
  for (const f of changed) expect(decode(files[f.path])).toContain("FASTQC_QC");
  // ADR 0057: bin/ files are executable, on Unix
  const mode = new Map(out.entries.map((e) => [e.name, e]));
  const fastqcSh = mode.get("rnaseq nf/bin/fastqc.sh");
  expect(fastqcSh).toMatchObject({ os: 3, mode: 0o100755 });
  expect(mode.get("rnaseq nf/main.nf")).toMatchObject({ mode: 0o100644 });
});

test("F-404 step 2 IO-21: f208-code-edit imported, the Code edit applied, the export without layout equals oracle case f208-code-edit-after", async ({
  page,
}, testInfo) => {
  const zip = testInfo.outputPath("f208.zip");
  const before = readProject(F208_BEFORE);
  writeZip(
    Object.fromEntries(before.map((f) => [`f208/${f.path}`, f.text])),
    zip,
  );
  await importZip(page, zip, "f208");
  await canvasReady(page);
  const after = readProject(F208_AFTER).sort(byPath);
  await applyThroughStore(page, {
    kind: "replaceFileText",
    path: "main.nf",
    text: after.find((f) => f.path === "main.nf")?.text ?? "",
  });
  const out = await exportZip(page, { layout: false });
  const files = stripFolder(out.files, "f208");
  expect(
    Object.keys(files)
      .sort()
      .map((path) => ({ path, text: decode(files[path]) })),
  ).toEqual(after);
  // the CI oracle job lints both cases (f208-code-edit, f208-code-edit-after), IO-21
});

test("F-404 step 3 IO-02 ADR-0008: export with the layout, import the zip in a fresh browser context: the sidecar bytes and every node position are identical", async ({
  page,
  browser,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createFromTemplate(page, "Hello world", "Round trip");
  await canvasReady(page);
  const ids = await canvasNodeIds(page);
  expect(ids.length).toBeGreaterThan(1);
  const target = "main.nf#/greetings";
  const placed = await nodePosition(page, target);
  await dragNode(page, target, 60, 70);
  await expect
    .poll(async () => (await nodePosition(page, target)).x)
    .not.toBe(placed.x);
  const dragged = await nodePosition(page, target);
  await expect
    .poll(async () => (await readSidecar(page))?.nodes[target])
    .toEqual(dragged);
  await waitSaved(page);
  const sidecar = await readFile(page, SIDECAR);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of ids) positions[id] = await nodePosition(page, id);

  const out = await exportZip(page);
  const files = stripFolder(out.files, "Round trip");
  expect(decode(files[SIDECAR])).toBe(sidecar);
  // a fresh browser context has empty storage
  const context = await browser.newContext({ baseURL: PREVIEW_URL });
  try {
    const fresh = await context.newPage();
    await fresh.goto("./");
    await expect(switcher(fresh)).toBeEnabled();
    await expect(switcher(fresh)).toHaveText(/No project/);
    await importZip(fresh, out.path, "Round trip");
    await canvasReady(fresh);
    expect(await canvasNodeIds(fresh)).toEqual(ids);
    expect(await readFile(fresh, SIDECAR)).toBe(sidecar);
    for (const id of ids)
      expect(await nodePosition(fresh, id), id).toEqual(positions[id]);
    await expect(fresh.locator(".canvas-notices")).not.toContainText(
      "Laying out nodes…",
    );
    await expect(node(fresh, target)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("F-404 UX-62: unticking the layout leaves .nf-builder/ out; re-importing lays the graph out with ELK", async ({
  page,
}) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createFromTemplate(page, "Hello world", "No layout");
  await canvasReady(page);
  await expect.poll(() => readFile(page, SIDECAR)).not.toBeNull();
  const out = await exportZip(page, { layout: false });
  const names = Object.keys(out.files);
  expect(names.length).toBeGreaterThan(0);
  expect(names.some((n) => n.includes(".nf-builder/"))).toBe(false);
  const withLayout = await exportZip(page, { layout: true });
  expect(Object.keys(withLayout.files)).toContain(`No layout/${SIDECAR}`);
  await importZip(page, out.path, "No layout again");
  await canvasReady(page);
  // ELK places every node again, and writes a sidecar
  await expect.poll(() => readFile(page, SIDECAR)).not.toBeNull();
  expect((await canvasNodeIds(page)).length).toBeGreaterThan(1);
});

test("F-404 QA-30: exporting logs no CSP violation and no console error, at top level and in a cross-origin iframe", async ({
  page,
}) => {
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  await createFromTemplate(page, "Hello world", "Csp");
  await canvasReady(page);
  const top = await exportZip(page);
  expect(Object.keys(top.files).length).toBeGreaterThan(0);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);

  const framed = await page.context().newPage();
  const framedWatch = await watchForCspViolations(framed);
  await framed.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = framed.frameLocator("#app");
  await expect(switcher(frame)).toBeEnabled();
  const dialog = await openNewProjectDialog(frame);
  await dialog.getByLabel("Name").fill("Framed");
  await dialog.getByRole("radio", { name: "From a template" }).check();
  await dialog.getByRole("radio", { name: "Hello world", exact: true }).check();
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await expect(switcher(frame)).toContainText("Framed");
  const download = framed
    .waitForEvent("download", { timeout: 10_000 })
    .catch(() => null);
  await frame
    .getByRole("banner")
    .getByRole("button", { name: "Export" })
    .click();
  await frame
    .getByRole("dialog", { name: "Export project" })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  const saved = await download;
  expect(saved).not.toBeNull();
  expect(framedWatch.consoleErrors).toEqual([]);
  const appFrame = framed.frames().find((f) => f.url() === PREVIEW_URL);
  expect(await appFrame?.evaluate(() => window.__cspViolations ?? [])).toEqual(
    [],
  );
});
