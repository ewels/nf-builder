import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  DB_NAME,
  DB_VERSION,
  openProjectDb,
  StorageVersionError,
} from "../src/workspace/project-db";
import type { ProjectMeta } from "../src/workspace/types";

const meta = (id: string, over: Partial<ProjectMeta> = {}): ProjectMeta => ({
  id,
  name: `Project ${id}`,
  languageVersion: "26.10",
  createdAt: 1000,
  updatedAt: 1000,
  openedAt: 1000,
  ...over,
});
const fresh = () => {
  const factory = new IDBFactory();
  return { factory, db: openProjectDb(factory) };
};

/** Opens the raw database at its current version and hands the connection to `fn`. */
const raw = <T>(factory: IDBFactory, fn: (db: IDBDatabase) => T): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      try {
        resolve(fn(db));
      } catch (error) {
        reject(error);
      } finally {
        db.close();
      }
    };
  });

describe("F-202 project database", () => {
  it("F-202 ADR-0002 IO-01: version 1 creates the projects store keyed by id and the files store keyed by [projectId, path], and nothing else", async () => {
    const { factory, db } = fresh();
    (await db).close();
    expect(DB_VERSION).toBe(1);
    const shape = await raw(factory, (d) => {
      const tx = d.transaction([...d.objectStoreNames]);
      return {
        version: d.version,
        stores: [...d.objectStoreNames].sort(),
        projects: tx.objectStore("projects").keyPath,
        files: tx.objectStore("files").keyPath,
      };
    });
    expect(shape).toEqual({
      version: 1,
      stores: ["files", "projects"],
      projects: "id",
      files: ["projectId", "path"],
    });
  });

  it("F-202 IO-01 LA-01: createProject stores the record and its files in one transaction", async () => {
    const { db: opening } = fresh();
    const db = await opening;
    const m = meta("a", { name: "RNA", languageVersion: "26.04" });
    await db.createProject(m, [
      { path: "main.nf", text: "workflow {\n}\n" },
      { path: "README.md", text: "# hi\n" },
    ]);
    const read = await db.readProject("a");
    expect(read?.project).toEqual(m);
    expect(read?.files).toEqual([
      { path: "README.md", text: "# hi\n" },
      { path: "main.nf", text: "workflow {\n}\n" },
    ]);
    expect(await db.readProject("missing")).toBeNull();
    // a duplicate id aborts the whole create: no file of the second call is written
    await expect(
      db.createProject(m, [{ path: "extra.nf", text: "x" }]),
    ).rejects.toThrow();
    expect((await db.readProject("a"))?.files).toHaveLength(2);
    db.close();
  });

  it("F-202 IO-01: readProject returns only that project's files", async () => {
    const db = await fresh().db;
    const paths = ["a.nf", "dir/sub/b.nf", "￿", "\u{1f600}.nf", "dir￿/c.nf"];
    await db.createProject(
      meta("a"),
      paths.map((path) => ({ path, text: `a:${path}` })),
    );
    await db.createProject(meta("ab"), [{ path: "other.nf", text: "ab" }]);
    await db.createProject(meta("a\u0000"), [{ path: "nul.nf", text: "nul" }]);
    const read = await db.readProject("a");
    expect(read?.files.map((f) => f.path).sort()).toEqual([...paths].sort());
    expect((await db.readProject("ab"))?.files).toEqual([
      { path: "other.nf", text: "ab" },
    ]);
    db.close();
  });

  it("F-202 IO-01: saveFiles writes puts and deletes across projects and bumps updatedAt, all or nothing", async () => {
    const db = await fresh().db;
    await db.createProject(meta("a"), [
      { path: "one.nf", text: "1" },
      { path: "two.nf", text: "2" },
    ]);
    await db.createProject(meta("b"), [{ path: "x.nf", text: "x" }]);
    await db.saveFiles(
      [
        { projectId: "a", path: "one.nf", text: "1b" },
        { projectId: "a", path: "two.nf", text: null },
        { projectId: "a", path: "three.nf", text: "3" },
        { projectId: "b", path: "y.nf", text: "y" },
      ],
      5000,
    );
    const a = await db.readProject("a");
    expect(a?.files).toEqual([
      { path: "one.nf", text: "1b" },
      { path: "three.nf", text: "3" },
    ]);
    expect(a?.project.updatedAt).toBe(5000);
    expect(a?.project.openedAt).toBe(1000);
    expect((await db.readProject("b"))?.project.updatedAt).toBe(5000);
    // an invalid change (a key that is not a string) aborts everything, including the valid change before it
    await expect(
      db.saveFiles(
        [
          { projectId: "a", path: "one.nf", text: "lost" },
          { projectId: "a", path: undefined as unknown as string, text: "bad" },
        ],
        9000,
      ),
    ).rejects.toThrow();
    const after = await db.readProject("a");
    expect(after?.files[0]).toEqual({ path: "one.nf", text: "1b" });
    expect(after?.project.updatedAt).toBe(5000);
    // changes for a project that no longer exists are dropped, not stored as orphans
    await db.saveFiles([{ projectId: "gone", path: "z.nf", text: "z" }], 6000);
    expect(await db.readProject("gone")).toBeNull();
    db.close();
  });

  it("F-202 UX-01: renameProject changes only name and updatedAt; deleteProject removes the record and every file", async () => {
    const db = await fresh().db;
    await db.createProject(meta("a"), [{ path: "m.nf", text: "m" }]);
    await db.createProject(meta("ab"), [{ path: "m.nf", text: "m" }]);
    const renamed = await db.renameProject("a", "New name", 7000);
    expect(renamed).toEqual(meta("a", { name: "New name", updatedAt: 7000 }));
    expect(await db.renameProject("missing", "x", 7000)).toBeNull();
    await db.deleteProject("a");
    expect(await db.readProject("a")).toBeNull();
    expect((await db.listProjects()).map((p) => p.id)).toEqual(["ab"]);
    expect((await db.readProject("ab"))?.files).toHaveLength(1);
    db.close();
  });

  it("F-202: listProjects orders by openedAt, most recent first; touchProject updates it", async () => {
    const db = await fresh().db;
    await db.createProject(meta("old", { openedAt: 1 }), []);
    await db.createProject(meta("mid", { openedAt: 2 }), []);
    await db.createProject(meta("new", { openedAt: 3 }), []);
    expect((await db.listProjects()).map((p) => p.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    const touched = await db.touchProject("old", 10);
    expect(touched).toEqual(meta("old", { openedAt: 10 }));
    expect(await db.touchProject("missing", 10)).toBeNull();
    expect((await db.listProjects()).map((p) => p.id)).toEqual([
      "old",
      "new",
      "mid",
    ]);
    db.close();
  });

  it("F-202 ADR-0002: a database at a newer version is refused with StorageVersionError", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION + 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("future");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const error = await openProjectDb(factory).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageVersionError);
    expect((error as Error).message).toMatch(/newer nf-builder/);
    // nothing was written: the future store is still the only one
    const stores = await raw(factory, (d) => [...d.objectStoreNames]);
    expect(stores).toEqual(["future"]);
  });

  it("F-202 ADR-0002: a versionchange from another connection closes this one and reports it", async () => {
    const factory = new IDBFactory();
    const reasons: string[] = [];
    const db = await openProjectDb(factory, (reason) => reasons.push(reason));
    await db.createProject(meta("a"), []);
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION + 1);
      request.onupgradeneeded = () => undefined;
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    expect(reasons).toEqual([
      "nf-builder was updated in another tab. Reload this page.",
    ]);
    await expect(db.listProjects()).rejects.toThrow();
  });
});
