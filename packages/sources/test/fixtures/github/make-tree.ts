// Prints the GitHub trees API body for a commit, from git (F-401): the recursive tree equals `git ls-tree -r -t -l`.
// Usage: node packages/sources/test/fixtures/github/make-tree.ts <git-dir> <sha> <owner/name>
import { execFileSync } from "node:child_process";

const [dir, sha, repo] = process.argv.slice(2);
if (dir === undefined || sha === undefined || repo === undefined)
  throw new Error("usage: make-tree.ts <git-dir> <sha> <owner/name>");

const out = execFileSync(
  "git",
  ["-C", dir, "ls-tree", "-r", "-t", "-l", "-z", sha],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const tree = out
  .split("\0")
  .filter((line) => line !== "")
  .map((line) => {
    const tab = line.indexOf("\t");
    const [mode = "", type = "", object = "", size = "-"] = line
      .slice(0, tab)
      .split(/\s+/);
    const entry: Record<string, unknown> = {
      path: line.slice(tab + 1),
      mode,
      type,
      sha: object,
    };
    if (type === "blob") entry.size = Number(size);
    entry.url = `https://api.github.com/repos/${repo}/git/${type === "blob" ? "blobs" : "trees"}/${object}`;
    return entry;
  });
process.stdout.write(
  `${JSON.stringify({ sha, url: `https://api.github.com/repos/${repo}/git/trees/${sha}`, tree, truncated: false }, null, 2)}\n`,
);
