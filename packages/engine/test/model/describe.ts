import type { IncludeRules, SourceParser } from "@nf-builder/lang-core";
import {
  type FileModel,
  modelFile,
  type ParsedFile,
  parseFile,
} from "../../src/model/file-model";
import { FileTree } from "../../src/model/tree";
import type { TreeFile } from "./read-tree";

/** Models every file of a project from scratch. */
export function modelAll(
  files: readonly TreeFile[],
  parser: SourceParser,
  rules: IncludeRules,
): Map<string, FileModel> {
  const parsed = new Map<string, ParsedFile>();
  for (const f of files)
    parsed.set(f.path, parseFile(f.path, f.text, parser, rules));
  const tree = new FileTree(parsed.keys());
  const models = new Map<string, FileModel>();
  for (const p of [...parsed.keys()].sort()) {
    const file = parsed.get(p) as ParsedFile;
    models.set(p, modelFile(file, tree, (q) => parsed.get(q), rules).model);
  }
  return models;
}

const at = (node: { kind: string; range: { line: number; column: number } }) =>
  `${node.kind}@${node.range.line}:${node.range.column}`;

/** A JSON summary of a model, for comparisons and snapshots. */
export function describeModel(model: FileModel): unknown {
  return {
    path: model.path,
    status: model.source.status,
    declarations: [...model.declarations].map(
      ([name, d]) =>
        `${name}=${at(d.declaration)}${d.pipeline ? " pipeline" : ""}`,
    ),
    includes: model.includes.map((i) => ({
      node: at(i.node),
      target: i.target,
      entries:
        i.kind === "script"
          ? i.entries.map((e) => ({
              name: e.entry.name.name,
              alias: e.entry.alias?.name ?? null,
              declaration: e.declaration ? at(e.declaration) : null,
              pipeline: e.pipeline,
            }))
          : undefined,
    })),
    scope: [...model.scope].map(([name, b]) =>
      b.kind === "declaration"
        ? `${name}: declaration ${at(b.declaration)}`
        : `${name}: include ${b.entry.entry.name.name} ${b.entry.declaration ? at(b.entry.declaration) : "-"}`,
    ),
    diagnostics: model.diagnostics.map(
      (d) => `${d.code} ${d.range.line}:${d.range.column} ${d.message}`,
    ),
  };
}
