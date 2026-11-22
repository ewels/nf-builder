import { type JSX, type KeyboardEvent, type PointerEvent, useRef } from "react";
import { COLUMN_LIMITS, type Side, useLayout } from "../layout/layout-store";
import { dragWidth, separatorKeyAction } from "../layout/separator";

export interface ColumnSeparatorProps {
  readonly side: Side;
  readonly controls: string;
  readonly label: string;
}

const RESIZING_CLASS = "is-resizing";

export function ColumnSeparator({
  side,
  controls,
  label,
}: ColumnSeparatorProps): JSX.Element {
  const width = useLayout((s) => s[side].width);
  const setWidth = useLayout((s) => s.setWidth);
  const setCollapsed = useLayout((s) => s.setCollapsed);
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(
    undefined,
  );
  const { min, max } = COLUMN_LIMITS[side];

  const end = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    document.documentElement.classList.remove(RESIZING_CLASS);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const action = separatorKeyAction(side, event.key, width);
    if (!action) return;
    event.preventDefault();
    if (action.type === "resize") {
      setWidth(side, action.width);
      return;
    }
    setCollapsed(side, true);
    document.getElementById(`${controls}-toggle`)?.focus();
  };

  return (
    <hr
      className={`column-separator column-separator-${side}`}
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
        document.documentElement.classList.add(RESIZING_CLASS);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setWidth(
          side,
          dragWidth(
            side,
            drag.current.startWidth,
            drag.current.startX,
            event.clientX,
          ),
        );
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
