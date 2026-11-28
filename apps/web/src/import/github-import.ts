// The GitHub route's steps on the main thread (F-401, IO-10, IO-12): list a repository, plan what to download from the listing,
// and download it. The worker never sees this module (the `web-worker-no-github-client` rule): it gets bytes.
import {
  type ImportPlan,
  type PlanCandidate,
  planImport,
  type SkipGroup,
} from "@nf-builder/sources";
import {
  createGithubClient,
  type DownloadedFile,
  type GithubClient,
  GithubError,
  parseRepoInput,
  type RepoInput,
  type RepoListing,
  repoSlug,
  treeCandidates,
} from "@nf-builder/sources/github";
import {
  DEFAULT_PROJECT_NAME,
  normaliseProjectName,
} from "../workspace/project-name";

export interface ReviewRequest {
  readonly repo: string;
  readonly ref: string;
}

export interface Review {
  readonly input: RepoInput;
  readonly listing: RepoListing;
  readonly candidates: readonly PlanCandidate[];
}

/** Parses the form's text and lists the repository: two API requests, no downloads. */
export async function review(
  client: GithubClient,
  req: ReviewRequest,
  signal?: AbortSignal,
): Promise<Review> {
  const input = parseRepoInput(req.repo, req.ref);
  if ("error" in input)
    throw new GithubError("invalid-input", input.error, { host: "api" });
  const listing = await client.list(input, signal);
  return { input, listing, candidates: treeCandidates(listing.entries) };
}

/** What to download for an ignore list, decided from the listing alone: no request. */
export function replan(r: Review, ignoreText: string): ImportPlan {
  return planImport(r.candidates, ignoreText, repoSlug(r.input.repo));
}

export function download(
  client: GithubClient,
  r: Review,
  plan: ImportPlan,
  o: {
    signal?: AbortSignal;
    onProgress?(done: number, total: number): void;
  },
): Promise<DownloadedFile[]> {
  return client.download(r.input.repo, r.listing.sha, plan.files, o);
}

/** The client the page uses; `fetch` is looked up on each call so a test can replace it. */
export function githubClient(): GithubClient {
  return createGithubClient({
    fetch: (url, init) => globalThis.fetch(url, init),
  });
}

/** The default project name for a repository field: the repository's name, or null while the text isn't a repository. */
export function githubProjectName(repoText: string): string | null {
  const input = parseRepoInput(repoText, "");
  if ("error" in input) return null;
  return normaliseProjectName(input.repo.name) ?? DEFAULT_PROJECT_NAME;
}

/** The plan's skipped groups with the files the worker found not to be text added to the binary group. */
export function skippedWithNotText(
  plan: ImportPlan,
  notText: readonly string[],
): readonly SkipGroup[] {
  if (notText.length === 0) return plan.summary.skipped;
  const sizes = new Map(plan.files.map((f) => [f.path, f.size]));
  const bytes = notText.reduce((n, p) => n + (sizes.get(p) ?? 0), 0);
  const groups = [...plan.summary.skipped];
  const at = groups.findIndex((g) => g.reason === "binary");
  const found = groups[at];
  const merged: SkipGroup = {
    reason: "binary",
    count: (found?.count ?? 0) + notText.length,
    bytes: (found?.bytes ?? 0) + bytes,
    paths: [...(found?.paths ?? []), ...notText].sort(),
  };
  if (at >= 0) groups[at] = merged;
  else groups.push(merged);
  return groups;
}

/** The message that blocks Import for a plan, or null (IO-12). */
export function githubImportProblem(plan: ImportPlan): string | null {
  const first = plan.summary.ignoreProblems[0];
  if (first !== undefined)
    return `Fix the ignore list first. Line ${first.line}: ${first.message}`;
  if (plan.breaches.length > 0)
    return "The selection is over the import limit. Add patterns to the ignore list.";
  if (plan.files.length === 0) return "Nothing left to import.";
  return null;
}
