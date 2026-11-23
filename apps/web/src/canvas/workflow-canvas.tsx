// The canvas of one workflow, in a lazily loaded chunk (F-205, QA-01, ADR 0003): React Flow stays out of the initial JS.
import { canvasView, type Projection } from "@nf-builder/engine";
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type JSX,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./canvas.css";
import { NODE_TYPES } from "./canvas-nodes";
import { EDGE_TYPES } from "./flow-edge";
import { type CanvasFlowEdge, toFlowEdges, toFlowNodes } from "./flow-elements";
import { useRefitOnResize } from "./use-refit-on-resize";

/** Sentence-case labels with no delete wording (nodes can't be deleted yet). */
const CANVAS_ARIA_LABELS = {
  "node.a11yDescription.default": "Press enter or space to select this node.",
  "node.a11yDescription.keyboardDisabled":
    "Press enter or space to select this node.",
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) => `Moved selected node ${direction}. New position x ${x}, y ${y}`,
  "edge.a11yDescription.default":
    "Press enter or space to select this connection.",
  "controls.ariaLabel": "Canvas controls",
  "controls.zoomIn.ariaLabel": "Zoom in",
  "controls.zoomOut.ariaLabel": "Zoom out",
  "controls.fitView.ariaLabel": "Fit view",
  "minimap.ariaLabel": "Minimap",
  "handle.ariaLabel": "Connection point",
} as const;

const FIT = { maxZoom: 1 } as const;

interface WorkflowCanvasProps {
  readonly projection: Projection;
  readonly portLabels: boolean;
  readonly onPortLabelsChange: (value: boolean) => void;
}

function CanvasInner({
  projection,
  portLabels,
  onPortLabelsChange,
}: WorkflowCanvasProps): JSX.Element {
  const view = useMemo(
    () => canvasView(projection, { portLabels }),
    [projection, portLabels],
  );
  const initialNodes = useMemo(
    () => toFlowNodes(view, portLabels),
    [view, portLabels],
  );
  // controlled nodes: React Flow reports each node's measured size through onNodesChange
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  const edges = useMemo(() => toFlowEdges(view), [view]);
  // shown at the pointer, outside the zoomed viewport so it stays readable (UX-24)
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const showTooltip = (event: MouseEvent, edge: CanvasFlowEdge) => {
    setTooltip({
      text: edge.data?.tooltip ?? "",
      x: event.clientX,
      y: event.clientY,
    });
  };
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    void fitView(FIT).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialized, fitView]);
  const host = useRef<HTMLDivElement>(null);
  useRefitOnResize(host, FIT);
  return (
    <div
      ref={host}
      className="workflow-canvas"
      data-canvas-state={ready ? "ready" : "loading"}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        forceColorMode="light"
        fitView
        fitViewOptions={FIT}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={CANVAS_ARIA_LABELS}
        attributionPosition="bottom-center"
        onEdgeMouseEnter={showTooltip}
        onEdgeMouseMove={showTooltip}
        onEdgeMouseLeave={() => setTooltip(null)}
      >
        <Background />
        <Controls showInteractive={false} fitViewOptions={FIT}>
          <ControlButton
            onClick={() => onPortLabelsChange(!portLabels)}
            aria-pressed={portLabels}
            title="Port labels"
            aria-label="Port labels"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 4h3M7 4h7M2 8h3M7 8h7M2 12h3M7 12h7" />
            </svg>
          </ControlButton>
        </Controls>
        <MiniMap pannable zoomable />
      </ReactFlow>
      {tooltip === null ? null : (
        <div
          role="tooltip"
          className="edge-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export default function WorkflowCanvas(
  props: WorkflowCanvasProps,
): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
