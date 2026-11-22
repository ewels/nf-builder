// IndexedDB storage for projects (F-202, ADR 0002 as amended: no IndexedDB library). Schema v1 has two stores:
// `projects` (keyPath `id`) and `files` (keyPath `[projectId, path]`, text only). Every write is one transaction.
import type { ProjectFile } from "@nf-builder/engine";
import type { FileChange, ProjectMeta } from "./types";

export const DB_NAME = "nf-builder";
export const DB_VERSION = 1;

export class StorageVersionError extends Error {
  constructor() {
    super(
      "This browser has projects from a newer nf-builder. Reload to update.",
    );
    this.name = "StorageVersionError";
  }
}

export interface ProjectDb {
  listProjects(): Promise<ProjectMeta[]>;
  readProject(
    id: string,
  ): Promise<{ project: ProjectMeta; files: ProjectFile[] } | null>;
  createProject(
    meta: ProjectMeta,
    files: readonly ProjectFile[],
  ): Promise<void>;
  renameProject(
    id: string,
    name: string,
    now: number,
  ): Promise<ProjectMeta | null>;
  /** Sets `openedAt`. */
  touchProject(id: string, now: number): Promise<ProjectMeta | null>;
  deleteProject(id: string): Promise<void>;
  /** Writes every change and each touched project's `updatedAt` in one transaction; all or nothing. */
  saveFiles(changes: readonly FileChange[], now: number): Promise<void>;
  close(): void;
}

/** `MIGRATIONS[v]` upgrades a database from version `v - 1` to `v`. A shipped step is never edited. */
const MIGRATIONS: Record<number, (db: IDBDatabase) => void> = {
  1: (db) => {
    db.createObjectStore("projects", { keyPath: "id" });
    db.createObjectStore("files", { keyPath: ["projectId", "path"] });
  },
};

const req = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Settles when the transaction commits; rejects when it aborts. */
const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
    tx.onerror = () => reject(tx.error);
  });

/** Every key of one project's files: `[id, path]` sorts below `[id, []]` because arrays sort after strings. */
const filesOf = (id: string) => IDBKeyRange.bound([id], [id, []]);

export async function openProjectDb(
  factory: IDBFactory = indexedDB,
  onClosed?: (reason: string) => void,
): Promise<ProjectDb> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      for (let v = event.oldVersion + 1; v <= DB_VERSION; v += 1)
        MIGRATIONS[v]?.(request.result);
    };
    request.onerror = () => {
      const error = request.error;
      reject(
        error?.name === "VersionError" ? new StorageVersionError() : error,
      );
    };
    request.onblocked = () =>
      reject(new Error("The project database is blocked by another tab."));
    request.onsuccess = () => resolve(request.result);
  });
  db.onversionchange = () => {
    db.close();
    onClosed?.("nf-builder was updated in another tab. Reload this page.");
  };

  const readMeta = async (
    tx: IDBTransaction,
    id: string,
  ): Promise<ProjectMeta | undefined> =>
    req<ProjectMeta | undefined>(tx.objectStore("projects").get(id));

  const update = async (
    id: string,
    change: (meta: ProjectMeta) => ProjectMeta,
  ): Promise<ProjectMeta | null> => {
    const tx = db.transaction("projects", "readwrite");
    const committed = done(tx);
    const meta = await readMeta(tx, id);
    if (!meta) {
      tx.abort();
      await committed.catch(() => undefined);
      return null;
    }
    const next = change(meta);
    tx.objectStore("projects").put(next);
    await committed;
    return next;
  };

  return {
    async listProjects() {
      const tx = db.transaction("projects");
      const all = await req<ProjectMeta[]>(tx.objectStore("projects").getAll());
      return all.sort((a, b) => b.openedAt - a.openedAt);
    },

    async readProject(id) {
      const tx = db.transaction(["projects", "files"]);
      const project = await readMeta(tx, id);
      if (!project) return null;
      const stored = await req<{ path: string; text: string }[]>(
        tx.objectStore("files").getAll(filesOf(id)),
      );
      return {
        project,
        files: stored.map(({ path, text }) => ({ path, text })),
      };
    },

    async createProject(meta, files) {
      const tx = db.transaction(["projects", "files"], "readwrite");
      const committed = done(tx);
      try {
        tx.objectStore("projects").add(meta);
        for (const f of files)
          tx.objectStore("files").put({
            projectId: meta.id,
            path: f.path,
            text: f.text,
          });
      } catch (error) {
        tx.abort();
        committed.catch(() => undefined);
        throw error;
      }
      await committed;
    },

    renameProject: (id, name, now) =>
      update(id, (m) => ({ ...m, name, updatedAt: now })),

    touchProject: (id, now) => update(id, (m) => ({ ...m, openedAt: now })),

    async deleteProject(id) {
      const tx = db.transaction(["projects", "files"], "readwrite");
      const committed = done(tx);
      tx.objectStore("projects").delete(id);
      tx.objectStore("files").delete(filesOf(id));
      await committed;
    },

    async saveFiles(changes, now) {
      if (changes.length === 0) return;
      const tx = db.transaction(["projects", "files"], "readwrite");
      const committed = done(tx);
      try {
        const live = new Map<string, ProjectMeta | undefined>();
        for (const c of changes)
          if (!live.has(c.projectId))
            live.set(c.projectId, await readMeta(tx, c.projectId));
        const files = tx.objectStore("files");
        for (const c of changes) {
          if (!live.get(c.projectId)) continue;
          if (c.text === null) files.delete([c.projectId, c.path]);
          else
            files.put({ projectId: c.projectId, path: c.path, text: c.text });
        }
        for (const meta of live.values())
          if (meta) tx.objectStore("projects").put({ ...meta, updatedAt: now });
      } catch (error) {
        tx.abort();
        committed.catch(() => undefined);
        throw error;
      }
      await committed;
    },

    close: () => db.close(),
  };
}
