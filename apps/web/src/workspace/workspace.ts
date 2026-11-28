// The workspace (F-202): projects in IndexedDB on top of the engine service. It runs in the worker, with no Comlink, so it
// also runs in Node. One queue serialises everything that opens, changes or removes a project, so the project id a change
// is saved under is always the project the engine applied it to. `palette`, `project`, `diagnostics`, and
// `details`, `configView`, `configSchema`, `readFile` and `history` pass straight through; `undo` and `redo` are changes like `apply`, so they are autosaved
// (F-209). Nothing here assumes a top-level page (ADR 0044): an unavailable database becomes a status, not a crash.
import {
  type EngineApi,
  type EngineRefusal,
  installedPackVersions,
  LAYOUT_PATH,
  type LayoutChange,
  type ProjectChange,
  type ProjectFile,
  planAdd,
  projectTreeOf,
  templateFiles,
} from "@nf-builder/engine";
import { createAutosaver, type Timer } from "./autosave";
import { createImportStager } from "./import-stage";
import type { ProjectDb } from "./project-db";
import { normaliseProjectName } from "./project-name";
import {
  type AddChoice,
  type AddPreviewResult,
  type ExportResult,
  type ImportedProject,
  type ImportProject,
  INITIAL_STATUS,
  type NewProject,
  type OpenedProject,
  type ProjectMeta,
  type ProjectSource,
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
  /** Loads the zip writer; the default is a dynamic import, so it is a separate worker chunk (F-404). */
  readonly loadExport?: () => Promise<
    typeof import("@nf-builder/sources/export")
  >;
}

/** `crypto.randomUUID` exists only in secure contexts, and a frame inside an insecure page isn't one (ADR 0044). */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Replaced and conflicting paths listed for a preview (UX-61 style cap). */
const LIST_MAX = 100;

const NOTHING_TO_ADD =
  "Nothing to add: every file was skipped or clashes with the project.";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createWorkspace(options: WorkspaceOptions): WorkspaceApi {
  const { engine } = options;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? randomId;
  const importer = createImportStager();
  const loadExport =
    options.loadExport ?? (() => import("@nf-builder/sources/export"));

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

  const invalid = (text: string, revision: number | null): EngineRefusal => ({
    ok: false,
    revision,
    code: "invalid",
    message: text,
    path: null,
    problems: [],
  });

  /** The files a staged import would write into `choice.folder`, planned against the open project (F-210). */
  const planFor = async (choice: AddChoice) => {
    const listed = await engine.listFiles();
    if ("ok" in listed) return listed;
    const chosen = await importer.files(choice.id, choice.ignore, {
      keepFolder: choice.keepFolder,
    });
    if (!chosen.ok) return { chosen, listed };
    const plan = planAdd({
      paths: chosen.files.map((f) => f.path),
      folder: choice.folder,
      tree: projectTreeOf(listed.files.map((f) => f.path)),
    });
    return { chosen, listed, plan };
  };

  const flushAll = async () => (db ? autosaver.flush() : status.save);

  return {
    exportProject: (exportOptions) =>
      serial(async (): Promise<ExportResult | EngineRefusal> => {
        const listed = await engine.listFiles();
        if ("ok" in listed) return listed;
        const entries: { path: string; text: string }[] = [];
        for (const { path } of listed.files) {
          if (path === LAYOUT_PATH && !exportOptions.layout) continue;
          const text = await engine.readFile(path);
          if (text !== null) entries.push({ path, text });
        }
        if (entries.length === 0)
          return invalid("Nothing to export.", listed.revision);
        const { exportFileName, exportSlug, zipProject } = await loadExport();
        const name = status.current?.name ?? "";
        return {
          ok: true,
          fileName: exportFileName(name),
          bytes: zipProject(entries, { folder: exportSlug(name) }),
          files: entries.length,
          revision: listed.revision,
        };
      }),

    palette: (version) => engine.palette(version),
    templates: (version) => engine.templates(version),
    project: (path, workflow) => engine.project(path, workflow),
    diagnostics: () => engine.diagnostics(),
    details: (path, workflow, node) => engine.details(path, workflow, node),
    outline: (path) => engine.outline(path),
    report: () => engine.report(),
    configView: (path) => engine.configView(path),
    configSchema: (version) => engine.configSchema(version),
    readFile: (path) => engine.readFile(path),
    listFiles: () => engine.listFiles(),
    freshName: (request) => engine.freshName(request),
    history: () => engine.history(),

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
    apply: (command, revision, options) =>
      change(() => engine.apply(command, revision, options)),
    applyFix: (fix, revision, options) =>
      change(() => engine.applyFix(fix, revision, options)),
    undo: (revision, options) => change(() => engine.undo(revision, options)),
    redo: (revision) => change(() => engine.redo(revision)),
    applyPatches: (patches, revision) =>
      change(() => engine.applyPatches(patches, revision)),
    setLayout: (write) => change(() => engine.setLayout(write)),

    watch: async (next) => {
      listener = next;
      await ready;
      return status;
    },

    // Staging touches neither the database nor the open project, so it stays off the queue.
    stageZip: (file, name) => importer.stageZip(file, name),
    restageImport: (id, ignore) => importer.restage(id, ignore),
    discardImport: async (id) => importer.discard(id),
    stageFiles: (files) => importer.stageFiles(files),

    previewAdd: async (choice): Promise<AddPreviewResult> => {
      const staged = await importer.restage(choice.id, choice.ignore);
      if (!staged.ok) return staged;
      const planned = await planFor(choice);
      if ("ok" in planned) return planned;
      const { plan } = planned;
      return {
        ok: true,
        id: choice.id,
        summary: staged.summary,
        folder: choice.folder,
        adds: plan?.writes.length ?? 0,
        replaced: plan?.replaced.slice(0, LIST_MAX) ?? [],
        replacedCount: plan?.replaced.length ?? 0,
        conflicts: plan?.conflicts.slice(0, LIST_MAX) ?? [],
        conflictCount: plan?.conflicts.length ?? 0,
      };
    },

    addFiles: (choice) =>
      change(async () => {
        const planned = await planFor(choice);
        if ("ok" in planned) return planned;
        const { chosen, listed, plan } = planned;
        if (!chosen.ok) return invalid(chosen.message, listed.revision);
        if (!plan || plan.writes.length === 0)
          return invalid(NOTHING_TO_ADD, listed.revision);
        const text = new Map(chosen.files.map((f) => [f.path, f.text]));
        const result = await engine.writeFiles(
          plan.writes.map((w) => ({
            path: w.to,
            text: text.get(w.from) as string,
          })),
        );
        if ("files" in result) importer.discard(choice.id);
        return result;
      }),

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
        if (
          input.import !== undefined &&
          (input.template !== undefined || input.files.length > 0)
        )
          throw new Error(
            "An import can't be combined with a template or files.",
          );
        let files = input.files;
        let source: ProjectSource | undefined;
        if (input.import !== undefined) {
          const chosen = await importer.files(
            input.import.id,
            input.import.ignore,
          );
          if (!chosen.ok) throw new Error(chosen.message);
          files = chosen.files;
          source = chosen.source;
        } else if (input.template !== undefined)
          files = await templateFiles(input.languageVersion, input.template);
        const time = now();
        const meta: ProjectMeta = {
          id: newId(),
          name,
          languageVersion: input.languageVersion,
          createdAt: time,
          updatedAt: time,
          openedAt: time,
          ...(source === undefined ? {} : { source }),
        };
        await store.createProject(meta, files);
        if (input.import !== undefined) importer.discard(input.import.id);
        await refresh();
        return meta;
      }),

    importProject: (input: ImportProject) =>
      serial(async (): Promise<ImportedProject> => {
        const store = needDb();
        const name = normaliseProjectName(input.name);
        if (name === null)
          throw new Error("A project name needs 1 to 100 characters.");
        if (!installedPackVersions().includes(input.languageVersion))
          throw new Error(`No language pack for ${input.languageVersion}.`);
        const { source } = input;
        if (
          source.kind !== "github" ||
          !/^[0-9a-f]{40}$/.test(source.sha) ||
          source.repo === ""
        )
          throw new Error("The import's source is not valid.");
        // loaded on first use, so the unzip code stays out of the worker's main chunk (import-stage.ts)
        const { decodeText, entryPath, IMPORT_LIMITS } = await import(
          "@nf-builder/sources/import"
        );
        // IO-12 again here: the worker doesn't trust the main thread's plan
        if (input.files.length > IMPORT_LIMITS.maxEntries)
          throw new Error("The import has too many files (limit 20,000).");
        let total = 0;
        for (const f of input.files) {
          if (f.bytes.byteLength > IMPORT_LIMITS.maxTextFileBytes)
            throw new Error(`${f.path} is too large (limit 1 MB per file).`);
          total += f.bytes.byteLength;
        }
        if (total > IMPORT_LIMITS.maxTotalBytes)
          throw new Error("The import is too large (limit 200 MB in all).");
        const seen = new Set<string>();
        const files: ProjectFile[] = [];
        const skipped: ImportedProject["skipped"][number][] = [];
        for (const f of input.files) {
          if (entryPath(f.path).kind !== "file" || seen.has(f.path))
            throw new Error(`${f.path} is not a unique, safe file path.`);
          seen.add(f.path);
          const text = decodeText(new Uint8Array(f.bytes));
          if (text === null) skipped.push({ path: f.path, reason: "not-text" });
          else files.push({ path: f.path, text });
        }
        const time = now();
        const meta: ProjectMeta = {
          id: newId(),
          name,
          languageVersion: input.languageVersion,
          createdAt: time,
          updatedAt: time,
          openedAt: time,
          source,
        };
        await store.createProject(meta, files);
        await refresh();
        return { meta, skipped };
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
