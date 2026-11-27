import { describe, expect, it } from "vitest";
import { parseRepoInput } from "../../src/github/repo";
import { rawUrl } from "../../src/github/urls";

const repo = { owner: "nf-core", name: "fetchngs" };

describe("GitHub repository input", () => {
  it("F-401 IO-10: owner/name, github.com/owner/name, https://github.com/owner/name(.git)(/), www. and /tree/<ref> are accepted; the URL's ref fills an empty ref field", () => {
    for (const text of [
      "nf-core/fetchngs",
      " nf-core/fetchngs ",
      "github.com/nf-core/fetchngs",
      "https://github.com/nf-core/fetchngs",
      "https://github.com/nf-core/fetchngs.git",
      "https://github.com/nf-core/fetchngs/",
      "https://www.github.com/nf-core/fetchngs",
    ])
      expect(parseRepoInput(text, "")).toEqual({ repo, ref: null });
    expect(
      parseRepoInput("https://github.com/nf-core/fetchngs/tree/feat/x", ""),
    ).toEqual({ repo, ref: "feat/x" });
    expect(
      parseRepoInput("https://github.com/nf-core/fetchngs/tree/dev", "1.13.0"),
    ).toEqual({ repo, ref: "1.13.0" });
    expect(parseRepoInput("nf-core/fetchngs", " 1.13.0 ")).toEqual({
      repo,
      ref: "1.13.0",
    });
  });

  it("F-401 IO-10: other hosts, bad owners or names, . and .., and empty input are rejected with a reason", () => {
    expect(parseRepoInput("", "")).toEqual({ error: "empty" });
    expect(parseRepoInput("   ", "")).toEqual({ error: "empty" });
    expect(parseRepoInput("https://gitlab.com/a/b", "")).toEqual({
      error: "not-github",
    });
    expect(parseRepoInput("bitbucket.org/a/b", "")).toEqual({
      error: "not-github",
    });
    for (const text of [
      "nf-core",
      "-bad/name",
      "a_b/name",
      "nf-core/..",
      "nf-core/.",
      "nf-core/a b",
      "nf-core/x/issues",
      "nf-core/x/tree",
    ])
      expect(parseRepoInput(text, "")).toEqual({ error: "invalid" });
  });

  it("F-401 ADR-0009: rawUrl encodes each path segment (space, #, %, ?, non-ASCII) and keeps the slashes", () => {
    expect(rawUrl(repo, "a".repeat(40), "d ir/a#b%c?d/é.nf")).toBe(
      `https://raw.githubusercontent.com/nf-core/fetchngs/${"a".repeat(40)}/d%20ir/a%23b%25c%3Fd/%C3%A9.nf`,
    );
  });
});
