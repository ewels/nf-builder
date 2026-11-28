// ReplaceDeclaration (F-304, UX-43, UX-44, AR-21): the Code tab's text for one declaration, applied as written. It must
// parse alone as one typed process of the same name; calls follow changed inputs by input name (ADR 0039).
import type {
  ParseProblem,
  ReplaceDeclaration,
  ScriptSourceFile,
  TextPatch,
  TypedProcess,
} from "@nf-builder/lang-core";
import {
  declarationSource,
  flagPrefix,
  parseDeclarationText,
} from "../../form/declaration-text";
import { processForm } from "../../form/read-process";
import type { EditState } from "../apply";
import { EditRefusal } from "../refusal";
import { withEndings } from "../splice";
import { callSiteEdits, mergePatches } from "./update-declaration";

/** Where each input of `after` was in `before`: the input of the same name (a code row: the same text), else null. */
function inputOrigins(
  before: ReturnType<typeof processForm>,
  after: ReturnType<typeof processForm>,
): (number | null)[] {
  return after.inputs.map((row) => {
    const at = before.inputs.findIndex((b) =>
      row.kind === "named"
        ? b.kind === "named" && b.name === row.name
        : b.kind === "code" && b.text === row.text,
    );
    return at < 0 ? null : at;
  });
}

export function replaceDeclaration(
  state: EditState,
  command: ReplaceDeclaration,
): TextPatch[] {
  const { path, name, text } = command;
  const model = state.model.file(path);
  if (model?.source.language !== "nextflow")
    throw new EditRefusal("not-found", `There is no script ${path}.`, path);
  const found = model.declarations.get(name);
  if (!found)
    throw new EditRefusal(
      "not-found",
      `${path} doesn't declare ${name}.`,
      path,
    );
  const declaration = found.declaration;
  if (declaration.kind !== "Process" || !declaration.typed)
    throw new EditRefusal(
      "invalid",
      `${name} isn't a typed process, so the Code tab can't replace it.`,
      path,
    );
  const file = model.source as ScriptSourceFile;
  const span = declarationSource(file, declaration);
  const parsed = parseDeclarationText(
    state.parser,
    flagPrefix(file, declaration),
    text,
  );
  if (!parsed.ok) {
    // the problems are in the declaration's lines; put them in the file's
    const offset = file.text.slice(0, span.start).split("\n").length - 1;
    const problems: ParseProblem[] = parsed.problems.map((p) => ({
      ...p,
      line: p.line + offset,
      endLine: p.endLine + offset,
    }));
    throw new EditRefusal(
      "invalid",
      `${parsed.message}. Nothing was changed.`,
      path,
      problems,
    );
  }
  if (parsed.process.name.name !== name)
    throw new EditRefusal(
      "invalid",
      `The code names the process ${parsed.process.name.name}, not ${name}. Nothing was changed.`,
      path,
    );

  const written = withEndings(file, text);
  if (written === span.text) return [];
  const before = processForm(
    file,
    declaration as TypedProcess,
    state.catalogue,
  );
  const after = processForm(parsed.file, parsed.process, state.catalogue);
  return mergePatches([
    { path, edit: { start: span.start, end: span.end, text: written } },
    ...callSiteEdits(
      state,
      path,
      name,
      inputOrigins(before, after),
      declaration.inputs?.items.length ?? 0,
      new Map(),
    ),
  ]);
}
