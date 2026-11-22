import type { JSX, ReactNode } from "react";
import { type Side, useLayout } from "../layout/layout-store";
import { ChevronIcon } from "./icons";

interface SideColumnProps {
  readonly side: Side;
  readonly label: string;
  readonly title: string;
  /** Replaces the title; hidden while collapsed. */
  readonly header?: ReactNode;
  readonly children?: ReactNode;
}

export function SideColumn({
  side,
  label,
  title,
  header,
  children,
}: SideColumnProps): JSX.Element {
  const id = `column-${side}`;
  const collapsed = useLayout((s) => s[side].collapsed);
  const toggle = useLayout((s) => s.toggleCollapsed);
  const name = `${collapsed ? "Expand" : "Collapse"} ${label.toLowerCase()}`;
  // The chevron points where the column will move: collapsing the left column points left.
  const direction = collapsed ? (side === "left" ? "right" : "left") : side;
  return (
    <aside
      id={id}
      aria-label={label}
      className={`column column-${side}${collapsed ? " is-collapsed" : ""}`}
    >
      <div className="column-header">
        {collapsed
          ? null
          : (header ?? <h2 className="column-title">{title}</h2>)}
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
