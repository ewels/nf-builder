// The workspace (F-202): projects in IndexedDB on top of the engine service. It runs in the worker, with no Comlink, so it
// also runs in Node. One queue serialises everything that opens, changes or removes a project, so the project id a change
// is saved under is always the project the engine applied it to. `palette`, `project`, `diagnostics`, `details` and
// `readFile` pass straight through. Nothing here assumes a top-level page (ADR 0044): an unavailable database becomes a
// status, not a crash.
import {
  type EngineApi,
  type EngineRefusal,
  installedPackVersions,
  type LayoutChange,
  type ProjectChange,
  templateFiles,
} from "@nf-builder/engine";
import { createAutosaver, type Timer } from "./autosave";
import type { ProjectDb } from "./project-db";
import { normaliseProjectName } from "./project-name";
import {
  INITIAL_STATUS,
  type NewProject,
  type OpenedProject,
  type ProjectMeta,
  type WorkspaceApi,
  type WorkspaceStatus,
} from "./types";

interface WorkspaceOptions {
  readonly engine: EngineApi;
  /** `onClosed` reports a connection that closed later (another tab upgraded the database). */
  readonly openDb: (onClosed: (reason: string) => void) => Promise<ProjectDb>;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly timer?: Timer;
}

/** `crypto.randomUUID` exists only in secure contexts, and a frame inside an insecure page isn't one (ADR 0044). */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createWorkspace(options: WorkspaceOptions): WorkspaceApi {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? randomId;

  let db: ProjectDb | null = null;
  let currentId: string | null = null;
  let listener: ((status: WorkspaceStatus) => void) | undefined;
  let status = INITIAL_STATUS;

  const push = (patch: Partial<WorkspaceStatus>) => {
    status = { ...status, ...patch, seq: status.seq + 1 };
    try {
      // across Comlink the listener returns a promise; a dead listener must not break the workspace
      Promise.resolve(listener?.(status)).catch(() => undefined);
    } catch {
      // ignored for the same reason
    }
  };

  const needDb = (): ProjectDb => {
    if (!db)
      throw new Error(
        status.storageError ?? "Projects can't be stored in this browser.",
      );
    return db;
  };

  const autosaver = createAutosaver({
    timer: options.timer,
    write: (changes) => needDb().saveFiles(changes, now()),
    onState: (save) => push({ save }),
  });

  const ready: Promise<void> = options
    .openDb((reason) => {
      db = null;
      push({ storage: "unavailable", storageError: reason });
    })
    .then(async (opened) => {
      db = opened;
      push({ storage: "ready", projects: await opened.listProjects() });
    })
    .catch((error: unknown) => {
      push({ storage: "unavailable", storageError: message(error) });
    });
  const refresh = async () => push({ projects: await needDb().listProjects() });

  let tail: Promise<unknown> = Promise.resolve();
  /** Runs `fn` after every earlier queued call has settled and the database has opened (or failed to). */
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(() => ready).then(fn);
    tail = result.catch(() => undefined);
    return result;
  };

  /** A change that is recorded for autosave when it succeeds; a refusal has no `files`. */
  const change = <R extends ProjectChange | LayoutChange | EngineRefusal>(
    call: () => Promise<R>,
  ): Promise<R> =>
    serial(async () => {
      const result = await call();
      if (currentId && "files" in result)
        autosaver.record(currentId, result.files);
      return result;
    });

  const flushAll = async () => (db ? autosaver.flush() : status.save);

  return {
    palette: (version) => engine.palette(version),
    templates: (version) => engine.templates(version),
    project: (path, workflow) => engine.project(path, workflow),
    diagnostics: () => engine.diagnostics(),
    details: (path, workflow, node) => engine.details(path, workflow, node),
    readFile: (path) => engine.readFile(path),

    open: (request, onProgress) =>
      serial(async () => {
        await flushAll();
        currentId = null;
        push({ current: null, openError: null });
        return engine.open(request, onProgress);
      }),

    close: () =>
      serial(async () => {
        await flushAll();
        await engine.close();
        currentId = null;
        push({ current: null });
      }),

    writeFiles: (files) => change(() => engine.writeFiles(files)),
    apply: (command, revision) => change(() => engine.apply(command, revision)),
    applyPatches: (patches, revision) =>
      change(() => engine.applyPatches(patches, revision)),
    setLayout: (write) => change(() => engine.setLayout(write)),

    watch: async (next) => {
      listener = next;
      await ready;
      return status;
    },

    createProject: (input: NewProject) =>
      serial(async (): Promise<ProjectMeta> => {
        const store = needDb();
        const name = normaliseProjectName(input.name);
        if (name === null)
          throw new Error("A project name needs 1 to 100 characters.");
        if (!installedPackVersions().includes(input.languageVersion))
          throw new Error(`No language pack for ${input.languageVersion}.`);
        if (input.template !== undefined && input.files.length > 0)
          throw new Error("A template can't be combined with files.");
        const files =
          input.template === undefined
            ? input.files
            : await templateFiles(input.languageVersion, input.template);
        const time = now();
        const meta: ProjectMeta = {
          id: newId(),
          name,
          languageVersion: input.languageVersion,
          createdAt: time,
          updatedAt: time,
          openedAt: time,
        };
        await store.createProject(meta, files);
        await refresh();
        return meta;
      }),

    openProject: (id) =>
      serial(async (): Promise<OpenedProject> => {
        const store = needDb();
        await autosaver.flush();
        const stored = await store.readProject(id);
        if (!stored) throw new Error("That project no longer exists.");
        currentId = null;
        push({
          current: null,
          openError: null,
          opening: { project: stored.project, progress: null },
        });
        try {
          const summary = await engine.open(
            { version: stored.project.languageVersion, files: stored.files },
            (progress) =>
              push({ opening: { project: stored.project, progress } }),
          );
          const touched =
            (await store.touchProject(id, now())) ?? stored.project;
          currentId = id;
          push({
            current: touched,
            opening: null,
            projects: await store.listProjects(),
          });
          return { summary, seq: status.seq };
        } catch (error) {
          await engine.close().catch(() => undefined);
          push({
            current: null,
            opening: null,
            openError: { project: stored.project, message: message(error) },
          });
          throw error;
        }
      }),

    renameProject: (id, name) =>
      serial(async (): Promise<ProjectMeta> => {
        const store = needDb();
        const clean = normaliseProjectName(name);
        if (clean === null)
          throw new Error("A project name needs 1 to 100 characters.");
        const renamed = await store.renameProject(id, clean, now());
        if (!renamed) throw new Error("That project no longer exists.");
        push({
          projects: await store.listProjects(),
          ...(currentId === id ? { current: renamed } : {}),
        });
        return renamed;
      }),

    deleteProject: (id) =>
      serial(async () => {
        const store = needDb();
        autosaver.discard(id);
        if (currentId === id) {
          await engine.close();
          currentId = null;
          push({ current: null });
        }
        await store.deleteProject(id);
        push({
          projects: await store.listProjects(),
          ...(status.openError?.project.id === id ? { openError: null } : {}),
        });
      }),

    flush: () => serial(flushAll),
  };
}
