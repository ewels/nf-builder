import type { JSX } from "react";

export function PreviewBadge(): JSX.Element {
  return (
    <span
      className="badge badge-preview"
      title="Preview feature: it may change in a later Nextflow release"
    >
      preview
    </span>
  );
}
