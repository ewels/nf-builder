// The tooltip of a hovered edge, at the pointer and outside the zoomed viewport so it stays readable (UX-24).
import type { CSSProperties, JSX } from "react";

export interface EdgeTooltipState {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export function EdgeTooltip({
  tooltip,
}: {
  readonly tooltip: EdgeTooltipState | null;
}): JSX.Element | null {
  if (tooltip === null) return null;
  const style: CSSProperties = { left: tooltip.x + 12, top: tooltip.y + 12 };
  return (
    <div role="tooltip" className="edge-tooltip" style={style}>
      {tooltip.text}
    </div>
  );
}
