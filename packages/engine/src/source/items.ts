import type { ConfigItem, ScriptItem, SourceFile } from "@nf-builder/lang-core";

export type TopLevelItem = ScriptItem | ConfigItem;

/** The top-level items of a file's AST, in source order; none when the file has no AST. */
export function topLevelItems(file: SourceFile): readonly TopLevelItem[] {
  if (file.ast === null) return [];
  return file.ast.kind === "Script" ? file.ast.body : file.ast.statements;
}
