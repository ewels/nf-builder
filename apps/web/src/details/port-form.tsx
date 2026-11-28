import type { JSX, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * The inline form that adds a take or an emit to a workflow (F-307, UX-51). Enter submits, Escape cancels; focus goes to
 * the name field and returns to the control that opened it when the form goes (UX-70). `onSubmit` resolves to the
 * refusal's message, or null once the port is added.
 */
export function PortForm({
  role,
  typed,
  onSubmit,
  onCancel,
}: {
  readonly role: "take" | "emit";
  readonly typed: boolean;
  readonly onSubmit: (
    name: string,
    type: string | null,
  ) => Promise<string | null>;
  readonly onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    return () => opener?.focus?.();
  }, [opener]);
  const cancel = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    <form
      className="port-form"
      aria-label={`Add ${role}`}
      onKeyDown={cancel}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(name.trim(), typed ? type.trim() : null).then(setProblem);
      }}
    >
      <label>
        Name
        <input
          ref={first}
          type="text"
          value={name}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {typed ? (
        <label>
          Type
          <input
            type="text"
            value={type}
            placeholder="Channel<Path>"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setType(e.target.value)}
          />
        </label>
      ) : null}
      <div className="port-form-actions">
        <button type="submit">Add</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {problem === null ? null : <p role="alert">{problem}</p>}
    </form>
  );
}
