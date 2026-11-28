import type { JSX } from "react";

export function PaletteHeading({
  version,
}: {
  readonly version: string;
}): JSX.Element {
  return (
    <h2 id="palette-heading" className="palette-heading">
      Nextflow language · {version}
    </h2>
  );
}
