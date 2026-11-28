import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import type { JSX } from "react";
import type { CanvasFlowEdge } from "./flow-elements";

export function FlowEdge(props: EdgeProps<CanvasFlowEdge>): JSX.Element {
  const [path, labelX, labelY] = getBezierPath(props);
  const { data } = props;
  const classes = [
    `edge-${data?.dataflow ?? "unknown"}`,
    data?.highlighted === true ? "is-highlighted" : "",
    data?.selected === true ? "is-selected" : "",
    data?.mismatch != null ? "is-mismatch" : "",
  ].filter((c) => c !== "");
  return (
    <>
      <BaseEdge id={props.id} path={path} className={classes.join(" ")} />
      {data?.mismatch == null ? null : (
        // a second cue besides the colour (QA-12): an error mark at the midpoint
        <EdgeLabelRenderer>
          <span
            className="edge-mismatch-glyph"
            aria-hidden="true"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            !
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const EDGE_TYPES = { flow: FlowEdge } as const;
