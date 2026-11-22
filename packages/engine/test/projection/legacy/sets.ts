// The legacy fixture sets of F-107 step 1: each a project of files, opened as one tree.

import { fileURLToPath } from "node:url";
import type { ProjectFile } from "../../../src/model/project";
import { readTree } from "../../model/read-tree";

const root = (path: string) =>
  fileURLToPath(new URL(`../../../../../${path}`, import.meta.url));

export interface LegacySet {
  readonly name: string;
  readonly files: ProjectFile[];
  /** Only these files' workflows are snapshotted (all when null). */
  readonly only: string | null;
}

export function legacySets(): LegacySet[] {
  return [
    {
      name: "f107-legacy-dataflow",
      files: readTree(root("tools/oracle/cases/f107-legacy-dataflow")),
      only: null,
    },
    {
      name: "f102-legacy-dataflow",
      files: readTree(root("packages/lang-2610/test/ast/fixtures")),
      only: "legacy-dataflow.nf",
    },
    {
      name: "oracle-s1-legacy-calls-typed",
      files: readTree(root("tools/oracle/cases/s1-legacy-calls-typed")),
      only: null,
    },
    {
      name: "oracle-s1-legacy-calls-typed-module",
      files: readTree(root("tools/oracle/cases/s1-legacy-calls-typed-module")),
      only: null,
    },
  ];
}

export const SNAPSHOTS = fileURLToPath(
  new URL("./snapshots/", import.meta.url),
);
