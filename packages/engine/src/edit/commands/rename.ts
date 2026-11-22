import {
  type AstNode,
  type RenameDeclaration,
  type ScriptSourceFile,
  type TextEdit,
  type TextPatch,
  walk,
} from "@nf-builder/lang-core";
import type { EditState } from "../apply";
import { isIdentifier } from "../names";
import { EditRefusal } from "../refusal";

const RENAMEABLE = new Set([
  "Process",
  "Workflow",
  "Function",
  "Record",
  "Enum",
  "Agent",
]);

/** Where `name` is used as a bare reference: implicit-receiver calls, variables and the start of type names. */
function referenceEdits(
  file: ScriptSourceFile,
  name: string,
  newName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const at = (start: number, length: number) =>
    edits.push({ start, end: start + length, text: newName });
  for (const item of file.ast?.body ?? []) {
    if (item.kind === "Unparsed") continue;
    walk(item as AstNode, (node) => {
      const n = node as unknown as Record<string, unknown>;
      if (node.kind === "MethodCall" && n.receiver === null) {
        const method = n.method as AstNode & { name?: string };
        if (method.kind === "Identifier" && method.name === name)
          at(method.range.start, name.length);
      } else if (node.kind === "Variable" && n.name === name) {
        at(node.range.start, name.length);
      } else if (node.kind === "TypeRef") {
        const written = n.name as string;
        if (written === name || written.startsWith(`${name}.`))
          at(node.range.start, name.length);
      }
      return undefined;
    });
  }
  return edits;
}

/** Renames a declaration, its references in the declaring file, and the entries and unaliased references in includers. */
export function renameDeclaration(
  state: EditState,
  command: RenameDeclaration,
): TextPatch[] {
  const { path, name, newName } = command;
  const { model } = state;
  const declaring = model.file(path);
  if (declaring?.source.language !== "nextflow")
    throw new EditRefusal("not-found", `There is no script ${path}.`, path);
  const found = declaring.declarations.get(name);
  if (!found)
    throw new EditRefusal(
      "not-found",
      `${path} doesn't declare ${name}.`,
      path,
    );
  const declaration = found.declaration;
  if (declaration.kind === "Unparsed")
    throw new EditRefusal(
      "invalid",
      `${name} has code that doesn't parse. Fix it in the Code tab before renaming it.`,
      path,
    );
  if (
    !RENAMEABLE.has(declaration.kind) ||
    !("name" in declaration) ||
    declaration.name === null
  )
    throw new EditRefusal("invalid", `${name} can't be renamed.`, path);
  if (!isIdentifier(newName))
    throw new EditRefusal(
      "invalid",
      `"${newName}" isn't a valid name. Use letters, digits and underscores, starting with a letter or underscore.`,
    );
  if (newName === name)
    throw new EditRefusal("invalid", `${name} already has that name.`, path);
  if (declaring.declarations.has(newName) || declaring.scope.has(newName))
    throw new EditRefusal(
      "invalid",
      `${path} already has a ${newName}. Pick another name.`,
      path,
    );

  const edits = new Map<string, TextEdit[]>();
  const add = (file: string, list: TextEdit[]) =>
    edits.set(file, [...(edits.get(file) ?? []), ...list]);
  add(path, [
    {
      start: declaration.name.range.start,
      end: declaration.name.range.end,
      text: newName,
    },
    ...referenceEdits(declaring.source as ScriptSourceFile, name, newName),
  ]);

  for (const dependant of model.dependants(path)) {
    const file = model.file(dependant);
    if (file?.source.language !== "nextflow") continue;
    let unaliased = false;
    const entryEdits: TextEdit[] = [];
    for (const include of file.includes) {
      if (include.kind !== "script") continue;
      if (include.target.kind !== "file" || include.target.path !== path)
        continue;
      for (const { entry } of include.entries) {
        if (entry.name.name !== name) continue;
        entryEdits.push({
          start: entry.name.range.start,
          end: entry.name.range.end,
          text: newName,
        });
        if (entry.alias === null) unaliased = true;
      }
    }
    if (entryEdits.length === 0) continue;
    if (
      unaliased &&
      (file.declarations.has(newName) || file.scope.has(newName))
    )
      throw new EditRefusal(
        "invalid",
        `${dependant} already has a ${newName}. Pick another name.`,
        dependant,
      );
    add(dependant, [
      ...entryEdits,
      ...(unaliased
        ? referenceEdits(file.source as ScriptSourceFile, name, newName)
        : []),
    ]);
  }

  return [...edits].map(([file, list]) => {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    return {
      kind: "edit",
      path: file,
      edits: sorted.filter(
        (e, i) => i === 0 || e.start !== sorted[i - 1]?.start,
      ),
    };
  });
}
