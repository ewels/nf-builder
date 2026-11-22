import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openFiles, projectorFor } from "./open";
import { renderProjection } from "./render";
import { fixtureSets, SNAPSHOTS, snapshotName } from "./sets";

describe("F-106 step 1 projection snapshots", async () => {
  for (const set of fixtureSets()) {
    const model = await openFiles(set.files);
    const projector = await projectorFor(model);
    const typed = projector
      .workflows()
      .filter((w) => w.modelled && w.typed === true);

    it(`F-106 step 1: every typed workflow in ${set.name} has a snapshot`, () => {
      expect(typed.length).toBeGreaterThan(0);
      const expected = typed.map((w) => snapshotName(w.path, w.name)).sort();
      const dir = `${SNAPSHOTS}${set.name}`;
      const found = existsSync(dir) ? readdirSync(dir).sort() : [];
      expect(found).toEqual(expected);
    });

    for (const ref of typed) {
      const label = `${ref.path}#${ref.name ?? ""}`;
      it(`F-106 step 1 AR-10 LA-28: ${set.name}/${label} matches its projection snapshot`, async () => {
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
