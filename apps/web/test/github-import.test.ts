import { createGithubClient, type FetchLike } from "@nf-builder/sources/github";
import { describe, expect, it } from "vitest";
import { download, replan, review } from "../src/import/github-import";

const tree = {
  sha: "955c892d80927cee633765e6e390f9cc6b7235c9",
  truncated: false,
  tree: [
    { path: "docs", mode: "040000", type: "tree", sha: "t" },
    { path: "main.nf", mode: "100644", type: "blob", sha: "a", size: 1 },
    { path: "docs/usage.md", mode: "100644", type: "blob", sha: "b", size: 1 },
    { path: "docs/logo.png", mode: "100644", type: "blob", sha: "c", size: 1 },
    { path: "work/x.txt", mode: "100644", type: "blob", sha: "d", size: 1 },
  ],
};
const SHA = "955c892d80927cee633765e6e390f9cc6b7235c9";

function setup() {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    if (url.includes("/commits/")) return new Response(SHA);
    if (url.includes("/git/trees/")) return Response.json(tree);
    return new Response("x"); // length 1
  };
  return { urls, client: createGithubClient({ fetch }) };
}

describe("F-401 GitHub import", () => {
  it("F-401 step 2 UX-61: review makes the two calls once; replanning after an ignore edit makes none; download fetches only the planned files", async () => {
    const { urls, client } = setup();
    const r = await review(client, {
      repo: "github.com/nf-core/fetchngs",
      ref: "1.13.0",
    });
    expect(urls).toHaveLength(2);
    expect(r.listing.sha).toBe(SHA);
    const all = replan(r, "");
    const some = replan(r, "docs/\n");
    expect(urls).toHaveLength(2);
    expect(some.files.length).toBeLessThan(all.files.length);
    expect(some.files.every((f) => !f.path.startsWith("docs/"))).toBe(true);
    expect(all.summary.skipped.map((g) => g.reason)).toContain("binary");
    const fixed = replan(r, "work/\n");
    expect(fixed.files.map((f) => f.path)).toEqual([
      "docs/usage.md",
      "main.nf",
    ]);
    const one = fixed.files.slice(0, 1).map((f) => ({ ...f, size: 1 }));
    const got = await download(client, r, { ...fixed, files: one }, {});
    expect(got.map((f) => f.path)).toEqual(one.map((f) => f.path));
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain("raw.githubusercontent.com");
  });

  it("F-401 IO-10: a bad repository is an invalid-input error before any request", async () => {
    const { urls, client } = setup();
    await expect(review(client, { repo: "", ref: "" })).rejects.toMatchObject({
      kind: "invalid-input",
      message: "empty",
    });
    await expect(
      review(client, { repo: "gitlab.com/a/b", ref: "" }),
    ).rejects.toMatchObject({ message: "not-github" });
    expect(urls).toHaveLength(0);
  });
});
