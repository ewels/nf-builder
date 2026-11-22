// The fixture sets of F-106 steps 1 and 2: each a project of files, opened as one tree.

import { fileURLToPath } from "node:url";
import type { ProjectFile } from "../../src/model/project";
import { readTree } from "../model/read-tree";
import { stripProbes } from "./probes";

const root = (path: string) =>
  fileURLToPath(new URL(`../../../../${path}`, import.meta.url));

export interface FixtureSet {
  readonly name: string;
  readonly files: ProjectFile[];
}

export function fixtureSets(): FixtureSet[] {
  return [
    {
      name: "f102-ast",
      files: readTree(root("packages/lang-2610/test/ast/fixtures")),
    },
    {
      name: "oracle-s1-typed-calls-legacy",
      files: readTree(root("tools/oracle/cases/s1-typed-calls-legacy")),
    },
    {
      name: "oracle-s1-typed-calls-legacy-module",
      files: readTree(root("tools/oracle/cases/s1-typed-calls-legacy-module")),
    },
    {
      name: "types",
      files: readTree(root("packages/engine/test/projection/fixtures")).map(
        (f) => ({ ...f, text: stripProbes(f.text).text }),
      ),
    },
  ];
}

export const SNAPSHOTS = fileURLToPath(
  new URL("./snapshots/", import.meta.url),
);

/** `modules/local/x.nf` and `PREPARE` give `modules__local__x.nf--PREPARE.txt`; the entry workflow is `entry`. */
export const snapshotName = (path: string, workflow: string | null): string =>
  `${path.replaceAll("/", "__")}--${workflow ?? "entry"}.txt`;
