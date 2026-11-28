// The text of the rows that changed, as one synthetic script the pack parses (F-303, UX-41, UX-44). Unchanged rows keep
// their original nodes, so only edited text goes through the parser; each line is mapped back to the field it came from.
import type {
  DirectiveRow,
  FormField,
  FormSection,
  InputRow,
  OutputRow,
  StageRow,
  TopicRow,
  TypedProcessForm,
} from "@nf-builder/lang-core";

type Rows = {
  readonly directives: readonly DirectiveRow[];
  readonly inputs: readonly InputRow[];
  readonly stage: readonly StageRow[];
  readonly outputs: readonly OutputRow[];
  readonly topics: readonly TopicRow[];
};
type ListSection = keyof Rows;

/** The placeholder name of the synthetic process. */
export const FORM_PROCESS = "__NF_BUILDER_FORM__";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Which rows of each list changed against the original form, by row index; and whether the script and stub did. */
export interface RowChanges {
  readonly rows: Readonly<Record<ListSection, readonly boolean[]>>;
  readonly script: boolean;
  readonly stub: boolean;
}

export function rowChanges(
  original: TypedProcessForm,
  form: TypedProcessForm,
): RowChanges {
  const sections: ListSection[] = [
    "directives",
    "inputs",
    "stage",
    "outputs",
    "topics",
  ];
  const rows = Object.fromEntries(
    sections.map((section) => [
      section,
      (
        form[section] as readonly { origin: number | null; kind?: string }[]
      ).map((row) => {
        if (row.origin === null) return true;
        // a code row is kept as written whatever the form says
        if (row.kind === "code") return false;
        const before = (
          original[section] as readonly { origin: number | null }[]
        ).find((r) => r.origin === row.origin);
        return !same(row, before);
      }),
    ]),
  ) as unknown as RowChanges["rows"];
  return {
    rows,
    script: !same(form.script, original.script),
    stub: !same(form.stub, original.stub),
  };
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((l) => (l === "" ? l : `    ${l}`))
    .join("\n");

const quote = (text: string): string =>
  `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const rowText = {
  directives: (r: DirectiveRow) =>
    r.kind === "named" ? `${r.name} ${r.args}` : r.text,
  inputs: (r: InputRow) =>
    r.kind === "named"
      ? `${r.name}: ${r.type}${r.nullable ? "?" : ""}`
      : r.text,
  stage: (r: StageRow) => `${r.directive} ${r.args}`,
  outputs: (r: OutputRow) =>
    r.name === ""
      ? r.value
      : `${r.name}${r.type === "" ? "" : `: ${r.type}`} = ${r.value}`,
  topics: (r: TopicRow) =>
    r.kind === "emit" ? `${r.value} >> ${quote(r.topic)}` : r.text,
} as const;

const LABELS: Record<Exclude<ListSection, "directives">, string> = {
  inputs: "input:",
  stage: "stage:",
  outputs: "output:",
  topics: "topic:",
};

/**
 * The synthetic script holding the changed rows, and the field each of its lines came from (1-based line numbers).
 * Sections without a changed row are left out; the script section is always present, as a placeholder when unchanged.
 */
export function formSource(
  form: TypedProcessForm,
  changes: RowChanges,
): { text: string; lines: Map<number, FormField> } {
  const out: string[] = [
    "nextflow.enable.types = true",
    "",
    `process ${FORM_PROCESS} {`,
  ];
  const lines = new Map<number, FormField>();
  const add = (text: string, field: FormField | null) => {
    for (const line of text.split("\n")) {
      out.push(line);
      if (field) lines.set(out.length, field);
    }
  };
  const list = <S extends ListSection>(
    section: S,
    label: string | null,
  ): void => {
    const picked = (form[section] as readonly unknown[])
      .map((row, index) => ({ row, index }))
      .filter(({ index }) => changes.rows[section][index]);
    if (picked.length === 0) return;
    if (label) add(`    ${label}`, null);
    for (const { row, index } of picked)
      add(indent((rowText[section] as (r: unknown) => string)(row)), {
        section: section as FormSection,
        row: index,
        part: null,
      });
    if (label) add("", null);
  };
  list("directives", null);
  if (changes.rows.directives.some(Boolean)) add("", null);
  list("inputs", LABELS.inputs);
  list("stage", LABELS.stage);
  list("outputs", LABELS.outputs);
  list("topics", LABELS.topics);
  add(`    ${form.script.label}:`, null);
  add(
    changes.script ? indent(form.script.text) : "    ''",
    changes.script ? { section: "script", row: null, part: "text" } : null,
  );
  if (changes.stub && form.stub !== null) {
    add("", null);
    add("    stub:", null);
    add(indent(form.stub), { section: "stub", row: null, part: "text" });
  }
  out.push("}", "");
  return { text: out.join("\n"), lines };
}
