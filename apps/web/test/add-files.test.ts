import type { ImportSummary } from "@nf-builder/sources";
import { describe, expect, it } from "vitest";
import { type AddFilesState, createAddFiles } from "../src/files/add-files";
import { READ_ONLY_REFUSAL } from "../src/read-only/read-only-store";
import type {
  AddChoice,
  AddPreviewResult,
  ImportStageResult,
} from "../src/workspace/types";

const summary = (ignore = "", files = 2): ImportSummary => ({
  source: "x",
  stripped: null,
  files,
  bytes: 10,
  skipped: [],
  ignore,
  ignoreProblems: [],
});
const preview = (choice: AddChoice, adds = 2): AddPreviewResult => ({
  ok: true,
  id: choice.id,
  summary: summary(choice.ignore),
  folder: choice.folder,
  adds,
  replaced: [],
  replacedCount: 0,
  conflicts: [],
  conflictCount: 0,
});
const file = (name: string, type = ""): File => new File(["x"], name, { type });

interface Timers {
  fns: (() => void)[];
  set(fn: () => void): number;
  clear(h: unknown): void;
  /** Fires every pending timer once. */
  run(): void;
}
function setup(
  overrides: {
    previewAdd?: (c: AddChoice) => Promise<AddPreviewResult>;
    addFiles?: (c: AddChoice) => Promise<unknown>;
    session?: () => number;
    readOnly?: () => boolean;
  } = {},
) {
  const calls: string[] = [];
  const states: AddFilesState[] = [];
  const added: [string, number][] = [];
  const timers: Timers = {
    fns: [],
    set(fn) {
      this.fns.push(fn);
      return this.fns.length - 1;
    },
    clear(h) {
      this.fns[h as number] = () => undefined;
    },
    run() {
      const due = this.fns;
      this.fns = [];
      for (const fn of due) fn();
    },
  };
  const workspace = {
    stageZip: async (_f: Blob, name: string): Promise<ImportStageResult> => {
      calls.push(`stageZip ${name}`);
      return { ok: true, id: "z1", summary: summary("node_modules/\n") };
    },
    stageFiles: async (files: readonly { name: string }[]) => {
      calls.push(`stageFiles ${files.map((f) => f.name).join(",")}`);
      return { ok: true as const, id: "f1", summary: summary() };
    },
    previewAdd:
      overrides.previewAdd ??
      (async (c: AddChoice) => {
        calls.push(`previewAdd ${JSON.stringify(c)}`);
        return preview(c);
      }),
    addFiles:
      overrides.addFiles ??
      (async (c: AddChoice) => {
        calls.push(`addFiles ${JSON.stringify(c)}`);
        return { revision: 2, files: [] };
      }),
    discardImport: async (id: string) => {
      calls.push(`discard ${id}`);
    },
  };
  const view = createAddFiles({
    workspace: () => workspace as never,
    session: overrides.session ?? (() => 1),
    onChange: (s) => states.push(s),
    flush: async () => {
      calls.push("flush");
    },
    readOnly: overrides.readOnly ?? (() => false),
    onAdded: (folder, count) => added.push([folder, count]),
    timer: timers,
    debounceMs: 300,
  });
  const last = () => states.at(-1) as AddFilesState;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { view, calls, states, added, timers, last, settle };
}

describe("F-210 add files", () => {
  it("F-210 UX-16 IO-11: a zip is staged with stageZip and other files with stageFiles; the preview follows", async () => {
    const z = setup();
    z.view.start({ kind: "zip", file: file("pipe.zip") }, "assets");
    expect(z.last()).toEqual({ status: "reading", name: "pipe.zip" });
    await z.settle();
    expect(z.calls[0]).toBe("stageZip pipe.zip");
    expect(z.calls[1]).toContain('previewAdd {"id":"z1"');
    expect(z.calls[1]).toContain('"ignore":"node_modules/\\n"');
    expect(z.calls[1]).toContain('"keepFolder":false,"folder":"assets"');
    const ready = z.last();
    expect(ready.status === "ready" && ready.zip).toBe(true);
    const l = setup();
    l.view.start({ kind: "files", files: [file("a.csv"), file("b.csv")] }, "");
    await l.settle();
    expect(l.calls[0]).toBe("stageFiles a.csv,b.csv");
    const loose = l.last();
    expect(loose.status === "ready" && loose.zip).toBe(false);
    expect(loose.status === "ready" && loose.name).toBe("a.csv and 1 more");
  });

  it("F-210 UX-16 IO-12: an ignore-list or keep-folder change previews again after 300 ms; an older reply never replaces a newer one", async () => {
    const pending: ((r: AddPreviewResult) => void)[] = [];
    const t = setup({
      previewAdd: (c) => {
        if (c.id === "z1" && c.ignore === "node_modules/\n") {
          return Promise.resolve(preview(c));
        }
        return new Promise((resolve) => {
          pending.push((r) => resolve(r));
        });
      },
    });
    t.view.start({ kind: "zip", file: file("p.zip") }, "");
    await t.settle();
    t.view.setIgnore("a");
    t.view.setIgnore("ab");
    const ready = t.last();
    expect(ready.status === "ready" && ready.updating).toBe(true);
    expect(ready.status === "ready" && ready.ignore).toBe("ab");
    // nothing is sent until the pause
    expect(pending).toHaveLength(0);
    t.timers.run();
    expect(pending).toHaveLength(1);
    // another edit while the first preview is out
    t.view.setKeepFolder(true);
    t.timers.run();
    expect(pending).toHaveLength(2);
    // the newer reply lands first, the older one is dropped
    pending[1]?.(
      preview({ id: "z1", ignore: "ab", keepFolder: true, folder: "" }, 7),
    );
    await t.settle();
    pending[0]?.(
      preview({ id: "z1", ignore: "ab", keepFolder: false, folder: "" }, 1),
    );
    await t.settle();
    const s = t.last();
    expect(s.status === "ready" && s.preview.adds).toBe(7);
    expect(s.status === "ready" && s.updating).toBe(false);
    expect(s.status === "ready" && s.keepFolder).toBe(true);
  });

  it("F-210 AR-23: confirm sends the code panes' pending edits before the write", async () => {
    const t = setup();
    t.view.start({ kind: "files", files: [file("a.csv")] }, "");
    await t.settle();
    await t.view.confirm();
    const flushed = t.calls.indexOf("flush");
    expect(flushed).toBeGreaterThan(-1);
    expect(flushed).toBeLessThan(
      t.calls.findIndex((c) => c.startsWith("addFiles")),
    );
  });

  it("F-210 UX-16: confirm sends the choice and reports the count and folder; cancel discards the stage; a refusal shows its message", async () => {
    const t = setup();
    t.view.start({ kind: "files", files: [file("a.csv")] }, "assets");
    await t.settle();
    expect(await t.view.confirm()).toBe(true);
    expect(t.calls.at(-1)).toBe(
      'addFiles {"id":"f1","ignore":"","keepFolder":false,"folder":"assets"}',
    );
    expect(t.added).toEqual([["assets", 2]]);
    expect(t.last()).toEqual({ status: "idle" });

    const c = setup();
    c.view.start({ kind: "files", files: [file("a.csv")] }, "");
    await c.settle();
    c.view.cancel();
    expect(c.calls).toContain("discard f1");
    expect(c.last()).toEqual({ status: "idle" });
    expect(await c.view.confirm()).toBe(false);

    const r = setup({
      addFiles: async () => ({ ok: false, message: "Nothing to add." }),
    });
    r.view.start({ kind: "files", files: [file("a.csv")] }, "");
    await r.settle();
    expect(await r.view.confirm()).toBe(false);
    expect(r.last()).toEqual({
      status: "refused",
      name: "a.csv",
      message: "Nothing to add.",
    });

    const folder = setup();
    folder.view.start({ kind: "folder" }, "");
    expect(folder.last()).toMatchObject({
      status: "refused",
      message:
        "Folders can't be dropped. Drop the files in it, or a zip of the folder.",
    });
    expect(folder.calls).toEqual([]);
  });

  it("F-210 F-703 UX-04: a drop while read-only is refused before anything is staged or previewed", async () => {
    const t = setup({ readOnly: () => true });
    t.view.start({ kind: "files", files: [file("a.csv")] }, "");
    await t.settle();
    expect(t.calls).toEqual([]);
    expect(t.last()).toEqual({
      status: "refused",
      name: "",
      message: READ_ONLY_REFUSAL,
    });
  });

  it("F-210 F-703 UX-04: an add in flight when the window narrows is refused before it writes", async () => {
    let narrow = false;
    const t = setup({ readOnly: () => narrow });
    t.view.start({ kind: "files", files: [file("a.csv")] }, "");
    await t.settle();
    narrow = true;
    expect(await t.view.confirm()).toBe(false);
    expect(t.calls.some((c) => c.startsWith("addFiles"))).toBe(false);
    expect(t.last()).toMatchObject({
      status: "refused",
      message: READ_ONLY_REFUSAL,
    });
    expect(t.added).toEqual([]);
  });

  it("F-210 F-703 UX-04: a preview after an ignore-list edit is not requested once read-only", async () => {
    let narrow = false;
    const t = setup({ readOnly: () => narrow });
    t.view.start({ kind: "zip", file: file("pipe.zip") }, "");
    await t.settle();
    const before = t.calls.length;
    t.view.setIgnore("x/\n");
    narrow = true;
    t.timers.run();
    await t.settle();
    expect(t.calls.length).toBe(before);
    expect(t.last()).toMatchObject({ status: "refused" });
  });

  it("F-210 UX-16: a stage that finishes after another project opened is discarded", async () => {
    let session = 1;
    const t = setup({ session: () => session });
    t.view.start({ kind: "files", files: [file("a.csv")] }, "");
    session = 2;
    await t.settle();
    expect(t.calls).toContain("discard f1");
    expect(t.last()).toEqual({ status: "idle" });
  });
});
