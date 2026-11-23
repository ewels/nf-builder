import "fake-indexeddb/auto";
import {
  BLANK_TEMPLATE,
  createEngineService,
  type EditCommand,
  type EngineApi,
  installedPackVersions,
  templateFiles,
  templateList,
} from "@nf-builder/engine";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { Timer } from "../src/workspace/autosave";
import { openProjectDb, type ProjectDb } from "../src/workspace/project-db";
import type { WorkspaceStatus } from "../src/workspace/types";
import { createWorkspace, randomId } from "../src/workspace/workspace";

const version = installedPackVersions()[0] as string;
const readme = (text: string): EditCommand => ({
  kind: "replaceFileText",
  path: "README.md",
  text,
});

/** A timer that only fires when the test says so. */
function manualTimer() {
  const fns = new Map<number, () => void>();
  let next = 1;
  const timer: Timer = {
    set: (fn) => {
      fns.set(next, fn);
      return next++;
    },
    clear: (h) => void fns.delete(h as number),
  };
  return {
    timer,
    fire: () => {
      const all = [...fns.values()];
      fns.clear();
      for (const fn of all) fn();
    },
  };
}

function setup(
  factory = new IDBFactory(),
  engine: EngineApi = createEngineService(),
) {
  const clock = manualTimer();
  const saves: { projectId: string; path: string; text: string | null }[][] =
    [];
  let ids = 0;
  let time = 1000;
  const openDb = async (): Promise<ProjectDb> => {
    const db = await openProjectDb(factory);
    return {
      ...db,
      saveFiles: (changes, now) => {
        saves.push([...changes]);
        return db.saveFiles(changes, now);
      },
    };
  };
  const workspace = createWorkspace({
    engine,
    openDb,
    now: () => (time += 10),
    newId: () => `id${++ids}`,
    timer: clock.timer,
  });
  const statuses: WorkspaceStatus[] = [];
  const watching = workspace.watch((s) => statuses.push(s));
  const reader = () => openProjectDb(factory);
  return {
    workspace,
    clock,
    saves,
    statuses,
    watching,
    reader,
    factory,
    engine,
  };
}
const files = [{ path: "README.md", text: "one\n" }];
const ok = (r: unknown) => {
  if ((r as { ok?: boolean }).ok === false)
    throw new Error(`refused: ${JSON.stringify(r)}`);
  return r;
};

describe("F-202 workspace", () => {
  it("F-202 step 1 IO-01: create, open, write and edit README.md, save; a new workspace on the same database reopens the project with the edit", async () => {
    const a = setup();
    await a.watching;
    const meta = await a.workspace.createProject({
      name: "RNA",
      languageVersion: version,
      files: [],
    });
    await a.workspace.openProject(meta.id);
    ok(await a.workspace.writeFiles([{ path: "README.md", text: "one\n" }]));
    const rev = (await a.workspace.diagnostics()) as { revision: number };
    ok(await a.workspace.apply(readme("two\n"), rev.revision));
    expect(await a.workspace.flush()).toEqual({ status: "saved", error: null });
    // the reload: a fresh workspace and engine over the same database
    const b = setup(a.factory);
    const status = await b.watching;
    expect(status.projects.map((p) => p.id)).toEqual([meta.id]);
    await b.workspace.openProject(meta.id);
    expect(await b.workspace.readFile("README.md")).toBe("two\n");
  });

  it("F-203 UX-20: every status has a higher seq than the one before, and openProject returns the seq of the status that made the project current", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    const opened = await s.workspace.openProject(meta.id);
    const seqs = s.statuses.map((status) => status.seq);
    expect(seqs.length).toBeGreaterThan(2);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const current = s.statuses.findLast((status) => status.current !== null);
    expect(current?.current?.id).toBe(meta.id);
    expect(opened.seq).toBe(current?.seq);
  });

  it("F-202 step 2 IO-01: watch pushes saving after an applied command and saved after the write", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    const opened = await s.workspace.openProject(meta.id);
    s.statuses.length = 0;
    ok(await s.workspace.apply(readme("two\n"), opened.summary.revision));
    expect(s.statuses.at(-1)?.save.status).toBe("saving");
    expect(s.saves).toHaveLength(0);
    s.clock.fire();
    await s.workspace.flush();
    expect(s.statuses.at(-1)?.save).toEqual({ status: "saved", error: null });
    expect(s.saves).toHaveLength(1);
  });

  it("F-202 IO-01: writeFiles, apply and applyPatches are autosaved; a refused command saves nothing", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    const opened = await s.workspace.openProject(meta.id);
    const applied = ok(
      await s.workspace.apply(readme("two\n"), opened.summary.revision),
    ) as { revision: number; inverse: never[] };
    await s.workspace.flush();
    expect(s.saves).toHaveLength(1);
    // a stale command is refused and saves nothing
    const refused = await s.workspace.apply(
      readme("x\n"),
      opened.summary.revision,
    );
    expect(refused).toMatchObject({ ok: false, code: "stale" });
    await s.workspace.flush();
    expect(s.saves).toHaveLength(1);
    // undo through applyPatches, then a raw write, are saved
    const undone = ok(
      await s.workspace.applyPatches(applied.inverse, applied.revision),
    ) as { revision: number };
    ok(await s.workspace.writeFiles([{ path: "notes.md", text: "n\n" }]));
    await s.workspace.flush();
    expect(s.saves).toHaveLength(2);
    expect(undone.revision).toBeGreaterThan(applied.revision);
    const db = await s.reader();
    expect((await db.readProject(meta.id))?.files).toEqual([
      { path: "README.md", text: "one\n" },
      { path: "notes.md", text: "n\n" },
    ]);
    db.close();
  });

  it("F-202 QA-03 ADR-0029: openProject pushes opening progress, then the current project", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files: [
        { path: "README.md", text: "one\n" },
        { path: "notes.md", text: "n\n" },
      ],
    });
    s.statuses.length = 0;
    await s.workspace.openProject(meta.id);
    const opening = s.statuses.filter((x) => x.opening);
    expect(opening.length).toBeGreaterThan(1);
    expect(opening[0]?.opening?.project.id).toBe(meta.id);
    expect(opening.some((x) => x.opening?.progress?.phase === "parsing")).toBe(
      true,
    );
    const last = s.statuses.at(-1);
    expect(last?.opening).toBeNull();
    expect(last?.current?.id).toBe(meta.id);
  });

  it("F-202 UX-01: switching flushes the previous project's pending changes first and sets openedAt", async () => {
    const s = setup();
    await s.watching;
    const a = await s.workspace.createProject({
      name: "A",
      languageVersion: version,
      files,
    });
    const b = await s.workspace.createProject({
      name: "B",
      languageVersion: version,
      files,
    });
    const opened = await s.workspace.openProject(a.id);
    ok(await s.workspace.apply(readme("edited\n"), opened.summary.revision));
    expect(s.saves).toHaveLength(0);
    await s.workspace.openProject(b.id);
    expect(s.saves).toHaveLength(1);
    const db = await s.reader();
    expect((await db.readProject(a.id))?.files[0]?.text).toBe("edited\n");
    const list = await db.listProjects();
    expect(list[0]?.id).toBe(b.id);
    expect(list[0]?.openedAt).toBeGreaterThan(b.openedAt);
    expect(s.statuses.at(-1)?.current?.id).toBe(b.id);
    expect(s.statuses.at(-1)?.projects[0]?.id).toBe(b.id);
    db.close();
  });

  it("F-202 UX-01: rename and delete update the pushed list; deleting the open project closes it and drops its pending changes", async () => {
    const s = setup();
    await s.watching;
    const a = await s.workspace.createProject({
      name: "A",
      languageVersion: version,
      files,
    });
    const b = await s.workspace.createProject({
      name: "B",
      languageVersion: version,
      files,
    });
    const opened = await s.workspace.openProject(a.id);
    const renamed = await s.workspace.renameProject(a.id, "  Alpha  ");
    expect(renamed.name).toBe("Alpha");
    expect(s.statuses.at(-1)?.current?.name).toBe("Alpha");
    expect(s.statuses.at(-1)?.projects.map((p) => p.name)).toContain("Alpha");
    await expect(s.workspace.renameProject(a.id, "  ")).rejects.toThrow();
    await expect(s.workspace.renameProject("nope", "x")).rejects.toThrow();
    ok(await s.workspace.apply(readme("pending\n"), opened.summary.revision));
    await s.workspace.deleteProject(a.id);
    const last = s.statuses.at(-1);
    expect(last?.current).toBeNull();
    expect(last?.projects.map((p) => p.id)).toEqual([b.id]);
    expect(last?.save.status).toBe("saved");
    expect(await s.workspace.project("README.md", null)).toMatchObject({
      ok: false,
      code: "no-project",
    });
    await s.workspace.flush();
    expect(s.saves).toHaveLength(0);
    await s.workspace.deleteProject(b.id);
    expect(s.statuses.at(-1)?.projects).toEqual([]);
  });

  it("F-202 LA-01 UX-01: createProject trims the name and rejects a bad name or an unknown version", async () => {
    const s = setup();
    await s.watching;
    const m = await s.workspace.createProject({
      name: " X ",
      languageVersion: version,
      files: [],
    });
    expect(m.name).toBe("X");
    expect(m.createdAt).toBe(m.openedAt);
    await expect(
      s.workspace.createProject({
        name: "",
        languageVersion: version,
        files: [],
      }),
    ).rejects.toThrow(/name/i);
    await expect(
      s.workspace.createProject({
        name: "ok",
        languageVersion: "0.0",
        files: [],
      }),
    ).rejects.toThrow(/0\.0/);
    expect(s.statuses.at(-1)?.projects).toHaveLength(1);
  });

  it("F-203 UX-60 LA-02: createProject with a template stores exactly its files and the chosen version", async () => {
    const s = setup();
    await s.watching;
    const list = await templateList(version);
    for (const t of list.templates) {
      const meta = await s.workspace.createProject({
        name: t.name,
        languageVersion: version,
        files: [],
        template: t.id,
        publishDocs: true,
      });
      expect(meta.languageVersion).toBe(version);
      const stored = await (await s.reader()).readProject(meta.id);
      expect(stored?.files).toEqual(await templateFiles(version, t.id));
    }
    expect(list.templates.length).toBeGreaterThan(0);
  });

  it("F-203 UX-60: Start blank stores the pack's blank template", async () => {
    const s = setup();
    await s.watching;
    const { blank } = await templateList(version);
    const meta = await s.workspace.createProject({
      name: "B",
      languageVersion: version,
      files: [],
      template: blank.id,
    });
    const stored = await (await s.reader()).readProject(meta.id);
    expect(stored?.files).toEqual(await templateFiles(version, blank.id));
    expect(stored?.files.map((f) => f.path)).toContain("main.nf");
    await s.workspace.openProject(meta.id);
    expect(await s.workspace.readFile("main.nf")).toContain(
      "nextflow.enable.types = true",
    );
  });

  it("F-203 UX-60: Start blank needs no template id: BLANK_TEMPLATE stores the pack's blank template", async () => {
    const s = setup();
    await s.watching;
    const { blank } = await templateList(version);
    const meta = await s.workspace.createProject({
      name: "B",
      languageVersion: version,
      files: [],
      template: BLANK_TEMPLATE,
    });
    const stored = await (await s.reader()).readProject(meta.id);
    expect(stored?.files).toEqual(await templateFiles(version, blank.id));
  });

  it("F-203: createProject refuses an unknown template, and a template given with files", async () => {
    const s = setup();
    await s.watching;
    await expect(
      s.workspace.createProject({
        name: "X",
        languageVersion: version,
        files: [],
        template: "nope",
      }),
    ).rejects.toThrow(/nope/);
    await expect(
      s.workspace.createProject({
        name: "X",
        languageVersion: version,
        files,
        template: "blank",
      }),
    ).rejects.toThrow(/template.*files/i);
    expect(s.statuses.at(-1)?.projects ?? []).toHaveLength(0);
  });

  it("F-203: templates passes straight through", async () => {
    const s = setup();
    await s.watching;
    expect(await s.workspace.templates(version)).toEqual(
      await templateList(version),
    );
    await expect(s.workspace.templates("0.0")).rejects.toThrow();
  });

  it("F-202: a raw open is unsaved: its changes are not stored and no project is current", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    await s.workspace.openProject(meta.id);
    const summary = await s.workspace.open({
      version,
      files: [{ path: "raw.md", text: "r\n" }],
    });
    expect(s.statuses.at(-1)?.current).toBeNull();
    ok(
      await s.workspace.apply(
        { kind: "replaceFileText", path: "raw.md", text: "r2\n" },
        summary.revision,
      ),
    );
    await s.workspace.flush();
    expect(s.saves).toHaveLength(0);
    expect(await s.workspace.readFile("raw.md")).toBe("r2\n");
  });

  it("F-202 IO-14: a failed open reports openError and leaves no project open; the next open works", async () => {
    const factory = new IDBFactory();
    const seed = await openProjectDb(factory);
    const bad = {
      id: "bad",
      name: "Bad",
      languageVersion: "0.0",
      createdAt: 1,
      updatedAt: 1,
      openedAt: 5,
    };
    await seed.createProject(bad, files);
    seed.close();
    const s = setup(factory);
    await s.watching;
    const good = await s.workspace.createProject({
      name: "Good",
      languageVersion: version,
      files,
    });
    await expect(s.workspace.openProject("bad")).rejects.toThrow(
      /No language pack/,
    );
    const failed = s.statuses.at(-1);
    expect(failed?.current).toBeNull();
    expect(failed?.opening).toBeNull();
    expect(failed?.openError?.project.id).toBe("bad");
    expect(failed?.openError?.message).toMatch(/No language pack/);
    expect(await s.workspace.readFile("README.md")).toBeNull();
    await s.workspace.openProject(good.id);
    expect(s.statuses.at(-1)?.openError).toBeNull();
    expect(s.statuses.at(-1)?.current?.id).toBe(good.id);
  });

  it("F-202 ADR-0002: when the database can't open, status is unavailable with the reason and project calls reject", async () => {
    const workspace = createWorkspace({
      engine: createEngineService(),
      openDb: () => Promise.reject(new Error("blocked by policy")),
    });
    const status = await workspace.watch(() => undefined);
    expect(status.storage).toBe("unavailable");
    expect(status.storageError).toBe("blocked by policy");
    await expect(
      workspace.createProject({
        name: "x",
        languageVersion: version,
        files: [],
      }),
    ).rejects.toThrow(/blocked by policy/);
    await expect(workspace.openProject("a")).rejects.toThrow();
    // the engine itself still works, unsaved
    const summary = await workspace.open({ version, files });
    expect(summary.files).toHaveLength(1);
  });

  it("F-202 ADR-0003: every status and result survives structuredClone", async () => {
    const s = setup();
    await s.watching;
    const meta = await s.workspace.createProject({
      name: "P",
      languageVersion: version,
      files,
    });
    const summary = await s.workspace.openProject(meta.id);
    await s.workspace.flush();
    for (const value of [...s.statuses, meta, summary, await s.watching])
      expect(structuredClone(value)).toEqual(value);
  });

  it("F-202 ADR-0002: a versionchange from another tab makes storage unavailable and later project calls reject", async () => {
    const factory = new IDBFactory();
    const workspace = createWorkspace({
      engine: createEngineService(),
      openDb: (onClosed) => openProjectDb(factory, onClosed),
    });
    const seen: WorkspaceStatus[] = [];
    await workspace.watch((s) => seen.push(s));
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("nf-builder", 2);
      request.onupgradeneeded = () => undefined;
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    expect(seen.at(-1)?.storage).toBe("unavailable");
    expect(seen.at(-1)?.storageError).toMatch(/Reload this page/);
    await expect(
      workspace.createProject({
        name: "x",
        languageVersion: version,
        files: [],
      }),
    ).rejects.toThrow(/Reload this page/);
  });

  it("F-202 IO-01: a save to a project deleted in another tab reports failed, not saved", async () => {
    const a = setup();
    await a.watching;
    const meta = await a.workspace.createProject({
      name: "Gone",
      languageVersion: version,
      files,
    });
    await a.workspace.openProject(meta.id);
    const other = await a.reader();
    await other.deleteProject(meta.id);
    other.close();
    ok(await a.workspace.writeFiles([{ path: "README.md", text: "edit\n" }]));
    const state = await a.workspace.flush();
    expect(state).toEqual({
      status: "failed",
      error: "This project was deleted in another tab.",
    });
  });

  it("F-202 ADR-0044: project ids still work where crypto.randomUUID is missing (a frame in an insecure page)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      const a = randomId();
      expect(a).toMatch(/^[0-9a-f]{32}$/);
      expect(randomId()).not.toBe(a);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });
});
