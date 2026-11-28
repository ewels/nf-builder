import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { watchForCspViolations } from "./csp.ts";
import type { EngineHook } from "./engine.ts";
import {
  importFromGithub,
  reportDialog,
  reviewGithub,
  startImport,
} from "./github-import.ts";
import {
  blobSha,
  fetchngsRepo,
  mockGithub,
  reportRepo,
} from "./github-mock.ts";
import { readStoredDatabase, switcher } from "./projects.ts";
import { PREVIEW_ORIGIN } from "./urls.ts";

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

async function stored(page: Page) {
  const db = await readStoredDatabase(page);
  const projects = (db.stores.projects?.records ?? []) as {
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

/** Every request to a host other than the page's own, as `method url`. */
function crossOrigin(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(PREVIEW_ORIGIN) && !url.startsWith("data:"))
      seen.push(url);
  });
  return seen;
}

const openApp = async (page: Page) => {
  await page.goto("./");
  await expect(switcher(page)).toBeEnabled();
};

const GITHUB_HOSTS = [
  "https://api.github.com/",
  "https://raw.githubusercontent.com/",
];
const onlyGithub = (urls: string[]) =>
  urls.every((u) => GITHUB_HOSTS.some((h) => u.startsWith(h)));

test.describe("F-401", () => {
  test.beforeEach(({ browserName: _b }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "needs the pinned corpus");
  });

  test("F-401 step 1 IO-10 IO-12 IO-13: importing nf-core/fetchngs at 1.13.0 stores the files byte for byte, skips the PNGs and records the source", async ({
    page,
  }) => {
    const repo = fetchngsRepo();
    const entries = (
      repo.tree as {
        tree: { path: string; type: string; sha: string; size?: number }[];
      }
    ).tree.filter((e) => e.type === "blob");
    // the fixture's blobs are the corpus cache's files
    for (const e of entries)
      expect(blobSha(repo.raw(e.path) ?? Buffer.alloc(0)), e.path).toBe(e.sha);
    await mockGithub(page, [repo]);
    await openApp(page);
    const dialog = await reviewGithub(page, "nf-core/fetchngs", "1.13.0");
    await expect(dialog.getByLabel("Name")).toHaveValue("fetchngs");
    const summary = dialog.locator(".import-summary");
    await expect(summary).toContainText("155 files, 2.3 MB");
    await summary.getByText(/^Skipped files/).click();
    await expect(summary).toContainText("Binary or non-UTF-8 files: 4 files");
    await startImport(dialog);
    await dialog.waitFor({ state: "hidden" });
    await expect(reportDialog(page)).toBeVisible();
    const { projects, files } = await stored(page);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.source).toEqual({
      kind: "github",
      repo: "nf-core/fetchngs",
      ref: "1.13.0",
      sha: repo.sha,
    });
    const mine = files.filter(
      (f) =>
        f.projectId === projects[0]?.id && !f.path.startsWith(".nf-builder/"),
    );
    expect(mine).toHaveLength(155);
    const bySha = new Map(entries.map((e) => [e.path, e.sha]));
    for (const f of mine) {
      const bytes = Buffer.from(f.text, "utf8");
      expect(sha256(bytes), f.path).toBe(
        sha256(repo.raw(f.path) ?? Buffer.alloc(0)),
      );
      expect(blobSha(bytes), f.path).toBe(bySha.get(f.path));
    }
    expect(mine.some((f) => f.path.endsWith(".png"))).toBe(false);
  });

  test("F-401 step 2 ADR-0009 ADR-0002: the import makes exactly two api.github.com requests and one raw request per imported file, and no other cross-origin request", async ({
    page,
  }) => {
    const log = await mockGithub(page, [fetchngsRepo()]);
    const seen = crossOrigin(page);
    await openApp(page);
    await importFromGithub(page, "nf-core/fetchngs", "1.13.0");
    await expect(reportDialog(page)).toBeVisible();
    const sha = fetchngsRepo().sha;
    expect(log.api).toEqual([
      "/repos/nf-core/fetchngs/commits/1.13.0",
      `/repos/nf-core/fetchngs/git/trees/${sha}?recursive=1`,
    ]);
    expect(log.raw).toHaveLength(155);
    expect(new Set(log.raw).size).toBe(155);
    expect(log.unexpected).toEqual([]);
    expect(onlyGithub(seen)).toBe(true);
    expect(seen).toHaveLength(2 + 155);
  });

  test("F-401 step 3 UX-61: the report lists parse failures and the legacy share", async ({
    page,
  }) => {
    await mockGithub(page, [fetchngsRepo(), reportRepo()]);
    await openApp(page);
    await importFromGithub(page, "nf-core/fetchngs", "1.13.0");
    const report = reportDialog(page);
    await expect(report).toBeVisible();
    await expect(report).toContainText(
      "Imported nf-core/fetchngs at 1.13.0 (955c892) as fetchngs",
    );
    await expect(report).toContainText("155 imported, 4 skipped");
    await expect(
      report.getByRole("heading", { name: "Parse failures" }),
    ).toBeVisible();
    await expect(report).toContainText("None");
    await expect(report).toContainText(
      "16 of 16 processes and workflows (100%)",
    );
    const live = await page.evaluate(() =>
      (
        window as unknown as { nfBuilderEngine: EngineHook }
      ).nfBuilderEngine.report(),
    );
    expect(live.diagnostics?.suggestions).toBeGreaterThanOrEqual(0);
    await expect(report).toContainText(
      `${live.diagnostics?.suggestions} suggestion`,
    );
    await report.getByRole("button", { name: "Close" }).click();
    await report.waitFor({ state: "hidden" });
    // the report repository: one parse failure, a typed process, a file that isn't text
    await switcher(page).click();
    await page.getByRole("button", { name: "New project…" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    const dialog = await importFromGithub(page, "ewels/report-demo", "");
    await dialog.waitFor({ state: "hidden" });
    const second = reportDialog(page);
    await expect(second).toContainText("bad.nf: process SECOND kept as text");
    await expect(second).toContainText("3 of 4 processes and workflows (75%)");
    await expect(second).toContainText("notes.txt");
    await expect(second).toContainText("the default branch");
  });

  test("F-401 UX-61 IO-12: the summary before import shows files, skipped and size; editing the ignore list updates it with no request", async ({
    page,
  }) => {
    const log = await mockGithub(page, [reportRepo()]);
    await openApp(page);
    const dialog = await reviewGithub(page, "github.com/ewels/report-demo", "");
    const summary = dialog.locator(".import-summary");
    // the shared default list leaves out /data/ and work/, so four files are left
    await expect(summary).toContainText("4 files");
    await expect(
      dialog.getByRole("button", { name: "Import 4 files" }),
    ).toBeVisible();
    const before = [log.api.length, log.raw.length];
    const list = dialog.getByLabel("Ignore list");
    const lines = (await list.inputValue()).split("\n");
    expect(lines).toContain("/data/");
    await list.fill(lines.filter((line) => line !== "/data/").join("\n"));
    await expect(summary).toContainText("5 files");
    await expect(
      dialog.getByRole("button", { name: "Import 5 files" }),
    ).toBeVisible();
    expect([log.api.length, log.raw.length]).toEqual(before);
    expect(log.raw).toEqual([]);
  });

  test("F-401 IO-14 UX-61: a rate-limited GitHub says when to try again and creates no project", async ({
    page,
  }) => {
    await mockGithub(page, [reportRepo()], {
      api: () => ({
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
        },
        body: JSON.stringify({ message: "API rate limit exceeded" }),
      }),
    });
    await openApp(page);
    const dialog = await reviewGithub(page, "ewels/report-demo", "");
    await expect(dialog.getByRole("alert")).toContainText(
      "GitHub's limit of 60 requests an hour without signing in is used up for this network. Try again after",
    );
    expect((await stored(page)).projects).toHaveLength(0);
  });

  test("F-401 IO-14: a failed raw download aborts the import and stores nothing", async ({
    page,
  }) => {
    await mockGithub(page, [reportRepo()], {
      raw: (path) =>
        path === "bad.nf" ? { status: 404, body: "404: Not Found" } : undefined,
    });
    await openApp(page);
    const dialog = await importFromGithub(page, "ewels/report-demo", "");
    await expect(dialog.getByRole("alert")).toHaveText(
      "Couldn't download bad.nf from GitHub (HTTP 404). Nothing was imported.",
    );
    await expect(dialog).toBeVisible();
    expect((await stored(page)).projects).toHaveLength(0);
  });

  test("F-401 QA-30: an import logs no CSP violation and no console error", async ({
    page,
  }) => {
    const watch = await watchForCspViolations(page);
    await mockGithub(page, [reportRepo()]);
    await openApp(page);
    await importFromGithub(page, "ewels/report-demo", "");
    await expect(reportDialog(page)).toBeVisible();
    expect(await watch.violations()).toEqual([]);
    expect(watch.consoleErrors).toEqual([]);
  });

  test("F-401 step 1 step 2 (live): nf-core/fetchngs at 1.13.0 from GitHub matches the corpus cache with at most two API requests", async ({
    page,
  }) => {
    test.skip(!process.env.F401_LIVE, "set F401_LIVE=1 to call GitHub");
    test.setTimeout(180_000);
    const api: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith("https://api.github.com/")) api.push(r.url());
    });
    const repo = fetchngsRepo();
    await openApp(page);
    await importFromGithub(page, "nf-core/fetchngs", "1.13.0");
    await expect(reportDialog(page)).toBeVisible({ timeout: 120_000 });
    expect(api.length).toBeLessThanOrEqual(2);
    const { projects, files } = await stored(page);
    const mine = files.filter(
      (f) =>
        f.projectId === projects[0]?.id && !f.path.startsWith(".nf-builder/"),
    );
    expect(mine).toHaveLength(155);
    for (const f of mine)
      expect(sha256(Buffer.from(f.text, "utf8")), f.path).toBe(
        sha256(repo.raw(f.path) ?? Buffer.alloc(0)),
      );
  });
});
