import { describe, expect, it } from "vitest";
import { versionInfo } from "../scripts/version-json.ts";

describe("version.json", () => {
  it("F-002 step 3: versionInfo reads COMMIT_REF and CONTEXT from the Netlify build environment", () => {
    expect(
      versionInfo({ COMMIT_REF: "abc", CONTEXT: "deploy-preview" }),
    ).toEqual({ commit: "abc", context: "deploy-preview" });
  });

  it('F-002 step 3: versionInfo falls back to "local" outside Netlify', () => {
    expect(versionInfo({})).toEqual({ commit: "local", context: "local" });
  });

  it("F-011 step 1: versionInfo takes GITHUB_SHA in Actions, and SITE_COMMIT and SITE_CONTEXT win over the host's variables", () => {
    expect(versionInfo({ GITHUB_SHA: "gh" })).toEqual({
      commit: "gh",
      context: "local",
    });
    expect(versionInfo({ COMMIT_REF: "nf", GITHUB_SHA: "gh" }).commit).toBe(
      "nf",
    );
    expect(
      versionInfo({
        SITE_COMMIT: "site",
        COMMIT_REF: "nf",
        GITHUB_SHA: "gh",
        SITE_CONTEXT: "production",
        CONTEXT: "deploy-preview",
      }),
    ).toEqual({ commit: "site", context: "production" });
  });
});
