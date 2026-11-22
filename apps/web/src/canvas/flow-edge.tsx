import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { JSX } from "react";
import type { CanvasFlowEdge } from "./flow-elements";

export function FlowEdge(props: EdgeProps<CanvasFlowEdge>): JSX.Element {
  const [path] = getBezierPath(props);
  return (
    <BaseEdge
      id={props.id}
      path={path}
      className={`edge-${props.data?.dataflow ?? "unknown"}`}
    />
  );
}

export const EDGE_TYPES = { flow: FlowEdge } as const;
