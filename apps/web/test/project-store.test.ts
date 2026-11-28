import type { ImportPlan } from "@nf-builder/sources";
import type { GithubClient } from "@nf-builder/sources/github";
import { describe, expect, it, vi } from "vitest";
import type { Review } from "../src/import/github-import";
import type { NewProjectRequest } from "../src/project/new-project-dialog";
import {
  createProjectStore,
  type ProjectStoreDeps,
} from "../src/project/project-store";
import { resetPersistenceRequest } from "../src/project/storage-health";
import {
  INITIAL_STATUS,
  type ProjectMeta,
  type WorkspaceApi,
  type WorkspaceStatus,
} from "../src/workspace/types";

const meta = (id: string, over: Partial<ProjectMeta> = {}): ProjectMeta => ({
  id,
  name: id,
  languageVersion: "26.10",
  createdAt: 1,
  updatedAt: 1,
  openedAt: 1,
  ...over,
});
const ready = (over: Partial<WorkspaceStatus> = {}): WorkspaceStatus => ({
  ...INITIAL_STATUS,
  storage: "ready",
  ...over,
});
const request = (name: string, over: Partial<NewProjectRequest> = {}) => ({
  name,
  languageVersion: "26.10",
  template: "blank",
  publishDocs: true,
  ...over,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

function fixture(
  initial: WorkspaceStatus,
  storage?: () => StorageManager | undefined,
  readOnly?: () => boolean,
  extra: Partial<ProjectStoreDeps> = {},
) {
  const calls: string[] = [];
  const shown: unknown[] = [];
  const gone = { count: 0 };
  let push: (s: WorkspaceStatus) => void = () => undefined;
  const workspace = {
    watch: vi.fn(async (l: (s: WorkspaceStatus) => void) => {
      calls.push("watch");
      push = l;
      return initial;
    }),
    createProject: vi.fn(async (input: { name: string }) => {
      calls.push("createProject");
      return meta("new", { name: input.name });
    }),
    openProject: vi.fn(async (id: string) => {
      calls.push(`openProject:${id}`);
      return { summary: { revision: 7 }, seq: 0 };
    }),
    importProject: vi.fn(async (input: { name: string; files: unknown[] }) => {
      calls.push("importProject");
      return {
        meta: meta("imp", { name: input.name }),
        skipped: [{ path: "notes.txt", reason: "not-text" }],
      };
    }),
    report: vi.fn(async () => {
      calls.push("report");
      return {
        revision: 7,
        files: 2,
        parseFailures: [],
        processes: { typed: 0, legacy: 1 },
        workflows: { typed: 0, legacy: 0 },
        diagnostics: { errors: 0, warnings: 0, suggestions: 2 },
      };
    }),
    renameProject: vi.fn(async () => meta("x")),
    deleteProject: vi.fn(async () => {
      calls.push("deleteProject");
    }),
  } as unknown as WorkspaceApi;
  const github = {
    download: vi.fn(
      async (_r: unknown, _sha: string, files: { path: string }[]) =>
        files.map((f) => ({ path: f.path, bytes: new ArrayBuffer(1) })),
    ),
  };
  const deps: ProjectStoreDeps = {
    github: () => github as unknown as GithubClient,
    workspace: () => workspace,
    palette: async (v) => {
      calls.push(`palette:${v}`);
    },
    templates: async (v) => {
      calls.push(`templates:${v}`);
    },
    storage: storage ?? (() => undefined),
    ...(readOnly === undefined ? {} : { readOnly }),
    ...extra,
    languageVersion: "26.10",
    canvas: {
      show: async (summary) => {
        shown.push(summary);
      },
      projectGone: () => {
        gone.count++;
      },
    },
  };
  resetPersistenceRequest();
  return {
    calls,
    shown,
    gone,
    workspace,
    github,
    store: createProjectStore(deps),
    push: (s: WorkspaceStatus) => push(s),
  };
}

describe("F-202 F-205 project store and canvas", () => {
  it("F-202 F-205 UX-20: every successful openProject (auto-reopen, create, open) shows the summary on the canvas", async () => {
    const f = fixture(ready({ projects: [meta("recent")] }));
    await f.store.getState().start();
    await f.store.getState().create({
      name: "New",
      languageVersion: "26.10",
      template: "blank",
      publishDocs: true,
    });
    await f.store.getState().open("recent");
    await settle();
    expect(f.shown).toEqual([
      { revision: 7 },
      { revision: 7 },
      { revision: 7 },
    ]);
  });

  it("F-403 UX-60: create sends the import choice without a template, then opens the new project", async () => {
    const f = fixture(ready());
    await f.store.getState().create({
      name: "Zip",
      languageVersion: "26.10",
      publishDocs: false,
      import: { id: "stage-1", ignore: "data/\n" },
    });
    expect(f.workspace.createProject).toHaveBeenCalledWith({
      name: "Zip",
      languageVersion: "26.10",
      files: [],
      publishDocs: false,
      import: { id: "stage-1", ignore: "data/\n" },
    });
    expect(f.calls).toContain("openProject:new");
  });

  it("F-202 F-205 UX-20: a failed open shows nothing", async () => {
    const f = fixture(ready());
    (f.workspace.openProject as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no"),
    );
    await expect(f.store.getState().open("x")).rejects.toThrow("no");
    expect(f.shown).toEqual([]);
  });

  it("F-202 F-205 UX-20: a status with no current project resets the canvas; one with a current project does not", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    const before = f.gone.count;
    f.push(ready({ current: meta("a") }));
    expect(f.gone.count).toBe(before);
    f.push(ready({ current: null }));
    expect(f.gone.count).toBe(before + 1);
  });

  it("F-203 UX-20: a status sent while a project opens does not reset the canvas, so a late one can't wipe the opened project", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    const before = f.gone.count;
    f.push(
      ready({ current: null, opening: { project: meta("a"), progress: null } }),
    );
    expect(f.gone.count).toBe(before);
  });
});

describe("F-203 status ordering", () => {
  it("F-203 UX-20: a status older than the open's reply is ignored, so a stale push can't clear the canvas", async () => {
    const f = fixture(ready({ seq: 1 }));
    (f.workspace.openProject as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({ summary: { revision: 7 }, seq: 5 }),
    );
    await f.store.getState().start();
    const before = f.gone.count;
    await f.store.getState().open("a");
    // pushed by createProject's refresh when nothing was open, delivered after the open's reply
    f.push(ready({ seq: 3, current: null, opening: null }));
    expect(f.gone.count).toBe(before);
    expect(f.store.getState().status.seq).toBe(1);
    f.push(ready({ seq: 5, current: meta("a") }));
    expect(f.store.getState().status.current?.id).toBe("a");
    f.push(ready({ seq: 4, current: null }));
    expect(f.store.getState().status.current?.id).toBe("a");
    f.push(ready({ seq: 6, current: null }));
    expect(f.store.getState().status.current).toBeNull();
  });
});

describe("F-202 project store", () => {
  it("F-202 QA-03 ADR-0029: start requests the palette before reopening the most recently opened project", async () => {
    const f = fixture(ready({ projects: [meta("recent"), meta("older")] }));
    await f.store.getState().start();
    expect(f.calls).toEqual([
      "palette:26.10",
      "templates:26.10",
      "watch",
      "openProject:recent",
    ]);
  });

  it("F-202 QA-03 ADR-0029: start does not wait for the palette before watching", async () => {
    const f = fixture(ready());
    const deps = f as unknown as { calls: string[] };
    // a palette that never settles must not hold the workspace back
    const never = createProjectStore({
      workspace: () => f.workspace,
      github: () => f.github as unknown as GithubClient,
      palette: () => new Promise(() => undefined),
      templates: () => new Promise(() => undefined),
      storage: () => undefined,
      languageVersion: "26.10",
      canvas: { show: async () => undefined, projectGone: () => undefined },
    });
    await never.getState().start();
    expect(f.workspace.watch).toHaveBeenCalledTimes(1);
    expect(deps.calls).toContain("watch");
  });

  it("F-203 UX-60: start prefetches the template list, and a failed prefetch does not stop it", async () => {
    const f = fixture(ready({ projects: [meta("a")] }));
    const failing = createProjectStore({
      workspace: () => f.workspace,
      github: () => f.github as unknown as GithubClient,
      palette: async () => undefined,
      templates: async () => {
        throw new Error("worker failed");
      },
      storage: () => undefined,
      languageVersion: "26.10",
      canvas: { show: async () => undefined, projectGone: () => undefined },
    });
    await failing.getState().start();
    expect(f.workspace.openProject).toHaveBeenCalledWith("a");
    expect(failing.getState().status.storage).toBe("ready");
  });

  it("F-202 IO-01: start opens nothing when a project is already open or none exist", async () => {
    const a = fixture(ready());
    await a.store.getState().start();
    expect(a.calls).toEqual(["palette:26.10", "templates:26.10", "watch"]);
    const b = fixture(ready({ projects: [meta("a")], current: meta("a") }));
    await b.store.getState().start();
    expect(b.calls).toEqual(["palette:26.10", "templates:26.10", "watch"]);
  });

  it("F-202 IO-01: the store mirrors pushed workspace status", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    expect(f.store.getState().status.storage).toBe("ready");
    f.push(ready({ projects: [meta("a")], current: meta("a") }));
    expect(f.store.getState().status.current?.id).toBe("a");
  });

  it("F-203 UX-60: create sends the template and Publish docs, then opens the new project", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    await f.store
      .getState()
      .create(request("RNA", { template: "hello-world", publishDocs: false }));
    expect(f.workspace.createProject).toHaveBeenCalledWith({
      name: "RNA",
      languageVersion: "26.10",
      files: [],
      template: "hello-world",
      publishDocs: false,
    });
    expect(f.calls.slice(-2)).toEqual(["createProject", "openProject:new"]);
  });

  it("F-203 UX-60: the dialog state lives in the store: showDialog opens it on a route and closeDialog clears it", () => {
    const f = fixture(ready());
    const { showDialog, closeDialog } = f.store.getState();
    expect(f.store.getState().dialog).toBeNull();
    showDialog({ kind: "new", route: "template" });
    expect(f.store.getState().dialog).toEqual({
      kind: "new",
      route: "template",
    });
    showDialog({ kind: "rename" });
    expect(f.store.getState().dialog).toEqual({ kind: "rename" });
    closeDialog();
    expect(f.store.getState().dialog).toBeNull();
  });

  it("F-202 IO-03: create requests persistence and checks the quota; each saved push and each delete checks it again", async () => {
    const persist = vi.fn(async () => true);
    let fraction = 0.5;
    const estimate = vi.fn(async () => ({ usage: fraction * 100, quota: 100 }));
    const f = fixture(
      ready({ current: meta("a"), projects: [meta("a")] }),
      () =>
        ({
          persisted: async () => false,
          persist,
          estimate,
        }) as unknown as StorageManager,
    );
    await f.store.getState().start();
    await settle();
    expect(estimate).toHaveBeenCalledTimes(1); // at start
    expect(persist).not.toHaveBeenCalled();
    await f.store.getState().create(request("P"));
    await settle();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(f.store.getState().persisted).toBe(true);
    // a saving push, then saved: the quota is checked again, persistence is not requested twice
    fraction = 0.85;
    f.push(ready({ save: { status: "saving", error: null } }));
    f.push(ready({ save: { status: "saved", error: null } }));
    await settle();
    expect(estimate).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(f.store.getState().storageWarning?.fraction).toBe(0.85);
    fraction = 0.1;
    await f.store.getState().remove("a");
    await settle();
    expect(estimate).toHaveBeenCalledTimes(4);
    expect(f.store.getState().storageWarning).toBeNull();
  });

  it("F-202 IO-03 ADR-0044: refused or unsupported persist() and estimate() leave no warning, no error and a false persisted flag", async () => {
    const refusing = {
      persisted: async () => false,
      persist: () => Promise.reject(new Error("NotAllowedError")),
      estimate: () => Promise.reject(new Error("SecurityError")),
    } as unknown as StorageManager;
    const f = fixture(ready(), () => refusing);
    await f.store.getState().start();
    await f.store.getState().create(request("P"));
    await settle();
    expect(f.store.getState().storageWarning).toBeNull();
    expect(f.store.getState().persisted).toBe(false);
    // no storage manager at all, and a getter that throws
    const bare = fixture(ready(), () => undefined);
    await bare.store.getState().create(request("P"));
    await settle();
    expect(bare.store.getState().storageWarning).toBeNull();
    expect(bare.store.getState().persisted).toBeNull();
    const throwing = fixture(ready(), () => {
      throw new Error("SecurityError");
    });
    await throwing.store.getState().create(request("P"));
    await settle();
    expect(throwing.store.getState().storageWarning).toBeNull();
  });

  it("F-202 ADR-0002: a workspace that can't be reached is reported as unavailable storage, not thrown", async () => {
    const f = fixture(ready());
    (f.workspace.watch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("The engine worker failed (error): no detail"),
    );
    await expect(f.store.getState().start()).resolves.toBeUndefined();
    expect(f.store.getState().status).toMatchObject({
      storage: "unavailable",
      storageError: "The engine worker failed (error): no detail",
    });
  });
});

const SHA = "955c892d80927cee633765e6e390f9cc6b7235c9";
const run = () => ({
  name: "fetchngs",
  languageVersion: "26.10",
  review: {
    input: { repo: { owner: "nf-core", name: "fetchngs" }, ref: "1.13.0" },
    listing: {
      repo: { owner: "nf-core", name: "fetchngs" },
      ref: "1.13.0",
      sha: SHA,
      entries: [],
    },
    candidates: [],
  } as Review,
  plan: {
    files: [
      { path: "main.nf", size: 1 },
      { path: "notes.txt", size: 1 },
    ],
    summary: {
      source: "",
      stripped: null,
      files: 2,
      bytes: 2,
      skipped: [{ reason: "binary", count: 1, bytes: 5, paths: ["a.png"] }],
      ignore: "",
      ignoreProblems: [],
    },
    breaches: [],
    hasNextflow: true,
  } as ImportPlan,
});
const options = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

describe("F-401 project store GitHub import", () => {
  it("F-401 UX-61 IO-13: importGithub downloads, imports with the source, opens the project, then sets the report", async () => {
    const f = fixture(ready());
    await f.store.getState().importGithub(run(), options());
    expect(f.calls.filter((c) => c !== "watch")).toEqual([
      "importProject",
      "openProject:imp",
      "report",
    ]);
    expect(f.workspace.importProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fetchngs",
        source: {
          kind: "github",
          repo: "nf-core/fetchngs",
          ref: "1.13.0",
          sha: SHA,
        },
      }),
    );
    const report = f.store.getState().importReport;
    expect(report).toMatchObject({
      projectName: "fetchngs",
      imported: 1,
      source: { sha: SHA },
    });
    // the worker's not-text file joins the plan's binary group
    expect(report?.skipped).toEqual([
      { reason: "binary", count: 2, bytes: 6, paths: ["a.png", "notes.txt"] },
    ]);
    f.store.getState().closeImportReport();
    expect(f.store.getState().importReport).toBeNull();
  });

  it("F-401 F-703 UX-04: read-only importGithub is refused before any download or import", async () => {
    const f = fixture(ready(), undefined, () => true);
    await expect(
      f.store.getState().importGithub(run(), options()),
    ).rejects.toThrow("Editing needs a larger screen or a wider window.");
    expect(f.github.download).not.toHaveBeenCalled();
    expect(f.workspace.importProject).not.toHaveBeenCalled();
    expect(f.store.getState().importReport).toBeNull();
  });

  it("F-401 UX-61: a report that fails leaves the import standing", async () => {
    const f = fixture(ready());
    (f.workspace.report as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      code: "no-project",
      message: "No project is open.",
    });
    await f.store.getState().importGithub(run(), options());
    expect(f.store.getState().importReport?.project).toEqual({
      error: "No project is open.",
    });
  });

  it("F-401 UX-61 IO-13: a failed download imports nothing and sets no report", async () => {
    const f = fixture(ready());
    f.github.download.mockRejectedValue(new Error("down"));
    await expect(
      f.store.getState().importGithub(run(), options()),
    ).rejects.toThrow("down");
    expect(f.workspace.importProject).not.toHaveBeenCalled();
    expect(f.store.getState().importReport).toBeNull();
  });
});

describe("F-703 read-only project store", () => {
  it("F-703 UX-04: read-only create, rename and delete are refused without calling the workspace; open still opens a stored project", async () => {
    const f = fixture(ready({ projects: [meta("p")] }), undefined, () => true);
    const message = "Editing needs a larger screen or a wider window.";
    await expect(f.store.getState().create(request("X"))).rejects.toThrow(
      message,
    );
    await expect(f.store.getState().rename("p", "Y")).rejects.toThrow(message);
    await expect(f.store.getState().remove("p")).rejects.toThrow(message);
    expect(f.workspace.createProject).not.toHaveBeenCalled();
    expect(f.workspace.renameProject).not.toHaveBeenCalled();
    expect(f.workspace.deleteProject).not.toHaveBeenCalled();
    await f.store.getState().open("p");
    expect(f.workspace.openProject).toHaveBeenCalledWith("p");
  });
});

describe("F-404 project store export", () => {
  const zip = {
    ok: true,
    fileName: "P.zip",
    bytes: new Uint8Array([1]),
    files: 1,
    revision: 3,
  };
  it("F-404 UX-62: exportProject flushes code edits before asking the workspace, then downloads the file name and bytes it returns", async () => {
    const order: string[] = [];
    const f = fixture(ready(), undefined, undefined, {
      flushEdits: async () => {
        order.push("flush");
      },
      download: (bytes, name) => order.push(`download:${name}:${bytes.length}`),
    });
    (f.workspace as unknown as Record<string, unknown>).exportProject = vi.fn(
      async (o: { layout: boolean }) => {
        order.push(`export:${o.layout}`);
        return zip;
      },
    );
    await f.store.getState().exportProject(false);
    expect(order).toEqual(["flush", "export:false", "download:P.zip:1"]);
  });

  it("F-404: a refused export throws its message and downloads nothing", async () => {
    const download = vi.fn();
    const f = fixture(ready(), undefined, undefined, {
      flushEdits: async () => undefined,
      download,
    });
    (f.workspace as unknown as Record<string, unknown>).exportProject = vi.fn(
      async () => ({
        ok: false,
        code: "invalid",
        message: "Nothing to export.",
      }),
    );
    await expect(f.store.getState().exportProject(true)).rejects.toThrow(
      "Nothing to export.",
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("F-404 UX-62: the Export dialog kind is held in the store with the opener's focus target", () => {
    const f = fixture(ready());
    f.store.getState().showDialog({ kind: "export" });
    expect(f.store.getState().dialog).toEqual({ kind: "export" });
  });
});
