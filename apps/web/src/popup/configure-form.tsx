// The Configure tab of the edit popup for a typed process (F-303, UX-41, UX-42): name, description, inputs, stage,
// outputs, topics, directives, script and stub, in that order. There is no kind control: node kinds are fixed (ADR 0008).
// Presentational: it edits the draft through `onChange` and knows nothing of the engine (AR-31).
import type {
  FieldProblem,
  FormChoices,
  TypedProcessForm,
} from "@nf-builder/engine";
import { type JSX, type ReactNode, useEffect, useId, useRef } from "react";
import { DirectivePicker } from "./directive-picker";
import { RowList } from "./row-list";

type Draft = TypedProcessForm;
export type DraftChange = (draft: Draft) => Draft;
type RowSection = "inputs" | "stage" | "outputs" | "topics" | "directives";

const fieldName = (
  section: string,
  row: number | null,
  part: string | null,
): string =>
  [section, row, part].filter((p) => p !== null && p !== "").join(".");

const withoutAt = <T,>(rows: readonly T[], i: number): T[] =>
  rows.filter((_, j) => j !== i);
const replaceAt = <T,>(rows: readonly T[], i: number, row: T): T[] =>
  rows.map((r, j) => (j === i ? row : r));
const moved = <T,>(rows: readonly T[], i: number, by: -1 | 1): T[] => {
  const next = [...rows];
  const other = next[i + by];
  const here = next[i];
  if (other === undefined || here === undefined) return next;
  next[i + by] = here;
  next[i] = other;
  return next;
};

export function ConfigureForm({
  draft,
  choices,
  fields,
  onChange,
  disabled = false,
}: {
  readonly draft: Draft;
  readonly choices: FormChoices;
  /** The fields a refusal is about; each is marked and the first focused. */
  readonly fields: readonly FieldProblem[];
  readonly onChange: (change: DraftChange) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const typesId = `${id}-types`;
  const stageId = `${id}-stage`;
  const problems = new Map(
    fields.map((p) => [
      fieldName(p.field.section, p.field.row, p.field.part),
      p.message,
    ]),
  );
  // the first problem gets the focus when a refusal arrives
  useEffect(() => {
    const first = fields[0];
    if (first === undefined) return;
    const name = fieldName(
      first.field.section,
      first.field.row,
      first.field.part,
    );
    root.current?.querySelector<HTMLElement>(`[data-field="${name}"]`)?.focus();
  }, [fields]);
  // a directive just added from the list gets the focus on its value
  const focusNext = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a row has been added
  useEffect(() => {
    const name = focusNext.current;
    focusNext.current = null;
    if (name !== null)
      root.current
        ?.querySelector<HTMLElement>(`[data-field="${name}"]`)
        ?.focus();
  }, [draft.directives.length]);

  /** The props every field shares: its name, its problem and the ids that tie the message to it. */
  const field = (
    section: string,
    row: number | null,
    part: string | null,
    label: string,
  ) => {
    const name = fieldName(section, row, part);
    const message = problems.get(name);
    const messageId = `${id}-msg-${name.replaceAll(".", "-")}`;
    return {
      props: {
        "data-field": name,
        "aria-label": label,
        "aria-invalid": message === undefined ? undefined : true,
        "aria-describedby": message === undefined ? undefined : messageId,
      } as const,
      message:
        message === undefined ? null : (
          <span id={messageId} className="popup-problem">
            {message}
          </span>
        ),
    };
  };
  const labelled = (
    label: string,
    f: ReturnType<typeof field>,
    input: ReactNode,
  ): JSX.Element => (
    <span className="popup-field">
      <span className="popup-field-label" aria-hidden="true">
        {label}
      </span>
      {input}
      {f.message}
    </span>
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange((d) => ({ ...d, [key]: value }));
  /** Replaces row `i` of a section of the draft. */
  const setRow = <K extends RowSection>(
    key: K,
    i: number,
    row: Draft[K][number],
  ) =>
    set(
      key,
      replaceAt(draft[key] as readonly Draft[K][number][], i, row) as Draft[K],
    );
  /** Adds a row at the end of a section of the draft. */
  const append = <K extends RowSection>(key: K, row: Draft[K][number]) =>
    onChange((d) => ({
      ...d,
      [key]: [...(d[key] as readonly Draft[K][number][]), row],
    }));
  const text = (
    section: string,
    row: number | null,
    part: string,
    label: string,
    value: string,
    update: (value: string) => void,
    extra: { list?: string; mono?: boolean } = {},
  ) => {
    const f = field(section, row, part, label);
    return labelled(
      label,
      f,
      <input
        {...f.props}
        type="text"
        value={value}
        list={extra.list}
        className={extra.mono ? "popup-mono" : undefined}
        spellCheck={false}
        onChange={(event) => update(event.target.value)}
      />,
    );
  };
  const area = (
    section: string,
    label: string,
    value: string,
    update: (value: string) => void,
    mono: boolean,
    rows: number,
  ) => {
    const f = field(section, null, null, label);
    return (
      <>
        <textarea
          {...f.props}
          rows={rows}
          value={value}
          className={mono ? "popup-mono" : undefined}
          spellCheck={mono ? false : undefined}
          onChange={(event) => update(event.target.value)}
        />
        {f.message}
      </>
    );
  };

  return (
    <div ref={root} className="configure-form">
      <datalist id={typesId}>
        {choices.types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id={stageId}>
        {choices.stage.map((s) => (
          <option key={s.name} value={s.name}>
            {s.hint}
          </option>
        ))}
      </datalist>
      {draft.kept.length > 0 ? (
        <p className="popup-note">Kept as written: {draft.kept.join(", ")}</p>
      ) : null}

      <fieldset className="popup-section" disabled={disabled}>
        <legend>Name</legend>
        {text("name", null, "", "Process name", draft.name, (v) =>
          set("name", v),
        )}
      </fieldset>
      <fieldset className="popup-section" disabled={disabled}>
        <legend>Description</legend>
        {area(
          "description",
          "Description",
          draft.description,
          (v) => set("description", v),
          false,
          2,
        )}
      </fieldset>

      <div className="popup-lists" aria-disabled={disabled || undefined}>
        <RowList
          legend="Inputs"
          noun="input"
          rows={draft.inputs}
          label={(row, i) =>
            row.kind === "named" ? row.name || `${i + 1}` : `${i + 1}`
          }
          code={(row) => (row.kind === "code" ? row.text : null)}
          onAdd={() =>
            append("inputs", {
              origin: null,
              kind: "named",
              name: "",
              type: "String",
              nullable: false,
            })
          }
          onRemove={(i) => set("inputs", withoutAt(draft.inputs, i))}
          onMove={(i, by) => set("inputs", moved(draft.inputs, i, by))}
          render={(row, i) =>
            row.kind !== "named" ? null : (
              <>
                {text("inputs", i, "name", "Input name", row.name, (v) =>
                  setRow("inputs", i, { ...row, name: v }),
                )}
                {text(
                  "inputs",
                  i,
                  "type",
                  "Input type",
                  row.type,
                  (v) => setRow("inputs", i, { ...row, type: v }),
                  { list: typesId },
                )}
                <label className="popup-check">
                  <input
                    type="checkbox"
                    checked={row.nullable}
                    onChange={(event) =>
                      setRow("inputs", i, {
                        ...row,
                        nullable: event.target.checked,
                      })
                    }
                  />
                  Nullable
                </label>
              </>
            )
          }
        />
        <RowList
          legend="Stage"
          noun="stage entry"
          rows={draft.stage}
          label={(row) => row.directive}
          code={() => null}
          onAdd={() =>
            append("stage", {
              origin: null,
              directive: choices.stage[0]?.name ?? "env",
              args: "",
            })
          }
          onRemove={(i) => set("stage", withoutAt(draft.stage, i))}
          render={(row, i) => (
            <>
              {text(
                "stage",
                i,
                "directive",
                "Stage directive",
                row.directive,
                (v) => setRow("stage", i, { ...row, directive: v }),
                { list: stageId },
              )}
              {text(
                "stage",
                i,
                "args",
                "Stage arguments",
                row.args,
                (v) => setRow("stage", i, { ...row, args: v }),
                { mono: true },
              )}
            </>
          )}
        />
        <RowList
          legend="Outputs"
          noun="output"
          rows={draft.outputs}
          label={(row, i) => row.name || `${i + 1}`}
          code={() => null}
          onAdd={() =>
            append("outputs", { origin: null, name: "", type: "", value: "" })
          }
          onRemove={(i) => set("outputs", withoutAt(draft.outputs, i))}
          onMove={(i, by) => set("outputs", moved(draft.outputs, i, by))}
          render={(row, i) => (
            <>
              {text("outputs", i, "name", "Output name", row.name, (v) =>
                setRow("outputs", i, { ...row, name: v }),
              )}
              {text(
                "outputs",
                i,
                "type",
                "Output type",
                row.type,
                (v) => setRow("outputs", i, { ...row, type: v }),
                { list: typesId },
              )}
              {text(
                "outputs",
                i,
                "value",
                "Output value",
                row.value,
                (v) => setRow("outputs", i, { ...row, value: v }),
                { mono: true },
              )}
            </>
          )}
        />
        <RowList
          legend="Topics"
          noun="topic"
          rows={draft.topics}
          label={(row, i) =>
            row.kind === "emit" ? row.topic || `${i + 1}` : `${i + 1}`
          }
          code={(row) => (row.kind === "code" ? row.text : null)}
          onAdd={() =>
            append("topics", {
              origin: null,
              kind: "emit",
              value: "",
              topic: "",
            })
          }
          onRemove={(i) => set("topics", withoutAt(draft.topics, i))}
          render={(row, i) =>
            row.kind !== "emit" ? null : (
              <>
                {text(
                  "topics",
                  i,
                  "value",
                  "Topic value",
                  row.value,
                  (v) => setRow("topics", i, { ...row, value: v }),
                  { mono: true },
                )}
                {text("topics", i, "topic", "Topic name", row.topic, (v) =>
                  setRow("topics", i, { ...row, topic: v }),
                )}
              </>
            )
          }
        />
        <RowList
          legend="Directives"
          noun="directive"
          rows={draft.directives}
          label={(row, i) => (row.kind === "named" ? row.name : `${i + 1}`)}
          code={(row) => (row.kind === "code" ? row.text : null)}
          onAdd={() => {
            const first = document.getElementById(`${id}-picker`);
            first?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
          }}
          addLabel="Choose a directive"
          onRemove={(i) => set("directives", withoutAt(draft.directives, i))}
          render={(row, i) =>
            row.kind !== "named" ? null : (
              <>
                <span className="popup-directive-name">
                  <code>{row.name}</code>
                  {row.deprecated ? (
                    <span className="popup-badge">Deprecated</span>
                  ) : null}
                </span>
                {text(
                  "directives",
                  i,
                  "args",
                  `Value of ${row.name}`,
                  row.args,
                  (v) => setRow("directives", i, { ...row, args: v }),
                  { mono: true },
                )}
              </>
            )
          }
        >
          <div id={`${id}-picker`}>
            <DirectivePicker
              choices={choices.directives}
              onPick={(choice) => {
                focusNext.current = fieldName(
                  "directives",
                  draft.directives.length,
                  "args",
                );
                append("directives", {
                  origin: null,
                  kind: "named",
                  name: choice.name,
                  args: choice.defaultArgs,
                  deprecated: false,
                  known: true,
                });
              }}
            />
          </div>
        </RowList>
      </div>

      <fieldset className="popup-section" disabled={disabled}>
        <legend>Script</legend>
        <p className="popup-note">{`The ${draft.script.label}: section`}</p>
        {area(
          "script",
          "Script",
          draft.script.text,
          (v) => set("script", { ...draft.script, text: v }),
          true,
          8,
        )}
      </fieldset>
      <fieldset className="popup-section" disabled={disabled}>
        <legend>Stub</legend>
        {draft.stub === null ? (
          <button
            type="button"
            className="popup-add"
            onClick={() => set("stub", "")}
          >
            Add stub
          </button>
        ) : (
          <>
            {area("stub", "Stub", draft.stub, (v) => set("stub", v), true, 4)}
            <button
              type="button"
              className="popup-add"
              onClick={() => set("stub", null)}
            >
              Remove stub
            </button>
          </>
        )}
      </fieldset>
    </div>
  );
}
