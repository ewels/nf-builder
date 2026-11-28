import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { WEB_DIST } from "../scripts/check-common.ts";
import { readWorkerManifest } from "../scripts/worker-manifest.ts";

/** Every file under `dir` as project files, with POSIX paths relative to it. */
export function readProject(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        out.push({
          path: relative(dir, full).split("\\").join("/"),
          text: readFileSync(full, "utf8"),
        });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The built worker chunks that hold the parser (its source is the pack's source/index.ts). */
export function parserChunks(): string[] {
  return readWorkerManifest(WEB_DIST)
    .filter((c) => c.src?.endsWith("packages/lang-2610/src/source/index.ts"))
    .map((c) => c.file);
}

/** The subset of the engine API the tests and the bench call, on `window.nfBuilderEngine`. */
export interface EngineHook {
  open(
    request: { version: string; files: { path: string; text: string }[] },
    onProgress?: (progress: {
      phase: string;
      done: number;
      total: number;
    }) => void,
  ): Promise<{ revision: number }>;
  writeFiles(
    files: { path: string; text: string | null }[],
  ): Promise<{ revision?: number }>;
  apply(
    command: unknown,
    revision: number,
  ): Promise<{
    ok: boolean;
    revision: number | null;
    remodelled?: string[];
    inverse?: unknown;
    code?: string;
    message?: string;
  }>;
  applyPatches(
    patches: unknown,
    revision: number,
  ): Promise<{ ok: boolean; revision: number | null }>;
  project(path: string, workflow: string | null): Promise<unknown>;
  /** The Files view's list (F-210): every file with its parse status, and the registry module folders. */
  listFiles(): Promise<{
    revision?: number;
    files?: {
      path: string;
      language: string;
      status: string;
      problems: number;
    }[];
    registry?: { path: string; module: string }[];
    code?: string;
  }>;
  diagnostics(): Promise<{
    revision?: number;
    diagnostics?: {
      path: string;
      severity: string;
      code: string;
      message: string;
      range: { start: number; end: number; line: number; column: number };
      fix?: { title: string; path: string; edits: unknown[] };
    }[];
    code?: string;
  }>;
  /** The config editor's view of a config file (F-601): the fields the tests read. */
  configView(path: string): Promise<{
    revision?: number;
    view?: {
      path: string;
      editable: boolean;
      items: { kind: string; card?: { scope: string; rows: unknown[] } }[];
    } | null;
    ok?: false;
    code?: string;
  }>;
  /** The config catalogue tree (F-601): the fields the tests read. */
  configSchema(version: string): Promise<{
    version: string;
    scopes: { name: string; kind: string }[];
  }>;
  /** The Configure form of a process node (F-303): the fields the tests read. */
  declarationForm(
    path: string,
    workflow: string | null,
    node: string,
  ): Promise<{
    revision?: number;
    target?: { path: string; name: string };
    form?: { name: string; inputs: unknown[]; outputs: unknown[] };
    ok?: false;
    code?: string;
  }>;
  outline(path: string): Promise<{
    revision?: number;
    items?: { kind: string; name: string; line: number }[];
    code?: string;
  }>;
  /** The import report of the open project (F-401): the fields the tests read. */
  report(): Promise<{
    files?: number;
    diagnostics?: { suggestions: number };
    ok?: false;
  }>;
}
