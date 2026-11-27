// Main thread only (QA-30, ADR 0040): the document fetches and passes the worker data.
export type {
  DownloadedFile,
  DownloadOptions,
  FetchLike,
  GithubClient,
  GithubClientOptions,
  RepoListing,
  TreeEntry,
} from "./client.ts";
export { createGithubClient, treeCandidates } from "./client.ts";
export type { GithubErrorDetail, GithubErrorKind } from "./errors.ts";
export { errorFromResponse, GithubError } from "./errors.ts";
export type { RepoInput, RepoInputError, RepoRef } from "./repo.ts";
export { parseRepoInput, repoSlug } from "./repo.ts";
export { API_ORIGIN, commitUrl, RAW_ORIGIN, rawUrl, treeUrl } from "./urls.ts";
