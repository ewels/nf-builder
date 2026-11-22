import type {
  Catalogue,
  ConfigAst,
  IncludableDeclaration,
  IncludeTarget,
  LintBinding,
  LintContext,
  LintInclude,
  Projection,
} from "@nf-builder/lang-core";
import type { ProjectModel } from "../model/project";
import type { Projector } from "../projection/project";

/** Builds the context the pack's rules see for one file; null when the file has no AST (a verbatim or plain file). */
export function lintContext(options: {
  model: ProjectModel;
  projector: Projector;
  catalogue: Catalogue;
  path: string;
}): LintContext | null {
  const { model, projector, catalogue, path } = options;
  const file = model.file(path);
  const source = file?.source;
  if (!file || !source) return null;
  if (source.language !== "nextflow" && source.language !== "config")
    return null;
  if (source.ast === null) return null;

  /** `declaration`, declared in the file at `declaredIn`; types are known for a parsed script only. */
  const binding = (
    declaration: IncludableDeclaration | null,
    declaredIn: string | null,
  ): LintBinding => {
    const other =
      declaredIn === null ? undefined : model.file(declaredIn)?.source;
    return {
      declaration,
      typesEnabled:
        other?.language === "nextflow" && other.ast
          ? other.ast.typesEnabled
          : null,
    };
  };
  const fileOf = (target: IncludeTarget): string | null =>
    target.kind === "file" ? target.path : null;

  const includes: LintInclude[] = [];
  for (const include of file.includes) {
    if (include.kind !== "script") continue;
    for (const resolved of include.entries)
      includes.push({
        include: include.node,
        entry: resolved.entry,
        target: include.target,
        binding: binding(resolved.declaration, fileOf(include.target)),
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
      if (!found) return undefined;
      return found.kind === "declaration"
        ? binding(found.declaration, path)
        : binding(found.entry.declaration, fileOf(found.include.target));
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
