import type { JSX, ReactNode } from "react";
import { type Side, useLayout } from "../layout/layout-store";
import { ChevronIcon } from "./icons";

export interface SideColumnProps {
  readonly side: Side;
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly children?: ReactNode;
}

export function SideColumn({
  side,
  id,
  label,
  title,
  children,
}: SideColumnProps): JSX.Element {
  const collapsed = useLayout((s) => s[side].collapsed);
  const toggle = useLayout((s) => s.toggleCollapsed);
  const name = `${collapsed ? "Expand" : "Collapse"} ${label.toLowerCase()}`;
  // The chevron points where the column will move: collapsing the left column points left.
  const direction = (side === "left") === !collapsed ? "left" : "right";
  return (
    <aside
      id={id}
      aria-label={label}
      className={`column column-${side}${collapsed ? " is-collapsed" : ""}`}
    >
      <div className="column-header">
        {collapsed ? null : <h2 className="column-title">{title}</h2>}
        <button
          type="button"
          id={`${id}-toggle`}
          className="icon-button"
          aria-expanded={!collapsed}
          aria-controls={`${id}-body`}
          aria-label={name}
          title={name}
          onClick={() => toggle(side)}
        >
          <ChevronIcon direction={direction} />
        </button>
      </div>
      <div id={`${id}-body`} className="column-body" hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
