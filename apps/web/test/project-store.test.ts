import { describe, expect, it, vi } from "vitest";
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
const settle = () => new Promise((r) => setTimeout(r, 0));

function fixture(
  initial: WorkspaceStatus,
  storage?: () => StorageManager | undefined,
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
      return { revision: 7 };
    }),
    renameProject: vi.fn(async () => meta("x")),
    deleteProject: vi.fn(async () => {
      calls.push("deleteProject");
    }),
  } as unknown as WorkspaceApi;
  const deps: ProjectStoreDeps = {
    workspace: () => workspace,
    palette: async (v) => {
      calls.push(`palette:${v}`);
    },
    storage: storage ?? (() => undefined),
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
    store: createProjectStore(deps),
    push: (s: WorkspaceStatus) => push(s),
  };
}

describe("F-202 F-205 project store and canvas", () => {
  it("F-202 F-205 UX-20: every successful openProject (auto-reopen, create, open) shows the summary on the canvas", async () => {
    const f = fixture(ready({ projects: [meta("recent")] }));
    await f.store.getState().start();
    await f.store.getState().create("New");
    await f.store.getState().open("recent");
    await settle();
    expect(f.shown).toEqual([
      { revision: 7 },
      { revision: 7 },
      { revision: 7 },
    ]);
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
});

describe("F-202 project store", () => {
  it("F-202 QA-03 ADR-0029: start requests the palette before reopening the most recently opened project", async () => {
    const f = fixture(ready({ projects: [meta("recent"), meta("older")] }));
    await f.store.getState().start();
    expect(f.calls).toEqual(["palette:26.10", "watch", "openProject:recent"]);
  });

  it("F-202 QA-03 ADR-0029: start does not wait for the palette before watching", async () => {
    const f = fixture(ready());
    const deps = f as unknown as { calls: string[] };
    // a palette that never settles must not hold the workspace back
    const never = createProjectStore({
      workspace: () => f.workspace,
      palette: () => new Promise(() => undefined),
      storage: () => undefined,
      languageVersion: "26.10",
      canvas: { show: async () => undefined, projectGone: () => undefined },
    });
    await never.getState().start();
    expect(f.workspace.watch).toHaveBeenCalledTimes(1);
    expect(deps.calls).toContain("watch");
  });

  it("F-202 IO-01: start opens nothing when a project is already open or none exist", async () => {
    const a = fixture(ready());
    await a.store.getState().start();
    expect(a.calls).toEqual(["palette:26.10", "watch"]);
    const b = fixture(ready({ projects: [meta("a")], current: meta("a") }));
    await b.store.getState().start();
    expect(b.calls).toEqual(["palette:26.10", "watch"]);
  });

  it("F-202 IO-01: the store mirrors pushed workspace status", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    expect(f.store.getState().status.storage).toBe("ready");
    f.push(ready({ projects: [meta("a")], current: meta("a") }));
    expect(f.store.getState().status.current?.id).toBe("a");
  });

  it("F-202 UX-01 LA-01: create stores a project with no files in the first installed version, then opens it", async () => {
    const f = fixture(ready());
    await f.store.getState().start();
    await f.store.getState().create("RNA");
    expect(f.workspace.createProject).toHaveBeenCalledWith({
      name: "RNA",
      languageVersion: "26.10",
      files: [],
    });
    expect(f.calls.slice(-2)).toEqual(["createProject", "openProject:new"]);
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
    await f.store.getState().create("P");
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
    await f.store.getState().create("P");
    await settle();
    expect(f.store.getState().storageWarning).toBeNull();
    expect(f.store.getState().persisted).toBe(false);
    // no storage manager at all, and a getter that throws
    const bare = fixture(ready(), () => undefined);
    await bare.store.getState().create("P");
    await settle();
    expect(bare.store.getState().storageWarning).toBeNull();
    expect(bare.store.getState().persisted).toBeNull();
    const throwing = fixture(ready(), () => {
      throw new Error("SecurityError");
    });
    await throwing.store.getState().create("P");
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
