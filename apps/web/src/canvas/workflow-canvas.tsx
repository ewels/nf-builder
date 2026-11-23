// The canvas of one workflow, in a lazily loaded chunk (F-205, QA-01, ADR 0003): React Flow stays out of the initial JS.
import {
  canvasView,
  type Positions,
  type Projection,
  unplaced,
  withPositions,
} from "@nf-builder/engine";
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
import {
  type JSX,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./canvas.css";
import { runElk } from "../layout/elk-client";
import { autoLayout, placeMissing } from "../layout/layout-flow";
import { NODE_TYPES } from "./canvas-nodes";
import type { Placement } from "./canvas-store";
import { EDGE_TYPES } from "./flow-edge";
import {
  type CanvasFlowEdge,
  type CanvasFlowNode,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";
import { useRefitOnResize } from "./use-refit-on-resize";

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
  /** The stored positions, kept up to date by the store (F-207). */
  readonly positions: Positions;
  /** Layout messages to show, oldest problem first. */
  readonly notices: readonly string[];
  /** Nodes the user moved (drag stop or keyboard); the store rounds and saves them. */
  readonly onMove: (moves: Positions) => void;
  /** The result of a layout run on this canvas. */
  readonly onPlace: (placement: Placement) => void;
}

function CanvasInner({
  projection,
  portLabels,
  onPortLabelsChange,
  selected,
  onSelect,
  positions,
  notices,
  onMove,
  onPlace,
}: WorkflowCanvasProps): JSX.Element {
  const view = useMemo(
    () => canvasView(projection, { portLabels }),
    [projection, portLabels],
  );
  // nodes without a stored position are laid out by ELK; until then nothing is drawn, so the first fit has the final
  // positions (F-207)
  const waiting = useMemo(
    () => unplaced(view, positions).length > 0,
    [view, positions],
  );
  const latest = useRef({ positions, onPlace });
  latest.current = { positions, onPlace };
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    void placeMissing(projection, latest.current.positions, runElk).then(
      (r) => {
        if (!cancelled)
          latest.current.onPlace({
            positions: r.positions,
            saved: r.added,
            replace: false,
            notice: r.notice,
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projection, waiting]);
  // a new view replaces the nodes at the current positions; a move or a layout run changes positions in place below,
  // which keeps the measured sizes and the viewport
  const initialNodes = useMemo(
    () =>
      waiting
        ? []
        : toFlowNodes(
            withPositions(view, latest.current.positions),
            portLabels,
          ),
    [view, portLabels, waiting],
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
  useEffect(
    () =>
      setNodes((current) => {
        let changed = false;
        const next = current.map((n) => {
          const at = positions[n.id];
          if (
            at === undefined ||
            (at.x === n.position.x && at.y === n.position.y)
          )
            return n;
          changed = true;
          return { ...n, position: { x: at.x, y: at.y } };
        });
        return changed ? next : current;
      }),
    [positions, setNodes],
  );
  // selection is the store's: only React Flow's keyboard select and deselect are forwarded (single select, UX-30)
  const onNodesChange: OnNodesChange<CanvasFlowNode> = (changes) => {
    const picks = changes.getByType("select");
    const chosen = picks.find((c) => c.selected);
    if (chosen !== undefined) onSelect(chosen.id);
    else if (picks.some((c) => c.id === selected)) onSelect(null);
    for (const pick of picks) changes.remove(pick);
    applyNodeChanges(changes);
    // a drag stop and a keyboard move (not a drag in progress) are saved (F-207)
    const moves: Record<string, { x: number; y: number }> = {};
    for (const c of changes.getByType("position"))
      if (c.dragging !== true && c.position !== undefined)
        moves[c.id] = c.position;
    if (Object.keys(moves).length > 0) onMove(moves);
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
  const host = useRef<HTMLDivElement>(null);
  useRefitOnResize(host, FIT);
  // Auto-layout moves nodes in place, so the viewport is fitted again once React Flow has them
  const fitNext = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes is the trigger: it changes when the layout lands
  useEffect(() => {
    if (!fitNext.current) return;
    fitNext.current = false;
    void fitView(FIT);
  }, [nodes, fitView]);
  const chosen = nodes.filter((n) => n.selected).map((n) => n.id);
  const several = chosen.length >= 2;
  const runAutoLayout = async () => {
    try {
      const result = await autoLayout(
        projection,
        latest.current.positions,
        chosen,
        runElk,
      );
      const saved: Record<string, { x: number; y: number }> = {};
      for (const id of result.replace ? Object.keys(result.positions) : chosen)
        saved[id] = result.positions[id] as { x: number; y: number };
      fitNext.current = true;
      setNodes((current) =>
        current.map((n) => {
          const at = result.positions[n.id];
          return at === undefined
            ? n
            : { ...n, position: { x: at.x, y: at.y } };
        }),
      );
      onPlace({
        positions: result.positions,
        saved,
        replace: result.replace,
        notice: null,
      });
    } catch (error) {
      onPlace({
        positions: latest.current.positions,
        saved: {},
        replace: false,
        notice: `Auto-layout isn't available (${error instanceof Error ? error.message : String(error)}).`,
      });
    }
  };
  return (
    <div
      ref={host}
      className="workflow-canvas"
      data-canvas-state={ready ? "ready" : "loading"}
    >
      <div role="status" className="canvas-notices">
        {notices.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
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
        nodesDraggable
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
          <ControlButton
            onClick={() => void runAutoLayout()}
            title={
              several ? "Auto-layout selected nodes" : "Auto-layout all nodes"
            }
            aria-label={
              several ? "Auto-layout selected nodes" : "Auto-layout all nodes"
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M2 3h4v3H2zM10 2h4v3h-4zM10 11h4v3h-4zM2 10h4v3H2zM6 4.5h4M6 11.5h4" />
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
