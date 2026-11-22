import type {
  Catalogue,
  ConfigAst,
  LintBinding,
  LintContext,
  LintInclude,
  Projection,
} from "@nf-builder/lang-core";
import type { Binding } from "../model/file-model";
import type { ProjectModel } from "../model/project";
import type { Projector } from "../projection/project";

export interface LintContextOptions {
  model: ProjectModel;
  projector: Projector;
  catalogue: Catalogue;
  path: string;
}

/** Builds the context the pack's rules see for one file; null when the file has no AST (a verbatim or plain file). */
export function lintContext(options: LintContextOptions): LintContext | null {
  const { model, projector, catalogue, path } = options;
  const file = model.file(path);
  const source = file?.source;
  if (!file || !source) return null;
  if (source.language !== "nextflow" && source.language !== "config")
    return null;
  if (source.ast === null) return null;

  const typesOf = (target: string | null): boolean | null => {
    const other = target === null ? undefined : model.file(target)?.source;
    return other?.language === "nextflow" && other.ast
      ? other.ast.typesEnabled
      : null;
  };
  const binding = (found: Binding): LintBinding => {
    if (found.kind === "declaration")
      return {
        declaration: found.declaration,
        path,
        typesEnabled: typesOf(path),
        entry: null,
      };
    const { target } = found.include;
    const targetPath = target.kind === "file" ? target.path : null;
    return {
      declaration: found.entry.declaration,
      path: targetPath,
      typesEnabled: typesOf(targetPath),
      entry: found.entry.entry,
    };
  };

  const includes: LintInclude[] = [];
  for (const include of file.includes) {
    if (include.kind !== "script") continue;
    for (const resolved of include.entries)
      includes.push({
        include: include.node,
        entry: resolved.entry,
        target: include.target,
        binding: binding({ kind: "include", include, entry: resolved }),
        pipeline: resolved.pipeline,
      });
  }

  let projections: Projection[] | undefined;
  let configs: ConfigAst[] | undefined;
  return {
    file: source,
    catalogue,
    lookup: (name) => {
      const found = model.lookup(path, name);
      return found ? binding(found) : undefined;
    },
    includes,
    projections: () =>
      (projections ??= projector
        .workflows()
        .filter((w) => w.path === path && w.modelled)
        .flatMap((w) => projector.project(w.path, w.name) ?? [])),
    configs: () =>
      (configs ??= model.paths().flatMap((p) => {
        const other = model.file(p)?.source;
        return other?.language === "config" && other.ast ? [other.ast] : [];
      })),
  };
}
