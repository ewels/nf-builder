import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { REPO_ROOT, WEB_DIST } from "../scripts/check-common.ts";
import { readWorkerManifest } from "../scripts/worker-manifest.ts";
import { SMOKE_TAG } from "./browsers.ts";
import { lazyJsFiles } from "./code-view.ts";
import { watchForCspViolations } from "./csp.ts";
import { readProject } from "./engine.ts";
import { readStoredDatabase, switcher } from "./projects.ts";
import { templateFilesOnDisk } from "./templates.ts";
import { PREVIEW_URL } from "./urls.ts";
import {
  chooseZip,
  corpusDir,
  gitArchiveZip,
  pinnedSha,
  RNASEQ_NF_SKIPPED,
  writeZip,
} from "./zips.ts";

// A message of fflate's reader: only a chunk that holds the zip reader has it.
const ZIP_MARKER = "invalid zip data";
/** The live registry host, which only the registry client contains. */
const REGISTRY_MARKER = "registry.nextflow.io";

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** The stored files of every project but as `{path, text}`, and the project records. */
async function stored(page: Page) {
  const db = await readStoredDatabase(page);
  const projects = db.stores.projects?.records as {
    id: string;
    name: string;
    source?: unknown;
  }[];
  const files = (db.stores.files?.records ?? []) as {
    projectId: string;
    path: string;
    text: string;
  }[];
  return { projects, files };
}

const filesOf = (
  all: { projectId: string; path: string; text: string }[],
  id: string | undefined,
) =>
  all
    .filter((f) => f.projectId === id)
    .map((f) => ({ path: f.path, text: f.text }))
    .sort(byPath);

test("F-403 step 1 IO-11 IO-12 QA-30: a GitHub archive zip of rnaseq-nf imports the same files as the pinned tree, without its top-level folder", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "needs the pinned corpus");
  const dir = corpusDir("rnaseq-nf");
  const top = `rnaseq-nf-${pinnedSha("rnaseq-nf")}`;
  const zip = testInfo.outputPath(`${top}.zip`);
  gitArchiveZip(dir, top, zip);
  const watch = await watchForCspViolations(page);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await chooseZip(page, zip);
  const summary = dialog.locator(".import-summary");
  await expect(summary).toContainText("22 files, 31 kB");
  await expect(summary).toContainText(`Removed the top-level folder ${top}/.`);
  await expect(dialog.getByLabel("Name")).toHaveValue(top);
  await summary.getByText("Skipped files (13)").click();
  await expect(summary).toContainText("Ignored by the list: 12 files");
  await expect(summary).toContainText("Binary or non-UTF-8 files: 1 file");
  await expect(summary).toContainText("multiqc/nextflow_logo.png");
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("banner")
    .getByRole("button", { name: top, exact: true })
    .waitFor();
  const { projects, files } = await stored(page);
  expect(projects).toHaveLength(1);
  const expected = readProject(dir)
    .filter((f) => !RNASEQ_NF_SKIPPED(f.path))
    .sort(byPath);
  expect(expected).toHaveLength(22);
  expect(filesOf(files, projects[0]?.id)).toEqual(expected);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("F-403 IO-12: removing /data/ from the ignore list before confirming updates the summary to 34 files, and they are stored", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "needs the pinned corpus");
  const dir = corpusDir("rnaseq-nf");
  const zip = testInfo.outputPath("rnaseq-nf-main.zip");
  gitArchiveZip(dir, "rnaseq-nf-main", zip);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await chooseZip(page, zip);
  await expect(dialog.locator(".import-summary")).toContainText("22 files");
  const list = dialog.getByLabel("Ignore list");
  const lines = (await list.inputValue()).split("\n");
  expect(lines).toContain("/data/");
  await list.fill(lines.filter((line) => line !== "/data/").join("\n"));
  await expect(dialog.locator(".import-summary")).toContainText(
    "34 files, 6.1 MB",
  );
  await dialog.getByRole("button", { name: "Create" }).click();
  await dialog.waitFor({ state: "hidden" });
  const { projects, files } = await stored(page);
  const expected = readProject(dir)
    .filter((f) => f.path !== "multiqc/nextflow_logo.png")
    .sort(byPath);
  expect(expected).toHaveLength(34);
  expect(filesOf(files, projects[0]?.id)).toEqual(expected);
});

test("F-403 step 2 IO-12 QA-32: a zip with more than 20,000 entries is refused with a clear message and no project is created", async ({
  page,
}, testInfo) => {
  const entries: Record<string, string> = {};
  for (let i = 0; i <= 20_000; i += 1) entries[`many/f${i}.txt`] = "";
  const zip = testInfo.outputPath("many.zip");
  writeZip(entries, zip, 0);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const before = (await stored(page)).projects.length;
  const dialog = await chooseZip(page, zip);
  await expect(dialog.getByRole("alert")).toHaveText(
    "This zip has more than 20,000 files and folders. Imports take up to 20,000.",
  );
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "Choose a zip file" }),
  ).toBeVisible();
  expect((await stored(page)).projects).toHaveLength(before);
});

test("F-403 step 2 IO-12 QA-32: a zip that expands to more than 200 MB is refused with a clear message before anything is unpacked", async ({
  page,
}, testInfo) => {
  const zip = testInfo.outputPath("big.zip");
  writeZip({ "big/zeros.txt": new Uint8Array(201_000_000) }, zip, 1);
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const before = (await stored(page)).projects.length;
  const started = Date.now();
  const dialog = await chooseZip(page, zip);
  await expect(dialog.getByRole("alert")).toHaveText(
    "This zip expands to more than 200 MB. Imports take up to 200 MB uncompressed.",
  );
  expect(Date.now() - started).toBeLessThan(5000);
  expect((await stored(page)).projects).toHaveLength(before);
});

test("F-403 IO-11 IO-12: a zip with no top-level folder keeps its paths, a file that isn't a zip is refused, and Cancel stores nothing", async ({
  page,
}, testInfo) => {
  const flat = testInfo.outputPath("flat.zip");
  writeZip({ "main.nf": "workflow {}\n", "conf/a.config": "x = 1\n" }, flat);
  const notZip = testInfo.outputPath("not.zip");
  writeFileSync(notZip, "this is not a zip archive, only some text of a size");
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
  const dialog = await chooseZip(page, flat);
  await expect(dialog.locator(".import-summary")).toContainText("2 files");
  await expect(dialog.locator(".import-summary")).not.toContainText(
    "Removed the top-level folder",
  );
  await dialog.getByLabel("Zip file to import").setInputFiles(notZip);
  await expect(dialog.getByRole("alert")).toHaveText(
    "This file isn't a zip archive, or it is damaged.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  await expect(switcher(page)).toBeFocused();
  expect((await stored(page)).files).toHaveLength(0);
});

test(
  "F-403 IO-11 QA-20: a small zip imports and its files are stored",
  { tag: SMOKE_TAG },
  async ({ page }, testInfo) => {
    const dir = join(REPO_ROOT, "packages/lang-2610/templates/hello-world");
    const zip = testInfo.outputPath("hello-world-main.zip");
    gitArchiveZip(dir, "hello-world-main", zip);
    await page.goto("./");
    await expect(switcher(page)).toBeEnabled();
    const dialog = await chooseZip(page, zip);
    await expect(
      dialog.getByRole("heading", { name: "Import summary" }),
    ).toBeVisible();
    await expect(dialog.locator(".import-summary")).toContainText(
      "Removed the top-level folder hello-world-main/.",
    );
    await dialog.getByRole("button", { name: "Create" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .getByRole("banner")
      .getByRole("button", { name: "hello-world-main", exact: true })
      .waitFor();
    const { projects, files } = await stored(page);
    expect(filesOf(files, projects[0]?.id)).toEqual(
      [...templateFilesOnDisk("hello-world")].sort(byPath),
    );
    // IO-13: the zip's name and hash are recorded as the source
    expect(projects[0]?.source).toEqual({
      kind: "zip",
      name: "hello-world-main.zip",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  },
);

test("F-403 IO-11 QA-30 ADR-0044: inside a cross-origin iframe a zip is read and summarised", async ({
  page,
}, testInfo) => {
  const zip = testInfo.outputPath("framed.zip");
  writeZip({ "framed-main/main.nf": "workflow {}\n" }, zip);
  const watch = await watchForCspViolations(page);
  await page.setContent(
    `<iframe id="app" src="${PREVIEW_URL}" width="1200" height="800"></iframe>`,
  );
  const frame = page.frameLocator("#app");
  await expect(switcher(frame)).toBeEnabled();
  const dialog = await chooseZip(frame, zip);
  await expect(dialog.locator(".import-summary")).toContainText("1 file");
  const appFrame = page.frames().find((f) => f.url() === PREVIEW_URL);
  expect(await appFrame?.evaluate(() => window.__cspViolations ?? [])).toEqual(
    [],
  );
  expect(watch.consoleErrors).toEqual([]);
});

test("F-403 QA-01 IO-11: the zip reader is only in a lazily loaded worker chunk, never in the initial JavaScript", () => {
  const { initial, lazy } = lazyJsFiles();
  expect(initial.length).toBeGreaterThan(0);
  for (const file of initial)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      ZIP_MARKER,
    );
  const worker = readWorkerManifest(WEB_DIST);
  // the initial files hold no marker (above), so only the lazy ones can
  const holders = lazy.filter((f) =>
    readFileSync(join(WEB_DIST, f), "utf8").includes(ZIP_MARKER),
  );
  expect(holders.length).toBeGreaterThan(0);
  const workerFiles = new Set(worker.map((c) => c.file));
  for (const file of holders) expect(workerFiles.has(file), file).toBe(true);
  // not in the engine worker's own chunk: it loads on the first import only
  const main = worker.find((c) =>
    c.src?.endsWith("src/engine/engine.worker.ts"),
  );
  expect(main).toBeDefined();
  expect(holders).not.toContain(main?.file);
  // the worker loads only the import entry, so the registry client isn't in that chunk
  for (const file of holders)
    expect(readFileSync(join(WEB_DIST, file), "utf8"), file).not.toContain(
      REGISTRY_MARKER,
    );
});
