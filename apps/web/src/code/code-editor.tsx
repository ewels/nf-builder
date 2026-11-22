import type { JSX } from "react";

// A placeholder until the editor lands: F-208 task 3 replaces this module with the lazily loaded Monaco.
export default function CodeEditor({
  path,
}: {
  readonly path: string;
}): JSX.Element {
  return (
    <p className="muted" data-code-path={path}>
      The editor is not available yet.
    </p>
  );
}
