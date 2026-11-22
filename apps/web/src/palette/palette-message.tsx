import type { JSX, ReactNode } from "react";

export function PaletteMessage({
  tone = "status",
  children,
}: {
  readonly tone?: "status" | "error";
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <p
      className={`palette-message${tone === "error" ? " is-error" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
