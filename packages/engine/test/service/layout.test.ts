import type { FileText, Projection } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import {
  type ApplyOutcome,
  createEngineService,
  type EngineRefusal,
  formatLayout,
  LAYOUT_PATH,
  type LayoutChange,
  type ProjectChange,
  type ProjectFile,
  type ProjectionResult,
} from "../../src";
import { installedPackVersions } from "../../src/packs";

const version = installedPackVersions()[0] as string;
const proc = (n: string) => `process ${n} {\n    script:\n    '${n}'\n}\n`;
const mainText = [
  "include { A } from './a.nf'",
  "include { B } from './b.nf'",
  "",
  "workflow {",
  "    A()",
  "    B()",
  "}",
  "",
].join("\n");
const files = [
  { path: "main.nf", text: mainText },
  { path: "a.nf", text: proc("A") },
  { path: "b.nf", text: proc("B") },
];
const entry = { path: "main.nf", workflow: null };
const KEY_A = "main.nf#/A@1";
const KEY_B = "main.nf#/B@1";

const opened = async (extra: readonly ProjectFile[] = []) => {
  const service = createEngineService();
  const summary = await service.open({ version, files: [...files, ...extra] });
  return { service, summary };
};
const must = <T extends object>(r: T | EngineRefusal): T => {
  if ("ok" in r && r.ok === false)
    throw new Error(`refused: ${r.code}: ${r.message}`);
  return r as T;
};
const projected = (r: ProjectionResult | EngineRefusal) =>
  must(r) as ProjectionResult & { projection: Projection };
const texts = (change: { files: readonly FileText[] }) =>
  Object.fromEntries(change.files.map((f) => [f.path, f.text]));
const place = (
  positions: Record<string, { x: number; y: number }>,
  replace = false,
) => ({ ...entry, positions, replace });
const pos = { [KEY_A]: { x: 10, y: 20 }, [KEY_B]: { x: 30, y: 40 } };

describe("F-207 engine service layout", () => {
  it("F-207 step 1 IO-02: open without a sidecar reports absent and no positions; setLayout writes .nf-builder/layout.json and returns its text in files", async () => {
    const { service, summary } = await opened();
    expect(summary.layout).toEqual({ state: "absent", message: null });
    expect(projected(await service.project("main.nf", null)).positions).toEqual(
      {},
    );
    const change = must(await service.setLayout(place(pos)));
    expect(change.layout.state).toBe("ok");
    expect(change.files).toEqual([
      { path: LAYOUT_PATH, text: formatLayout({ version: 1, nodes: pos }) },
    ]);
    expect(await service.readFile(LAYOUT_PATH)).toBe(change.files[0]?.text);
    expect(projected(await service.project("main.nf", null)).positions).toEqual(
      pos,
    );
  });

  it("F-207 step 2 IO-02: positions saved with setLayout come back from project() in a new service opened with the written files", async () => {
    const { service } = await opened();
    const change = must(await service.setLayout(place(pos)));
    const again = await opened(change.files as ProjectFile[]);
    expect(again.summary.layout.state).toBe("ok");
    expect(
      projected(await again.service.project("main.nf", null)).positions,
    ).toEqual(pos);
  });

  it("F-207 step 3 ADR-0008: apply(renameDeclaration) returns the rewritten sidecar in files, and project() gives the old position under the new key", async () => {
    const { service, summary } = await opened();
    await service.setLayout(place(pos));
    const applied = must(
      (await service.apply(
        { kind: "renameDeclaration", path: "a.nf", name: "A", newName: "Z" },
        summary.revision,
      )) as ApplyOutcome,
    ) as ProjectChange;
    const sidecar = texts(applied)[LAYOUT_PATH];
    expect(sidecar).toContain("main.nf#/Z@1");
    expect(sidecar).not.toContain(KEY_A);
    const after = projected(await service.project("main.nf", null));
    expect(after.positions["main.nf#/Z@1"]).toEqual(pos[KEY_A]);
    expect(after.positions[KEY_B]).toEqual(pos[KEY_B]);
    // the patches never include the sidecar
    const applyResult = applied as ProjectChange & {
      patches: { path: string }[];
      inverse: { path: string }[];
    };
    expect(
      [...applyResult.patches, ...applyResult.inverse].map((p) => p.path),
    ).not.toContain(LAYOUT_PATH);
  });

  it("F-207: setLayout keeps the revision and refuses ids outside the workflow's projection and non-finite coordinates", async () => {
    const { service, summary } = await opened();
    const change = must(await service.setLayout(place(pos)));
    expect(change.revision).toBe(summary.revision);
    const outside = await service.setLayout(
      place({ "main.nf#/NOPE@1": { x: 1, y: 1 } }),
    );
    expect("ok" in outside && outside.ok).toBe(false);
    expect("code" in outside && outside.code).toBe("invalid");
    const nan = await service.setLayout(
      place({ [KEY_A]: { x: Number.NaN, y: 1 } }),
    );
    expect("ok" in nan && nan.ok).toBe(false);
    const missing = await service.setLayout({
      path: "main.nf",
      workflow: "NOPE",
      positions: {},
      replace: false,
    });
    expect("ok" in missing && missing.ok).toBe(false);
    expect((await service.setLayout(place(pos))).revision).toBe(
      summary.revision,
    );
    const stillValid = must(
      await service.apply(
        {
          kind: "replaceFileText",
          path: "a.nf",
          text: proc("A").replace("'A'", "'A2'"),
        },
        summary.revision,
      ),
    ) as ProjectChange;
    expect(stillValid.revision).toBe(summary.revision + 1);
  });

  it("F-207 ADR-0008: setLayout with replace drops the workflow's other entries, and an unchanged write returns no files", async () => {
    const { service } = await opened();
    await service.setLayout(place(pos));
    const same = must(await service.setLayout(place(pos)));
    expect(same.files).toEqual([]);
    const replaced = must(
      await service.setLayout(place({ [KEY_A]: { x: 1, y: 2 } }, true)),
    );
    expect(replaced.files[0]?.text).toBe(
      formatLayout({ version: 1, nodes: { [KEY_A]: { x: 1, y: 2 } } }),
    );
  });

  it("F-207 IO-02: commands and patches touching the sidecar are refused; writeFiles of the sidecar replaces the layout without carrying", async () => {
    const { service, summary } = await opened();
    await service.setLayout(place(pos));
    const command = await service.apply(
      { kind: "replaceFileText", path: LAYOUT_PATH, text: "{}" },
      summary.revision,
    );
    expect(command.ok).toBe(false);
    if (command.ok) return;
    expect(command.code).toBe("invalid");
    expect(command.message).toContain("Move nodes on the canvas instead");
    const patched = await service.applyPatches(
      [{ kind: "delete", path: LAYOUT_PATH }],
      summary.revision,
    );
    expect(patched.ok).toBe(false);
    expect(await service.readFile(LAYOUT_PATH)).toContain(KEY_A);

    const imported = formatLayout({
      version: 1,
      nodes: { [KEY_A]: { x: 5, y: 6 } },
    });
    must(
      await service.writeFiles([
        { path: LAYOUT_PATH, text: imported },
        { path: "a.nf", text: proc("A").replace("'A'", "'A3'") },
      ]),
    );
    const after = projected(await service.project("main.nf", null));
    expect(after.positions).toEqual({ [KEY_A]: { x: 5, y: 6 } });
    expect(await service.readFile(LAYOUT_PATH)).toBe(imported);
  });

  it("F-207 IO-02: writeFiles carries keys when the sidecar isn't in the write", async () => {
    const { service } = await opened();
    await service.setLayout(place(pos));
    const change = must(
      await service.writeFiles([
        { path: "main.nf", text: mainText.replace("    B()\n", "") },
      ]),
    );
    expect(texts(change)[LAYOUT_PATH]).toBeDefined();
    const after = projected(await service.project("main.nf", null));
    expect(after.positions).toEqual({ [KEY_A]: pos[KEY_A] });
  });

  it("F-207 IO-02: an invalid sidecar is reported and replaced at the next write; a newer one is reported and never written", async () => {
    const bad = await opened([{ path: LAYOUT_PATH, text: "not json" }]);
    expect(bad.summary.layout.state).toBe("invalid");
    expect(bad.summary.layout.message).toContain(
      "The layout file couldn't be read",
    );
    expect(
      projected(await bad.service.project("main.nf", null)).positions,
    ).toEqual({});
    const fixed = must(await bad.service.setLayout(place(pos)));
    expect(fixed.layout.state).toBe("ok");
    expect(fixed.files).toEqual([
      { path: LAYOUT_PATH, text: formatLayout({ version: 1, nodes: pos }) },
    ]);

    const newerText = '{ "version": 2, "nodes": {} }\n';
    const newer = await opened([{ path: LAYOUT_PATH, text: newerText }]);
    expect(newer.summary.layout.state).toBe("newer");
    expect(newer.summary.layout.message).toContain("newer nf-builder");
    const kept = must(await newer.service.setLayout(place(pos)));
    expect(kept.files).toEqual([]);
    expect(kept.layout.state).toBe("newer");
    expect(await newer.service.readFile(LAYOUT_PATH)).toBe(newerText);
    const applied = must(
      await newer.service.apply(
        {
          kind: "renameDeclaration",
          path: "a.nf",
          name: "A",
          newName: "Z",
        },
        newer.summary.revision,
      ),
    ) as ProjectChange;
    expect(texts(applied)[LAYOUT_PATH]).toBeUndefined();
    expect(await newer.service.readFile(LAYOUT_PATH)).toBe(newerText);
  });

  it("F-207 AR-23 ADR-0008: undoing a delete restores the deleted node's position", async () => {
    const { service, summary } = await opened();
    await service.setLayout(place(pos));
    const deleted = must(
      await service.apply(
        { kind: "deleteNode", target: entry, node: KEY_A },
        summary.revision,
      ),
    ) as ApplyOutcome & ProjectChange & { inverse: never[] };
    expect(texts(deleted)[LAYOUT_PATH]).not.toContain(KEY_A);
    const undone = must(
      await service.applyPatches(deleted.inverse, deleted.revision),
    ) as ProjectChange;
    expect(texts(undone)[LAYOUT_PATH]).toBe(
      formatLayout({ version: 1, nodes: pos }),
    );
  });

  it("F-207 ADR-0003: every layout result survives structuredClone", async () => {
    const { service, summary } = await opened();
    const change: LayoutChange = must(await service.setLayout(place(pos)));
    expect(structuredClone(change)).toEqual(change);
    expect(structuredClone(summary)).toEqual(summary);
    const p = projected(await service.project("main.nf", null));
    expect(structuredClone(p)).toEqual(p);
    const refused = await service.setLayout(place({ nope: { x: 1, y: 1 } }));
    expect(structuredClone(refused)).toEqual(refused);
  });
});
