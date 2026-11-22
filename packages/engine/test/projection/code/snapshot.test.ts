import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openFiles, projectorFor } from "../open";
import { renderProjection } from "../render";
import { snapshotName } from "../sets";
import { codeNodesSet } from "./fixtures";

const DIR = fileURLToPath(
  new URL("./snapshots/f108-code-nodes", import.meta.url),
);

describe("F-108 step 1 code-node snapshots", async () => {
  const model = await openFiles(codeNodesSet.files);
  const projector = await projectorFor(model);
  const modelled = projector.workflows().filter((w) => w.modelled);

  it("F-108 step 1: every modelled workflow of f108-code-nodes has a snapshot", () => {
    expect(modelled.length).toBe(3);
    const expected = modelled.map((w) => snapshotName(w.path, w.name)).sort();
    expect(existsSync(DIR) ? readdirSync(DIR).sort() : []).toEqual(expected);
  });

  for (const ref of modelled) {
    const label = `${ref.path}#${ref.name ?? ""}`;
    it(`F-108 step 1 AR-13 LA-27: f108-code-nodes/${label} matches its projection snapshot`, async () => {
      const projection = projector.project(ref.path, ref.name);
      if (projection === null) throw new Error(`no projection for ${label}`);
      const text = model.file(ref.path)?.source.text ?? "";
      await expect(renderProjection(projection, text)).toMatchFileSnapshot(
        `snapshots/f108-code-nodes/${snapshotName(ref.path, ref.name)}`,
      );
    });
  }
});
