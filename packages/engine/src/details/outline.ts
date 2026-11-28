// The outline of a Nextflow file's declarations (F-605, FI-31): names and ranges, never text, so it can cross from the
// worker (AR-30). Details are capped at 80 characters.
import type { SourceFile } from "@nf-builder/lang-core";
import { type TopLevelItem, topLevelItems } from "../source/items";
import type { OutlineItem, OutlineKind } from "./types";

const CAP = 80;

const cap = (text: string): string =>
  text.length > CAP ? `${text.slice(0, CAP - 1)}…` : text;

/** The declarations and top-level statements of a script in source order; null unless the file is a Nextflow script. */
export function fileOutline(file: SourceFile): readonly OutlineItem[] | null {
  if (file.language !== "nextflow") return null;
  return topLevelItems(file).map((item) => outlineItem(file.text, item));
}

function outlineItem(text: string, item: TopLevelItem): OutlineItem {
  const slice = (range: { start: number; end: number }) =>
    text.slice(range.start, range.end);
  const make = (kind: OutlineKind, name: string, detail = ""): OutlineItem => ({
    kind,
    name: cap(name),
    detail: cap(detail),
    line: item.range.line,
    range: { start: item.range.start, end: item.range.end },
  });
  switch (item.kind) {
    case "FeatureFlag":
      return make("featureFlag", item.name.name, slice(item.value.range));
    case "Include":
      return make(
        "include",
        item.entries
          .map((e) =>
            e.alias === null
              ? e.name.name
              : `${e.name.name} as ${e.alias.name}`,
          )
          .join(", "),
        item.source.value,
      );
    case "Import":
      return make("import", item.name);
    case "ParamsBlock":
      return make(
        "params",
        "params",
        item.params.map((p) => p.name.name).join(", "),
      );
    case "LegacyParam":
      return make("legacyParam", slice(item.target.range));
    case "Record":
      return make(
        "record",
        item.name.name,
        item.fields.map(fieldName).join(", "),
      );
    case "Enum":
      return make(
        "enum",
        item.name.name,
        item.constants.map((c) => c.name).join(", "),
      );
    case "Process":
      return make("process", item.name.name);
    case "Agent":
      return make("agent", item.name.name);
    case "Workflow":
      return make("workflow", item.name === null ? "(entry)" : item.name.name);
    case "OutputBlock":
      return make(
        "output",
        "output",
        item.outputs.map((o) => o.name.name).join(", "),
      );
    case "Function":
      return make(
        "function",
        item.name.name,
        text.slice(item.name.range.end, item.body.range.start).trim(),
      );
    case "Unparsed":
      return make(
        "unparsed",
        item.head === null
          ? firstLine(slice(item.range))
          : `${item.head.keyword}${item.head.name === null ? "" : ` ${item.head.name}`}`,
      );
    case "InvalidDeclaration":
      return make("unparsed", item.keyword);
    case "IncompleteDeclaration":
      return make("unparsed", firstLine(item.text));
    default:
      return make("statement", firstLine(slice(item.range)));
  }
}

const fieldName = (field: { readonly name: { readonly name: string } }) =>
  field.name.name;

const firstLine = (text: string): string =>
  text.split("\n", 1)[0]?.trim() ?? "";
