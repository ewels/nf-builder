// The editing widget of one option value (F-601, FI-02, QA-11): a text field, a select, a text area or a fixed-key map,
// chosen by the value's kind. A field commits on Enter or blur when its text is valid and changed, and Escape reverts.
import {
  type ConfigValue,
  type ConfigValueKind,
  parseValueText,
  valueText,
} from "@nf-builder/engine";
import { type JSX, useEffect, useId, useState } from "react";

export type Decision =
  | { readonly action: "none" }
  | { readonly action: "clear" }
  | { readonly action: "commit"; readonly value: ConfigValue }
  | { readonly action: "invalid"; readonly message: string };

const textOf = (value: ConfigValue | null): string =>
  value === null ? "" : valueText(value);

/** What a draft means for a field currently holding `current`. */
export function decide(
  kind: ConfigValueKind,
  draft: string,
  current: ConfigValue | null,
): Decision {
  if (draft.trim() === "")
    return current === null ? { action: "none" } : { action: "clear" };
  const parsed = parseValueText(kind, draft);
  if (!parsed.ok) return { action: "invalid", message: parsed.message };
  if (textOf(current) === valueText(parsed.value)) return { action: "none" };
  return { action: "commit", value: parsed.value };
}

/** The keys of `process.resourceLimits`, a fixed-key map (the pack's form layout), with their kinds. */
const MAP_KEYS: readonly (readonly [string, ConfigValueKind])[] = [
  ["cpus", "integer"],
  ["memory", "memory"],
  ["disk", "memory"],
  ["time", "duration"],
];

interface FieldProps {
  readonly kind: ConfigValueKind;
  readonly value: ConfigValue | null;
  readonly id: string;
  readonly describedBy?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: ConfigValue) => Promise<unknown>;
  readonly onClear: () => Promise<unknown>;
}

/** The draft of a text widget: kept while the user is typing, dropped once the value moves or the edit is done. */
function useDraft(current: string) {
  const [draft, setDraft] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view moved on, so the draft is spent
  useEffect(() => setDraft(null), [current]);
  return [draft, setDraft] as const;
}

function TextField({
  kind,
  value,
  id,
  describedBy,
  disabled,
  onCommit,
  onClear,
  multiline,
}: FieldProps & { readonly multiline: boolean }): JSX.Element {
  const messageId = useId();
  const current = textOf(value);
  const [draft, setDraft] = useDraft(current);
  const [message, setMessage] = useState<string | null>(null);
  const shown = draft ?? current;
  const finish = async (): Promise<void> => {
    if (draft === null) return;
    const decision = decide(kind, draft, value);
    if (decision.action === "invalid") {
      setMessage(decision.message);
      return;
    }
    setMessage(null);
    if (decision.action === "none") {
      setDraft(null);
      return;
    }
    if (decision.action === "clear") await onClear();
    else await onCommit(decision.value);
    setDraft(null);
  };
  const describe = [describedBy, message === null ? null : messageId]
    .filter((s) => s !== null && s !== undefined)
    .join(" ");
  const common = {
    id,
    className: "config-row-value",
    value: shown,
    disabled,
    placeholder: "Not set",
    spellCheck: false,
    autoComplete: "off",
    "aria-invalid": message !== null,
    "aria-describedby": describe === "" ? undefined : describe,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>,
    ) => {
      setDraft(event.target.value);
      setMessage(null);
    },
    onBlur: () => void finish(),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(null);
        setMessage(null);
      } else if (
        event.key === "Enter" &&
        (!multiline || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        void finish();
      }
    },
  };
  return (
    <>
      {multiline ? <textarea rows={3} {...common} /> : <input {...common} />}
      {message === null ? null : (
        <span className="config-row-message" id={messageId} role="alert">
          {message}
        </span>
      )}
    </>
  );
}

function BooleanField({
  value,
  id,
  describedBy,
  disabled,
  onCommit,
  onClear,
}: FieldProps): JSX.Element {
  const current = value?.kind === "boolean" ? String(value.value) : "";
  return (
    <select
      id={id}
      className="config-row-value"
      value={current}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "") void onClear();
        else void onCommit({ kind: "boolean", value: next === "true" });
      }}
    >
      <option value="">Not set</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

/** A map of fixed keys (`process.resourceLimits`): one labelled field each, committed together as one value. */
function MapField({
  value,
  id,
  disabled,
  onCommit,
  onClear,
}: FieldProps): JSX.Element {
  const entries = value?.kind === "map" ? value.entries : [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const messageId = useId();
  const currentOf = (key: string): string => {
    const e = entries.find((x) => x.key === key);
    return e === undefined ? "" : valueText(e.value);
  };
  const signature = MAP_KEYS.map(([k]) => currentOf(k)).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view moved on, so the drafts are spent
  useEffect(() => setDrafts({}), [signature]);
  const finish = async (): Promise<void> => {
    if (Object.keys(drafts).length === 0) return;
    const next: { key: string; value: ConfigValue }[] = [];
    for (const [key, kind] of MAP_KEYS) {
      const text = drafts[key] ?? currentOf(key);
      if (text.trim() === "") continue;
      const parsed = parseValueText(kind, text);
      if (!parsed.ok) {
        setMessage(`${key}: ${parsed.message}`);
        return;
      }
      next.push({ key, value: parsed.value });
    }
    setMessage(null);
    if (next.length === 0) await onClear();
    else await onCommit({ kind: "map", entries: next });
    setDrafts({});
  };
  return (
    <fieldset
      className="config-map"
      id={id}
      disabled={disabled}
      aria-labelledby={`${id}-label`}
    >
      {MAP_KEYS.map(([key]) => (
        <label key={key} className="config-map-field">
          <span>{key}</span>
          <input
            className="config-row-value"
            value={drafts[key] ?? currentOf(key)}
            placeholder="Not set"
            spellCheck={false}
            aria-invalid={message?.startsWith(`${key}:`) === true}
            aria-describedby={message === null ? undefined : messageId}
            onChange={(event) => {
              setDrafts({ ...drafts, [key]: event.target.value });
              setMessage(null);
            }}
            onBlur={() => void finish()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDrafts({});
                setMessage(null);
              } else if (event.key === "Enter") {
                event.preventDefault();
                void finish();
              }
            }}
          />
        </label>
      ))}
      {message === null ? null : (
        <span className="config-row-message" id={messageId} role="alert">
          {message}
        </span>
      )}
    </fieldset>
  );
}

/** The widget for a kind. `code` has none: its rows show the code. */
export function ValueField(props: FieldProps): JSX.Element {
  switch (props.kind) {
    case "boolean":
      return <BooleanField {...props} />;
    case "map":
      return <MapField {...props} />;
    case "stringList":
      return <TextField {...props} multiline />;
    default:
      return <TextField {...props} multiline={false} />;
  }
}
