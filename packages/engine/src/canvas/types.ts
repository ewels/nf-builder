// The canvas view (F-205, AR-31): what the UI draws for a projection, as plain data. Every field is readonly.

import type { Dataflow, GraphNodeKind } from "@nf-builder/lang-core";

export type CanvasAppearance =
  | "process"
  | "agent"
  | "module"
  | "workflow"
  | "chain"
  | "factory"
  | "params"
  | "output"
  | "take"
  | "emit"
  | "code"
  | "unparsed";

export type EdgeDataflow = Dataflow | "unknown";

export interface CanvasPortView {
  readonly id: string;
  readonly label: string;
  /** The formatted type; null when nothing is known. */
  readonly type: string | null;
}

export interface CanvasNodeView {
  /** The projection's node id (the layout key, AR-11). */
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly appearance: CanvasAppearance;
  readonly shape: "card" | "pill";
  readonly title: string;
  readonly subtitle: string | null;
  readonly badge: "typed" | null;
  /** A call of a resolved workflow or pipeline: double-click opens its canvas tab (F-307, UX-50). */
  readonly opens: boolean;
  readonly inputs: readonly CanvasPortView[];
  readonly outputs: readonly CanvasPortView[];
  readonly ariaLabel: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The height of one port row, with or without labels. */
  readonly rowHeight: number;
}

export interface CanvasEdgeView {
  readonly id: string;
  readonly source: string;
  readonly sourcePort: string;
  readonly target: string;
  readonly targetPort: string;
  readonly dataflow: EdgeDataflow;
  readonly tooltip: string;
}

export interface CanvasView {
  readonly nodes: readonly CanvasNodeView[];
  readonly edges: readonly CanvasEdgeView[];
}

export interface CanvasViewOptions {
  readonly portLabels: boolean;
}
