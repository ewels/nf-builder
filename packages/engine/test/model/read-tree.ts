import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectFile } from "../../src/model/project";

/** Every file under `dir` as project-relative POSIX paths, sorted, skipping `.git`. */
export function readTree(dir: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const visit = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else out.push({ path, text: readFileSync(join(dir, path), "utf8") });
    }
  };
  visit("");
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}
