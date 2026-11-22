// The project-level semantic model with incremental updates (AR-03, AR-04, F-105). A text edit re-parses that file and
// re-models it and the files whose includes resolved to it. Creating or deleting a file also re-models the files whose
// resolution looked for that path, or for a directory whose existence flipped. Nextflow has no re-exports, so
// dependants of dependants are untouched. Synchronous: parsing needs the pack's parser, which `openProject` loads.
import type {
  Diagnostic,
  IncludeRules,
  LanguagePack,
  SourceParser,
} from "@nf-builder/lang-core";
import { installedPacks } from "../packs";
import { loadParser } from "../source/parser";
import {
  type Binding,
  type FileModel,
  modelFile,
  type ParsedFile,
  parseFile,
} from "./file-model";
import { FileTree, type Watch } from "./tree";

export interface ProjectFile {
  path: string;
  text: string;
}
export interface ModelEvent {
  kind: "parse" | "model";
  path: string;
}
export interface ProjectModelOptions {
  parser: SourceParser;
  includes: IncludeRules;
  /** Called for every parse and every model computation, so tests can count work. */
  trace?: (event: ModelEvent) => void;
}
export interface ModelChange {
  /** The files whose model was recomputed, sorted. */
  remodelled: readonly string[];
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function index(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>();
  map.set(key, set);
  set.add(value);
}
function unindex(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}

export class ProjectModel {
  readonly #options: ProjectModelOptions;
  readonly #tree = new FileTree();
  readonly #parsed = new Map<string, ParsedFile>();
  readonly #models = new Map<string, FileModel>();
  readonly #watches = new Map<string, Watch>();
  readonly #targets = new Map<string, readonly string[]>();
  /** Target path to the files with an include resolved to it. */
  readonly #resolvedBy = new Map<string, Set<string>>();
  readonly #fileWatch = new Map<string, Set<string>>();
  readonly #dirWatch = new Map<string, Set<string>>();

  constructor(files: Iterable<ProjectFile>, options: ProjectModelOptions) {
    this.#options = options;
    for (const f of files) {
      this.#parsed.set(f.path, this.#parse(f.path, f.text));
      this.#tree.add(f.path);
    }
    this.#remodel(new Set(this.#parsed.keys()));
  }

  #parse(path: string, text: string): ParsedFile {
    this.#options.trace?.({ kind: "parse", path });
    return parseFile(path, text, this.#options.parser, this.#options.includes);
  }

  #drop(path: string) {
    const watch = this.#watches.get(path);
    if (watch) {
      for (const f of watch.files) unindex(this.#fileWatch, f, path);
      for (const d of watch.directories) unindex(this.#dirWatch, d, path);
    }
    for (const t of this.#targets.get(path) ?? [])
      unindex(this.#resolvedBy, t, path);
    this.#watches.delete(path);
    this.#targets.delete(path);
    this.#models.delete(path);
  }

  #remodel(paths: ReadonlySet<string>): ModelChange {
    const todo = [...paths].filter((p) => this.#parsed.has(p)).sort(byPath);
    for (const path of todo) {
      this.#options.trace?.({ kind: "model", path });
      this.#drop(path);
      const { model, watch } = modelFile(
        this.#parsed.get(path) as ParsedFile,
        this.#tree,
        (p) => this.#parsed.get(p),
        this.#options.includes,
      );
      this.#models.set(path, model);
      this.#watches.set(path, watch);
      for (const f of watch.files) index(this.#fileWatch, f, path);
      for (const d of watch.directories) index(this.#dirWatch, d, path);
      const targets = [
        ...new Set(
          model.includes.flatMap((i) =>
            i.target.kind === "file" ? [i.target.path] : [],
          ),
        ),
      ].sort(byPath);
      this.#targets.set(path, targets);
      for (const t of targets) index(this.#resolvedBy, t, path);
    }
    return { remodelled: todo };
  }

  setFile(path: string, text: string): ModelChange {
    const isNew = !this.#parsed.has(path);
    this.#parsed.set(path, this.#parse(path, text));
    const flipped = isNew ? this.#tree.add(path) : [];
    const affected = new Set<string>([path]);
    const source = isNew ? this.#fileWatch : this.#resolvedBy;
    for (const q of source.get(path) ?? []) affected.add(q);
    for (const d of flipped)
      for (const q of this.#dirWatch.get(d) ?? []) affected.add(q);
    return this.#remodel(affected);
  }

  deleteFile(path: string): ModelChange {
    if (!this.#parsed.has(path)) return { remodelled: [] };
    const affected = new Set<string>(this.#fileWatch.get(path) ?? []);
    this.#drop(path);
    this.#parsed.delete(path);
    const flipped = this.#tree.remove(path);
    for (const d of flipped)
      for (const q of this.#dirWatch.get(d) ?? []) affected.add(q);
    affected.delete(path);
    return this.#remodel(affected);
  }

  file(path: string): FileModel | undefined {
    return this.#models.get(path);
  }

  paths(): readonly string[] {
    return [...this.#parsed.keys()].sort(byPath);
  }

  /** The project files this file's includes resolve to. */
  dependencies(path: string): readonly string[] {
    return this.#targets.get(path) ?? [];
  }

  /** The files with an include that resolves to this file. */
  dependants(path: string): readonly string[] {
    return [...(this.#resolvedBy.get(path) ?? [])].sort(byPath);
  }

  lookup(path: string, name: string): Binding | undefined {
    return this.#models.get(path)?.scope.get(name);
  }

  diagnostics(): readonly Diagnostic[] {
    return this.paths().flatMap((p) => this.#models.get(p)?.diagnostics ?? []);
  }
}

/** Loads the pack's parser and include rules for `version` and opens the project. Rejects for an unknown version. */
export async function openProject(
  version: string,
  files: Iterable<ProjectFile>,
  options: {
    trace?: (event: ModelEvent) => void;
    packs?: readonly LanguagePack[];
  } = {},
): Promise<ProjectModel> {
  const packs = options.packs ?? installedPacks;
  const pack = packs.find((p) => p.version === version);
  if (!pack) throw new Error(`No language pack for ${version}`);
  const parser = await loadParser(version, packs);
  return new ProjectModel(files, {
    parser,
    includes: pack.includes,
    ...(options.trace ? { trace: options.trace } : {}),
  });
}
