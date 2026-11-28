// The note that editing needs a larger screen (F-703, UX-04). Its container is always mounted so that a crossing is
// announced politely (role status); the text is rendered only while read-only.
import { type JSX, type Ref, useEffect, useRef } from "react";
import { READ_ONLY_TEXT, useReadOnly } from "./read-only-store";

interface ReadOnlyNoteViewProps {
  readonly readOnly: boolean;
  readonly noteRef?: Ref<HTMLParagraphElement>;
}

export function ReadOnlyNoteView({
  readOnly,
  noteRef,
}: ReadOnlyNoteViewProps): JSX.Element {
  return (
    <div className="read-only-note" role="status">
      {readOnly ? (
        <p ref={noteRef} tabIndex={-1}>
          {READ_ONLY_TEXT}
        </p>
      ) : null}
    </div>
  );
}

/** Connected: when the mode turns read-only and the focused control was removed, focus moves to the note (QA-10). */
export function ReadOnlyNote(): JSX.Element {
  const readOnly = useReadOnly();
  const note = useRef<HTMLParagraphElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // not on the first render: a page that loads read-only keeps its natural focus order
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly && document.activeElement === document.body)
      note.current?.focus();
  }, [readOnly]);
  return <ReadOnlyNoteView readOnly={readOnly} noteRef={note} />;
}
