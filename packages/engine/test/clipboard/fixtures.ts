// Projects the copy and paste tests start from (F-310).
import { join } from "node:path";
import { readTree } from "../model/read-tree";

const cases = new URL("../../../../tools/oracle/cases/", import.meta.url)
  .pathname;

/** The files of an oracle case as a path to text record. */
export const caseFiles = (name: string): Record<string, string> =>
  Object.fromEntries(readTree(join(cases, name)).map((f) => [f.path, f.text]));

export const blankFiles = (): Record<string, string> =>
  caseFiles("../../../packages/lang-2610/templates/blank");

export const entry = { path: "main.nf", workflow: null };
