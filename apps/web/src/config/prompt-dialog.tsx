// A small modal asking for a few values (F-601): the pattern of a selector, a profile's name, a plugin, a parameter.
// A refusal shows inline and the dialog stays open (QA-10, QA-11).
import {
  type FormEvent,
  type JSX,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useModal } from "../project/project-dialogs";

export interface PromptField {
  readonly name: string;
  readonly label: string;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly help?: string;
  readonly initial?: string;
}

function FieldInput({
  field,
  first,
  value,
  invalid,
  onChange,
}: {
  readonly field: PromptField;
  readonly first: boolean;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // the dialog opens to type its first value
  useEffect(() => {
    if (first) input.current?.focus();
  }, [first]);
  return (
    <div className="dialog-field">
      <label htmlFor={id}>{field.label}</label>
      {field.options === undefined ? (
        <input
          ref={input}
          id={id}
          type="text"
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {field.help === undefined ? null : (
        <span className="muted">{field.help}</span>
      )}
    </div>
  );
}

export function PromptDialog({
  title,
  submit,
  fields,
  check,
  onSubmit,
  onClose,
}: {
  readonly title: string;
  readonly submit: string;
  readonly fields: readonly PromptField[];
  /** The problem with these values, or null. */
  readonly check?: (values: Readonly<Record<string, string>>) => string | null;
  /** Applies them; the refusal's message, or null when applied. */
  readonly onSubmit: (
    values: Readonly<Record<string, string>>,
  ) => Promise<string | null>;
  readonly onClose: () => void;
}): JSX.Element {
  const modal = useModal(onClose);
  const titleId = useId();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      fields.map((f) => [f.name, f.initial ?? f.options?.[0]?.value ?? ""]),
    ),
  );
  const problem = modal.error;
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = check?.(values) ?? null;
    if (found !== null) {
      modal.setError(found);
      return;
    }
    await modal.run(async () => {
      const refused = await onSubmit(values);
      if (refused !== null) throw new Error(refused);
    });
  };
  return (
    <dialog
      ref={modal.ref}
      className="project-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <form onSubmit={send}>
        <h2 id={titleId}>{title}</h2>
        {fields.map((f, i) => (
          <FieldInput
            key={f.name}
            field={f}
            first={i === 0}
            value={values[f.name] ?? ""}
            invalid={problem !== null}
            onChange={(value) => {
              setValues({ ...values, [f.name]: value });
              modal.setError(null);
            }}
          />
        ))}
        {problem === null ? null : (
          <p className="dialog-error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" onClick={() => modal.ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={modal.busy}>
            {submit}
          </button>
        </div>
      </form>
    </dialog>
  );
}
