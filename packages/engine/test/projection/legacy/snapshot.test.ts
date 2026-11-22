import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openFiles, projectorFor } from "../open";
import { renderProjection } from "../render";
import { snapshotName } from "../sets";
import { legacySets, SNAPSHOTS } from "./sets";

describe("F-107 step 1 legacy projection snapshots", async () => {
  for (const set of legacySets()) {
    const model = await openFiles(set.files);
    const projector = await projectorFor(model);
    const legacy = projector
      .workflows()
      .filter(
        (w) =>
          w.modelled &&
          w.typed === false &&
          (set.only === null || w.path === set.only),
      );

    it(`F-107 step 1: every legacy workflow in ${set.name} has a snapshot`, () => {
      expect(legacy.length).toBeGreaterThan(0);
      const expected = legacy.map((w) => snapshotName(w.path, w.name)).sort();
      const dir = `${SNAPSHOTS}${set.name}`;
      const found = existsSync(dir) ? readdirSync(dir).sort() : [];
      expect(found).toEqual(expected);
    });

    for (const ref of legacy) {
      const label = `${ref.path}#${ref.name ?? ""}`;
      it(`F-107 step 1 AR-14 LA-21: ${set.name}/${label} matches its projection snapshot`, async () => {
        const projection = projector.project(ref.path, ref.name);
        if (projection === null) throw new Error(`no projection for ${label}`);
        const text = model.file(ref.path)?.source.text ?? "";
        await expect(renderProjection(projection, text)).toMatchFileSnapshot(
          `snapshots/${set.name}/${snapshotName(ref.path, ref.name)}`,
        );
      });
    }
  }
});
