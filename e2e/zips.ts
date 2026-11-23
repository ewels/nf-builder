// Zip fixtures and the Import route's helpers for the F-403 end-to-end tests. Archives are built at test time: `git archive`
// from the pinned corpus gives what GitHub's archive download does (a `<repo>-<sha>/` prefix, a folder entry per folder, the
// commit id as the comment), and fflate's `zipSync` gives the synthetic and hostile ones.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { zipSync } from "fflate";
import { REPO_ROOT } from "../scripts/check-common.ts";

/** A pinned corpus pipeline's checkout (`pnpm corpus:fetch`). */
export function corpusDir(id: string): string {
  const dir = join(REPO_ROOT, ".cache/corpus", id);
  if (!existsSync(dir))
    throw new Error(`The ${id} corpus is missing: run pnpm corpus:fetch`);
  return dir;
}

/** The commit a corpus pipeline is pinned to, from the fetch marker. */
export const pinnedSha = (id: string): string =>
  readFileSync(
    join(REPO_ROOT, ".cache/corpus", `${id}.complete`),
    "utf8",
  ).trim();

/** The files `data/` and the PNG: what the default ignore list and the binary check leave out of rnaseq-nf. */
export const RNASEQ_NF_SKIPPED = (path: string): boolean =>
  path.startsWith("data/") || path === "multiqc/nextflow_logo.png";

/**
 * Writes `git archive --format=zip --prefix=<prefix>/` of the tree in `dir` to `out`. The tree is copied into a throwaway
 * repository first (the corpus has no `.git`), with every ignore rule overridden, no line-ending conversion and fixed dates.
 */
export function gitArchiveZip(dir: string, prefix: string, out: string): void {
  const work = mkdtempSync(join(tmpdir(), "nf-builder-archive-"));
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    Object.assign(env, {
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    });
    const tree = join(work, "tree");
    cpSync(dir, tree, {
      recursive: true,
      filter: (source) => !source.endsWith("/.git"),
    });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", tree, ...args], { env, stdio: "pipe" });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("add", "-A", "-f");
    git("commit", "-q", "-m", "fixture");
    mkdirSync(join(out, ".."), { recursive: true });
    git("archive", "--format=zip", `--prefix=${prefix}/`, "-o", out, "HEAD");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Writes a zip of `files` (text or bytes) with fflate; `level` 0 stores, 1 to 9 deflates. */
export function writeZip(
  files: Record<string, string | Uint8Array>,
  out: string,
  level: 0 | 1 | 6 = 6,
): void {
  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files))
    entries[path] =
      typeof content === "string" ? encoder.encode(content) : content;
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, zipSync(entries, { level }));
}

/** The Import route of the New project dialog with `path` chosen; waits for the summary or the alert. */
export async function chooseZip(
  root: Page | FrameLocator,
  path: string,
): Promise<Locator> {
  await root.getByRole("banner").locator(".project-switcher-button").click();
  await root.getByRole("button", { name: "New project…" }).click();
  const dialog = root.getByRole("dialog", { name: "New project" });
  await dialog.waitFor();
  await dialog.getByRole("radio", { name: "Import" }).check();
  await dialog.getByRole("radio", { name: "Zip file" }).check();
  await dialog.getByLabel("Zip file to import").setInputFiles(path);
  await dialog
    .getByRole("heading", { name: "Import summary" })
    .or(dialog.getByRole("alert"))
    .waitFor({ timeout: 30_000 });
  return dialog;
}
