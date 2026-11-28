// The canvas of one workflow, in a lazily loaded chunk (F-205, QA-01, ADR 0003): React Flow stays out of the initial JS.
import {
  type ConnectionTarget,
  canvasView,
  type PortRef,
  type Positions,
  type Projection,
  unplaced,
} from "@nf-builder/engine";
import {
  Background,
  type Connection,
  ConnectionMode,
  ControlButton,
  Controls,
  MiniMap,
  type OnConnectStart,
  type OnNodesChange,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type DragEvent,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./canvas.css";
import { runElk } from "../layout/elk-client";
import { autoLayout, placedNodes, placeMissing } from "../layout/layout-flow";
import { hasPaletteDrag, readPaletteDrag } from "../palette/palette-drag";
import { NODE_TYPES } from "./canvas-nodes";
import type { Placement } from "./canvas-store";
import {
  ConnectTargetsContext,
  portRefOfHandle,
  type TargetStatusMap,
  targetStatusMap,
} from "./connect-targets";
import { edgeKeyAction } from "./edge-keys";
import { EDGE_TYPES } from "./flow-edge";
import {
  type CanvasFlowEdge,
  type CanvasFlowNode,
  toFlowEdges,
  toFlowNodes,
} from "./flow-elements";
import { useRefitOnResize } from "./use-refit-on-resize";
import { registerViewport } from "./viewport";

const NODE_DESCRIPTION =
  "Press enter or space to select this node, then use the arrow keys to move it.";
/** Read-only (F-703): nodes don't move, so the description doesn't offer it. */
const NODE_DESCRIPTION_READ_ONLY = "Press enter or space to select this node.";

/** Sentence-case labels with no node delete wording (nodes can't be deleted yet); an edge is disconnected with Delete, which its own label says. */
const CANVAS_ARIA_LABELS = {
  "node.a11yDescription.default": NODE_DESCRIPTION,
  "node.a11yDescription.keyboardDisabled": NODE_DESCRIPTION,
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

const READ_ONLY_ARIA_LABELS = {
  ...CANVAS_ARIA_LABELS,
  "node.a11yDescription.default": NODE_DESCRIPTION_READ_ONLY,
  "node.a11yDescription.keyboardDisabled": NODE_DESCRIPTION_READ_ONLY,
} as const;

const FIT = { maxZoom: 1 } as const;

interface WorkflowCanvasProps {
  /** The workflow tab this canvas shows (the viewport bridge looks it up, F-301). */
  readonly tab: string;
  /** False for the one view that shows a node added from the palette: the viewport stays where it is (F-301). */
  readonly refit: boolean;
  /** A palette item was dropped here, at this flow point (F-301, UX-15). */
  readonly onPaletteDrop: (key: string, at: { x: number; y: number }) => void;
  /** Below 1024 px (F-703, UX-04): nodes don't move, and there is no Auto-layout or minimap. */
  readonly readOnly: boolean;
  readonly projection: Projection;
  readonly portLabels: boolean;
  readonly onPortLabelsChange: (value: boolean) => void;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  /** A request to centre a node (F-309); each `seq` is acted on once, by whichever canvas is ready first. */
  readonly focus: { readonly id: string; readonly seq: number } | null;
  /** The stored positions, kept up to date by the store (F-207). */
  readonly positions: Positions;
  /** Layout messages to show, oldest problem first. */
  readonly notices: readonly string[];
  /** Nodes the user moved (drag stop or keyboard); the store rounds and saves them. */
  readonly onMove: (moves: Positions) => void;
  /** The result of a layout run on this canvas. */
  readonly onPlace: (placement: Placement) => void;
  /** Edge id to the message of the mismatch diagnostic on its target port (UX-24, LA-32). */
  readonly mismatches: ReadonlyMap<string, string>;
  /** Asks the engine for the status of every input port while an output port is dragged; null when it can't answer (F-302). */
  readonly onConnectionTargets: (
    from: PortRef,
  ) => Promise<readonly ConnectionTarget[] | null>;
  /** An output port was dropped on an input port (F-302, UX-25). */
  readonly onConnect: (from: PortRef, to: PortRef) => void;
  /** The selected or focused edge's target port is disconnected (F-302, UX-70). */
  readonly onDisconnect: (port: PortRef) => void;
}

// the newest focus request acted on: a canvas mounted later (another tab) doesn't repeat it
let handledFocus = 0;

function CanvasInner({
  tab,
  refit,
  onPaletteDrop,
  readOnly,
  projection,
  portLabels,
  onPortLabelsChange,
  selected,
  onSelect,
  focus,
  positions,
  notices,
  onMove,
  onPlace,
  mismatches,
  onConnectionTargets,
  onConnect,
  onDisconnect,
}: WorkflowCanvasProps): JSX.Element {
  const view = useMemo(
    () => canvasView(projection, { portLabels }),
    [projection, portLabels],
  );
  // nodes without a stored position are laid out by ELK. Until it answers they are held back: the placed nodes keep
  // drawing, and a first open (nothing placed) draws none, so the first fit has the final positions (F-207)
  const waiting = useMemo(
    () => unplaced(view, positions).length > 0,
    [view, positions],
  );
  const latest = useRef({ positions, onPlace });
  latest.current = { positions, onPlace };
  const [placing, setPlacing] = useState(false);
  const [arranging, setArranging] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setPlacing(false);
      return;
    }
    let cancelled = false;
    setPlacing(true);
    void placeMissing(projection, latest.current.positions, runElk).then(
      (r) => {
        if (cancelled) return;
        setPlacing(false);
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
  // a new view replaces the nodes at the current positions (the placed ones); a move or a layout run changes positions
  // in place below, and nodes ELK has just placed are added, which keeps the measured sizes and the viewport
  const initialNodes = useMemo(
    () => toFlowNodes(placedNodes(view, latest.current.positions), portLabels),
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
  useEffect(
    () =>
      setNodes((current) => {
        const have = new Set(current.map((n) => n.id));
        const added = toFlowNodes(
          placedNodes(view, positions),
          portLabels,
        ).filter((n) => !have.has(n.id));
        let changed = added.length > 0;
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
        return changed ? [...next, ...added] : current;
      }),
    [positions, view, portLabels, setNodes],
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
  // the edge selected on the canvas, to disconnect; React Flow's own edge selection stays off (F-206, F-302)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const edgeIds = useMemo(() => new Set(view.edges.map((e) => e.id)), [view]);
  useEffect(() => {
    if (selectedEdge !== null && !edgeIds.has(selectedEdge))
      setSelectedEdge(null);
  }, [selectedEdge, edgeIds]);
  const edges = useMemo(
    () =>
      toFlowEdges(view, selected, mismatches, {
        selectedEdge,
        deletable: !readOnly,
      }),
    [view, selected, mismatches, selectedEdge, readOnly],
  );
  // while an output port is dragged: the engine's status for every input port. Until it answers, every target looks normal
  const [targets, setTargets] = useState<TargetStatusMap | null>(null);
  const dragging = useRef(0);
  const onConnectStart: OnConnectStart = (_event, params) => {
    const from =
      params.handleType === "source" && params.nodeId !== null
        ? portRefOfHandle(params.nodeId, params.handleId)
        : null;
    const mine = ++dragging.current;
    if (from === null) return;
    void onConnectionTargets(from).then((answer) => {
      if (mine === dragging.current && answer !== null)
        setTargets(targetStatusMap(answer));
    });
  };
  const endDrag = () => {
    dragging.current++;
    setTargets(null);
  };
  // a target the dry run refused can't take the drop; mismatched ones can (LA-29)
  const isValidConnection = (c: {
    target: string;
    targetHandle?: string | null;
    source: string;
  }) => {
    if (c.source === c.target) return false;
    const to = portRefOfHandle(c.target, c.targetHandle);
    if (to === null) return false;
    return targets?.get(to.node)?.get(to.port) !== "refused";
  };
  const connected = (c: Connection) => {
    const from = portRefOfHandle(c.source, c.sourceHandle);
    const to = portRefOfHandle(c.target, c.targetHandle);
    if (from !== null && to !== null) onConnect(from, to);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const onEdge = target.closest<HTMLElement>(".react-flow__edge");
    const id = onEdge?.getAttribute("data-id") ?? null;
    // a key typed in a field is the field's
    if (
      id === null &&
      target.closest("input, textarea, select, button, [contenteditable]")
    )
      return;
    const action = edgeKeyAction(event.key, readOnly);
    if (action === null) return;
    if (action === "clear") {
      setSelectedEdge(null);
      return;
    }
    const found = view.edges.find((e) => e.id === (id ?? selectedEdge));
    if (found === undefined) return;
    event.preventDefault();
    if (action === "select") {
      setSelectedEdge(found.id);
      onSelect(null);
    } else {
      setSelectedEdge(null);
      onDisconnect({ node: found.target, port: found.targetPort });
    }
  };
  // Delete acts on the edge that has the focus: once focus moves to a node or outside the canvas, none is selected
  const onFocus = (event: FocusEvent) => {
    const onEdge = (event.target as HTMLElement).closest<HTMLElement>(
      ".react-flow__edge",
    );
    if (onEdge?.getAttribute("data-id") !== selectedEdge) setSelectedEdge(null);
  };
  const onBlur = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setSelectedEdge(null);
  };
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
  const { fitView, getNode, getZoom, setCenter, screenToFlowPosition } =
    useReactFlow();
  const keepViewport = useRef(!refit);
  keepViewport.current = !refit;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!initialized) return;
    // a node dropped or added from the palette keeps the viewport where the user has it (F-301)
    if (keepViewport.current) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void fitView(FIT).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialized, fitView]);
  // centre a node the problems panel asked for, at the current zoom (F-309, UX-30)
  useEffect(() => {
    if (!ready || focus === null || focus.seq <= handledFocus) return;
    handledFocus = focus.seq;
    const node = getNode(focus.id);
    if (node === undefined) return;
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: getZoom(),
      duration: reduced ? 0 : 200,
    });
  }, [ready, focus, getNode, getZoom, setCenter]);
  const host = useRef<HTMLDivElement>(null);
  useRefitOnResize(host, FIT);
  // the palette reaches the viewport through this bridge (F-301)
  useEffect(
    () =>
      registerViewport({
        tab,
        centre() {
          const box = host.current?.getBoundingClientRect();
          return screenToFlowPosition({
            x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
            y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
          });
        },
      }),
    [tab, screenToFlowPosition],
  );
  const onDragOver = (event: DragEvent) => {
    if (!hasPaletteDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent) => {
    const key = readPaletteDrag(event.dataTransfer);
    if (key === null) return;
    event.preventDefault();
    onPaletteDrop(
      key,
      screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    );
  };
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
    setArranging(true);
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
    } finally {
      setArranging(false);
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for palette drags (the keyboard way is Enter on the palette item, UX-15) and the keys of a focused or selected edge (F-302)
    <div
      ref={host}
      className="workflow-canvas"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      data-canvas-state={ready ? "ready" : "loading"}
    >
      <div role="status" className="canvas-notices">
        {placing || arranging ? <p>Laying out nodes…</p> : null}
        {notices.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <ConnectTargetsContext.Provider value={targets}>
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
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          connectionMode={ConnectionMode.Strict}
          isValidConnection={isValidConnection}
          onConnectStart={onConnectStart}
          onConnect={connected}
          onConnectEnd={endDrag}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          onNodeClick={(_event, n) => {
            setSelectedEdge(null);
            onSelect(n.id);
          }}
          onEdgeClick={(_event, edge) => {
            if (readOnly) return;
            setSelectedEdge(edge.id);
            onSelect(null);
          }}
          onPaneClick={() => {
            setSelectedEdge(null);
            onSelect(null);
          }}
          deleteKeyCode={null}
          ariaLabelConfig={
            readOnly ? READ_ONLY_ARIA_LABELS : CANVAS_ARIA_LABELS
          }
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
            {readOnly ? null : (
              <ControlButton
                onClick={() => void runAutoLayout()}
                title={
                  several
                    ? "Auto-layout selected nodes"
                    : "Auto-layout all nodes"
                }
                aria-label={
                  several
                    ? "Auto-layout selected nodes"
                    : "Auto-layout all nodes"
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
            )}
          </Controls>
          {readOnly ? null : <MiniMap pannable zoomable />}
        </ReactFlow>
      </ConnectTargetsContext.Provider>
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
