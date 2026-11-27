import type { RepoRef } from "./repo.ts";

export const API_ORIGIN = "https://api.github.com";
export const RAW_ORIGIN = "https://raw.githubusercontent.com";

const base = (r: RepoRef): string =>
  `${API_ORIGIN}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

/** The commit a ref (default: HEAD, the default branch) points to. */
export const commitUrl = (r: RepoRef, ref: string | null): string =>
  `${base(r)}/commits/${encodeURIComponent(ref ?? "HEAD")}`;

export const treeUrl = (r: RepoRef, sha: string): string =>
  `${base(r)}/git/trees/${sha}?recursive=1`;

export const rawUrl = (r: RepoRef, sha: string, path: string): string =>
  `${RAW_ORIGIN}/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/${sha}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
