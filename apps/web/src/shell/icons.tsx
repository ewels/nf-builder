import type { JSX } from "react";

const CHEVRON_PATHS = {
  left: "M10 3 5 8l5 5",
  right: "M6 3l5 5-5 5",
  down: "M3 6l5 5 5-5",
} as const;

export function ChevronIcon({
  direction,
}: {
  readonly direction: "left" | "right" | "down";
}): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CHEVRON_PATHS[direction]} />
    </svg>
  );
}

export function CheckIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export function RefreshIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
    </svg>
  );
}
