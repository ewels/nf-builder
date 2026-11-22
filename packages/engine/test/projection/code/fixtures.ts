import { fileURLToPath } from "node:url";
import { readTree } from "../../model/read-tree";
import type { FixtureSet } from "../sets";

const F108 = fileURLToPath(
  new URL("../../../../../tools/oracle/cases/f108-code-nodes", import.meta.url),
);

/** The F-108 oracle case: arbitrary statements in legacy and typed workflows. */
export const codeNodesSet: FixtureSet = {
  name: "f108-code-nodes",
  files: readTree(F108),
};
