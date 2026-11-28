import type { JSX } from "react";

/** The Markdown preview pane of a file tab (F-605, FI-30). A placeholder until the preview lands. */
export function MarkdownPane({ path }: { readonly path: string }): JSX.Element {
  return (
    <section
      className="markdown-pane"
      data-preview-state="loading"
      aria-label={`Preview of ${path}`}
    />
  );
}
