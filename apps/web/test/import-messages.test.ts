import { GithubError, type GithubErrorKind } from "@nf-builder/sources/github";
import { describe, expect, it } from "vitest";
import { importErrorMessage } from "../src/import/messages";

const ctx = { repo: "nf-core/fetchngs", ref: "1.99.0" };
const msg = (e: unknown, over: Partial<typeof ctx> = {}) =>
  importErrorMessage(e, { ...ctx, ...over });
const kind = (k: GithubErrorKind, text = "x", detail = {}) =>
  new GithubError(k, text, detail);

describe("F-401 import messages", () => {
  it("F-401 IO-14: each error kind has its message", () => {
    expect(msg(kind("invalid-input", "invalid"))).toBe(
      "Enter a repository as owner/name or a github.com address.",
    );
    expect(msg(kind("invalid-input", "not-github"))).toBe(
      "Only github.com repositories can be imported.",
    );
    expect(msg(kind("not-found"))).toBe(
      "nf-core/fetchngs wasn't found on GitHub. Check the name. Private repositories can't be imported yet.",
    );
    expect(msg(kind("no-such-ref"))).toBe(
      "nf-core/fetchngs has no branch, tag or commit called 1.99.0.",
    );
    expect(msg(kind("empty"))).toBe("nf-core/fetchngs is an empty repository.");
    expect(msg(kind("refused", "x", { retryAfterSeconds: 30 }))).toBe(
      "GitHub refused the request for now. Try again in 30 seconds.",
    );
    expect(msg(kind("refused"))).toBe(
      "GitHub refused the request for now. Try again in a minute.",
    );
    expect(msg(kind("rate-limited", "x", { host: "raw", status: 429 }))).toBe(
      "GitHub is limiting downloads right now. Nothing was imported. Try again in a few minutes.",
    );
    expect(msg(kind("truncated"))).toBe(
      "nf-core/fetchngs has too many files for GitHub to list in one request, so it can't be imported.",
    );
    expect(msg(kind("network"))).toBe(
      "Couldn't reach GitHub. Check your connection and try again.",
    );
    expect(
      msg(
        kind("download", "x", { host: "raw", status: 404, path: "docs/a.md" }),
      ),
    ).toBe(
      "Couldn't download docs/a.md from GitHub (HTTP 404). Nothing was imported.",
    );
    expect(msg(kind("incomplete", "x", { path: "docs/a.md" }))).toBe(
      "docs/a.md didn't download completely. Nothing was imported.",
    );
    expect(msg(kind("aborted"))).toBe(
      "Import cancelled. Nothing was imported.",
    );
    expect(msg(new Error("boom"))).toBe("boom");
  });

  it("F-401 IO-14: the rate-limit message gives the reset time in local time", () => {
    const resetAt = Date.UTC(2026, 10, 28, 14, 5, 0);
    const text = msg(kind("rate-limited", "x", { resetAt }));
    const local = new Date(resetAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(text).toBe(
      `GitHub's limit of 60 requests an hour without signing in is used up for this network. Try again after ${local}.`,
    );
    expect(msg(kind("rate-limited"))).toContain("Try again in a few minutes.");
  });
});
