import type { JSX } from "react";

export function PaletteSearch({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <search className="palette-search">
      <input
        type="search"
        aria-label="Search components"
        placeholder="Search components and modules"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onChange("");
          }
        }}
      />
    </search>
  );
}
