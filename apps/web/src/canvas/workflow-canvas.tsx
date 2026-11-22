// The canvas of one workflow, in a lazily loaded chunk (F-205, QA-01, ADR 0003): React Flow stays out of the initial JS.
import { canvasView, type Projection } from "@nf-builder/engine";
import {
  Background,
  BackgroundVariant,
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
import { type JSX, useEffect, useMemo, useState } from "react";
import "./canvas.css";
import { NODE_TYPES } from "./canvas-nodes";
import { EDGE_TYPES } from "./flow-edge";
import { toFlowEdges, toFlowNodes } from "./flow-elements";

/** Sentence-case labels with no delete wording (nodes can't be deleted yet). */
export const CANVAS_ARIA_LABELS = {
  "node.a11yDescription.default":
    "Press enter or space to select this node. Use the arrow keys to move between nodes.",
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
  "controls.interactive.ariaLabel": "Toggle interactivity",
  "minimap.ariaLabel": "Minimap",
  "handle.ariaLabel": "Connection point",
} as const;

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
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    void Promise.resolve(fitView({ maxZoom: 1 })).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialized, fitView]);
  return (
    <div
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
        fitViewOptions={{ maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        ariaLabelConfig={CANVAS_ARIA_LABELS}
        attributionPosition="bottom-center"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} />
        <Controls showInteractive={false}>
          <ControlButton
            onClick={() => onPortLabelsChange(!portLabels)}
            aria-pressed={!portLabels}
            title={portLabels ? "Hide port labels" : "Show port labels"}
            aria-label={portLabels ? "Hide port labels" : "Show port labels"}
          >
            <span aria-hidden="true">P</span>
          </ControlButton>
        </Controls>
        <MiniMap ariaLabel="Minimap" pannable zoomable />
      </ReactFlow>
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
