// The project's files as a tree: directories are derived from file paths (AR-03, AR-04, F-105).
import type { ProjectTree } from "@nf-builder/lang-core";

/** The directories of `path`, outermost first: "a/b/c.nf" gives "a", "a/b". The root ("") is not listed. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

export class FileTree implements ProjectTree {
  readonly #files = new Set<string>();
  /** Directory path to the number of files below it. */
  readonly #dirs = new Map<string, number>();

  constructor(paths: Iterable<string> = []) {
    for (const path of paths) this.add(path);
  }

  /** Adds a file; returns the directories that appeared (none when the file was already there). */
  add(path: string): readonly string[] {
    if (this.#files.has(path)) return [];
    this.#files.add(path);
    const appeared: string[] = [];
    for (const dir of ancestors(path)) {
      const count = this.#dirs.get(dir) ?? 0;
      if (count === 0) appeared.push(dir);
      this.#dirs.set(dir, count + 1);
    }
    return appeared;
  }

  /** Removes a file; returns the directories that disappeared (none when the file was not there). */
  remove(path: string): readonly string[] {
    if (!this.#files.delete(path)) return [];
    const gone: string[] = [];
    for (const dir of ancestors(path)) {
      const count = (this.#dirs.get(dir) ?? 0) - 1;
      if (count <= 0) {
        this.#dirs.delete(dir);
        gone.push(dir);
      } else this.#dirs.set(dir, count);
    }
    return gone;
  }

  isFile(path: string): boolean {
    return this.#files.has(path);
  }

  isDirectory(path: string): boolean {
    return path === "" ? this.#files.size > 0 : this.#dirs.has(path);
  }
}

/** Every path a resolution asked about; a change to any of them can change its answer. */
export interface Watch {
  readonly files: ReadonlySet<string>;
  readonly directories: ReadonlySet<string>;
}

/** A tree that records each `isFile` and `isDirectory` query, so a resolution's watch set is complete by construction. */
export function recordingTree(tree: ProjectTree): {
  tree: ProjectTree;
  watch: Watch;
} {
  const files = new Set<string>();
  const directories = new Set<string>();
  return {
    tree: {
      isFile: (path) => {
        files.add(path);
        return tree.isFile(path);
      },
      isDirectory: (path) => {
        directories.add(path);
        return tree.isDirectory(path);
      },
    },
    watch: { files, directories },
  };
}
