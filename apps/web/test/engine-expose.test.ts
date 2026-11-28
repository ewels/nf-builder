import { releaseProxy } from "comlink";
import { describe, expect, it, vi } from "vitest";

const exposed = vi.hoisted(() => ({ api: null as unknown }));
const transferred = vi.hoisted(() => [] as unknown[][]);
vi.mock("comlink", async (original) => ({
  ...(await original<typeof import("comlink")>()),
  transfer: (value: unknown, list: unknown[]) => {
    transferred.push(list);
    return value;
  },
  expose: (api: unknown) => {
    exposed.api = api;
  },
}));

import { exposeEngine } from "../src/engine/expose";
import type { WorkspaceApi } from "../src/workspace/types";

const listener = () => {
  const release = vi.fn();
  const fn = Object.assign(() => undefined, { [releaseProxy]: release });
  return { fn, release };
};

describe("F-202 worker bridge", () => {
  it("F-202 ADR-0003: a later watch releases the earlier listener's proxy, and only that one", async () => {
    const watch = vi.fn(async () => ({}) as never);
    exposeEngine({ watch } as unknown as WorkspaceApi, {} as never);
    const api = exposed.api as WorkspaceApi;
    const a = listener();
    const b = listener();
    await api.watch(a.fn);
    expect(a.release).not.toHaveBeenCalled();
    await api.watch(b.fn);
    expect(a.release).toHaveBeenCalledTimes(1);
    expect(b.release).not.toHaveBeenCalled();
    expect(watch).toHaveBeenLastCalledWith(b.fn);
  });
});

describe("F-404 export transfer", () => {
  it("F-404: exportProject's bytes are transferred, not copied", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = {
      ok: true,
      fileName: "a.zip",
      bytes,
      files: 1,
      revision: 0,
    };
    const exportProject = vi.fn(async () => result as never);
    exposeEngine({ exportProject } as unknown as WorkspaceApi, {} as never);
    const api = exposed.api as WorkspaceApi;
    const out = await api.exportProject({ layout: true });
    expect(out).toBe(result);
    expect(transferred.at(-1)).toEqual([bytes.buffer]);
  });
});
