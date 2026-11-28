// What the user reads when a GitHub import fails (F-401, IO-14). British English, sentence case.
import { GithubError } from "@nf-builder/sources/github";

export function importErrorMessage(
  error: unknown,
  ctx: { repo: string; ref: string | null },
): string {
  if (!(error instanceof GithubError))
    return error instanceof Error ? error.message : String(error);
  switch (error.kind) {
    case "invalid-input":
      return error.message === "not-github"
        ? "Only github.com repositories can be imported."
        : "Enter a repository as owner/name or a github.com address.";
    case "not-found":
      return `${ctx.repo} wasn't found on GitHub. Check the name. Private repositories can't be imported yet.`;
    case "no-such-ref":
      return `${ctx.repo} has no branch, tag or commit called ${ctx.ref ?? "HEAD"}.`;
    case "empty":
      return `${ctx.repo} is an empty repository.`;
    case "rate-limited":
      if (error.host === "raw")
        return "GitHub is limiting downloads right now. Nothing was imported. Try again in a few minutes.";
      return `GitHub's limit of 60 requests an hour without signing in is used up for this network. ${
        error.resetAt === null
          ? "Try again in a few minutes."
          : `Try again after ${new Date(error.resetAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`
      }`;
    case "refused":
      return `GitHub refused the request for now. Try again in ${
        error.retryAfterSeconds === null
          ? "a minute"
          : `${error.retryAfterSeconds} seconds`
      }.`;
    case "truncated":
      return `${ctx.repo} has too many files for GitHub to list in one request, so it can't be imported.`;
    case "network":
      return "Couldn't reach GitHub. Check your connection and try again.";
    case "download":
      return `Couldn't download ${error.path ?? "a file"} from GitHub (HTTP ${error.status ?? "error"}). Nothing was imported.`;
    case "incomplete":
      return `${error.path ?? "A file"} didn't download completely. Nothing was imported.`;
    case "aborted":
      return "Import cancelled. Nothing was imported.";
    default:
      return "GitHub sent an answer this page didn't expect. Nothing was imported.";
  }
}
