// The canvas of one workflow, in a lazily loaded chunk (F-205, QA-01, ADR 0003): React Flow stays out of the initial JS.
import { canvasView, type Projection } from "@nf-builder/engine";
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  type OnNodesChange,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type JSX, type MouseEvent, useEffect, useMemo, useState } from "react";
import "./canvas.css";
import { NODE_TYPES } from "./canvas-nodes";
import { EDGE_TYPES } from "./flow-edge";
import {
  type CanvasFlowEdge,
  type CanvasFlowNode,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";

/** Sentence-case labels with no delete wording (nodes can't be deleted yet) and none that offers to select an edge (edges aren't selectable). */
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
    "A channel between two nodes; hover to see its type.",
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
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}

function CanvasInner({
  projection,
  portLabels,
  onPortLabelsChange,
  selected,
  onSelect,
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
  const [nodes, setNodes, applyNodeChanges] = useNodesState(initialNodes);
  // a new view replaces the nodes, so they are measured and the view fitted again (F-205)
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  // the selection (held in the store) is applied apart from that, so it keeps the sizes and the viewport;
  // it also runs after each new view, which has replaced the nodes unselected
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialNodes re-applies the selection to the new nodes
  useEffect(
    () =>
      setNodes((current) =>
        current.map((n) =>
          n.selected === (n.id === selected)
            ? n
            : { ...n, selected: n.id === selected },
        ),
      ),
    [initialNodes, selected, setNodes],
  );
  // selection is the store's: only React Flow's keyboard select and deselect are forwarded (single select, UX-30)
  const onNodesChange: OnNodesChange<CanvasFlowNode> = (changes) => {
    const picks = changes.getByType("select");
    const chosen = picks.find((c) => c.selected);
    if (chosen !== undefined) onSelect(chosen.id);
    else if (picks.some((c) => c.id === selected)) onSelect(null);
    for (const pick of picks) changes.remove(pick);
    applyNodeChanges(changes);
  };
  const edges = useMemo(() => toFlowEdges(view, selected), [view, selected]);
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
  return (
    <div
      className="workflow-canvas"
      data-canvas-state={ready ? "ready" : "loading"}
    >
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        elevateEdgesOnSelect={false}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        forceColorMode="light"
        fitView
        fitViewOptions={FIT}
        nodesDraggable={false}
        nodesConnectable={false}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        onNodeClick={(_event, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
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
