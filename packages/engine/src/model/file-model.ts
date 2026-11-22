// The per-file semantic model (AR-03, F-105): includes resolved to project files, entries bound to the declarations
// they name, and the script's top-level scope. Pure functions of the file, the tree and the targets' parsed files.
import {
  type AstNode,
  type ConfigInclude,
  type Diagnostic,
  type Includable,
  type IncludableDeclaration,
  type Include,
  type IncludeEntry,
  type IncludeRules,
  type IncludeTarget,
  type ProjectTree,
  type SourceFile,
  type SourceParser,
  walk,
} from "@nf-builder/lang-core";
import { createSourceFile } from "../source/source-file";
import { recordingTree, type Watch } from "./tree";

/** A parsed file and the names it can be included by. Depends on the text alone. */
export interface ParsedFile {
  readonly source: SourceFile;
  readonly declarations: ReadonlyMap<string, Includable>;
}

export function parseFile(
  path: string,
  text: string,
  parser: SourceParser,
  rules: IncludeRules,
): ParsedFile {
  const source = createSourceFile(path, text, parser);
  const declarations =
    source.language === "nextflow" && source.ast
      ? rules.includable(source.ast)
      : new Map<string, Includable>();
  return { source, declarations };
}

export interface ResolvedEntry {
  readonly entry: IncludeEntry;
  /** Null when the target is missing, a plugin, or does not define the name. */
  readonly declaration: IncludableDeclaration | null;
  /** The entry names a pipeline (the entry workflow or the params block). */
  readonly pipeline: boolean;
}
export interface ScriptIncludeModel {
  readonly kind: "script";
  readonly node: Include;
  readonly target: IncludeTarget;
  readonly entries: readonly ResolvedEntry[];
}
export interface ConfigIncludeModel {
  readonly kind: "config";
  readonly node: ConfigInclude;
  readonly target: IncludeTarget;
}
export type ResolvedInclude = ScriptIncludeModel | ConfigIncludeModel;

export type Binding =
  | {
      readonly kind: "declaration";
      readonly declaration: IncludableDeclaration;
    }
  | {
      readonly kind: "include";
      readonly include: ScriptIncludeModel;
      readonly entry: ResolvedEntry;
    };

export interface FileModel {
  readonly path: string;
  readonly source: SourceFile;
  readonly declarations: ReadonlyMap<string, Includable>;
  readonly includes: readonly ResolvedInclude[];
  /** Top-level names: the file's own declarations, then include entries by alias or name; the first binding wins. */
  readonly scope: ReadonlyMap<string, Binding>;
  readonly diagnostics: readonly Diagnostic[];
}

/** Nextflow reports "could not be parsed" exactly when the grammar fails; builder-only errors still resolve. */
const parsedOk = (file: ParsedFile): boolean =>
  file.source.language === "nextflow" &&
  file.source.ast !== null &&
  file.source.problems.every((p) => p.source === "builder");

/**
 * Models one file. Reads the tree and the targets' `ParsedFile`s only through `tree` and `parsed`; `watch` lists every
 * path and directory it asked about, so a change to any of them is what makes this model stale.
 */
export function modelFile(
  file: ParsedFile,
  tree: ProjectTree,
  parsed: (path: string) => ParsedFile | undefined,
  rules: IncludeRules,
): { model: FileModel; watch: Watch } {
  const recorder = recordingTree(tree);
  const { source } = file;
  const path = source.path;
  const includes: ResolvedInclude[] = [];
  const diagnostics: Diagnostic[] = [];
  const diagnostic = (node: AstNode, code: string, message: string) =>
    diagnostics.push({
      path,
      range: node.range,
      severity: "error",
      message,
      code,
    });

  if (source.language === "nextflow" && source.ast) {
    for (const node of source.ast.body) {
      if (node.kind !== "Include") continue;
      const target = rules.scriptInclude(
        path,
        node.source.value,
        recorder.tree,
      );
      const targetFile =
        target.kind === "file" ? parsed(target.path) : undefined;
      const parsedTarget = targetFile !== undefined && parsedOk(targetFile);
      if (target.kind === "missing")
        diagnostic(node, "include-target", target.message);
      else if (target.kind === "file" && !parsedTarget)
        diagnostic(node, "include-not-parsed", rules.notParsed(target.path));
      const entries = node.entries.map((entry): ResolvedEntry => {
        const found = targetFile?.declarations.get(entry.name.name);
        // an item upstream turns into an InvalidDeclaration is not defined there, though it still binds by its head
        const invalid =
          found?.declaration.kind === "Unparsed" &&
          found.declaration.invalidDeclaration === true;
        if (target.kind === "file" && parsedTarget && (!found || invalid))
          diagnostic(
            node,
            "include-name",
            rules.notDefined(entry.name.name, target.path),
          );
        return {
          entry,
          declaration: found?.declaration ?? null,
          pipeline: found?.pipeline ?? false,
        };
      });
      includes.push({ kind: "script", node, target, entries });
    }
  } else if (source.language === "config" && source.ast) {
    walk(source.ast, (node) => {
      if (node.kind !== "ConfigInclude") return;
      const include = node as ConfigInclude;
      const target = rules.configInclude(path, include.source, recorder.tree);
      if (target.kind === "missing")
        diagnostic(include, "include-target", target.message);
      includes.push({ kind: "config", node: include, target });
      return false;
    });
  }

  const scope = new Map<string, Binding>();
  for (const [name, d] of file.declarations)
    if (!d.pipeline)
      scope.set(name, { kind: "declaration", declaration: d.declaration });
  for (const include of includes) {
    if (include.kind !== "script") continue;
    for (const entry of include.entries) {
      const name = (entry.entry.alias ?? entry.entry.name).name;
      if (!scope.has(name))
        scope.set(name, { kind: "include", include, entry });
    }
  }

  return {
    model: {
      path,
      source,
      declarations: file.declarations,
      includes,
      scope,
      diagnostics,
    },
    watch: recorder.watch,
  };
}
