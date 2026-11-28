// Main thread only (QA-30, ADR 0040): the document fetches and passes the worker data.
export type {
  DownloadedFile,
  FetchLike,
  GithubClient,
  RepoListing,
} from "./client.ts";
export { createGithubClient, treeCandidates } from "./client.ts";
export type { GithubErrorKind } from "./errors.ts";
export { GithubError } from "./errors.ts";
export type { RepoInput, RepoRef } from "./repo.ts";
export { parseRepoInput, repoSlug } from "./repo.ts";
