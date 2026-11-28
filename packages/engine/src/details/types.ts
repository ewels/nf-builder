// The details pane's views (F-206, UX-30, UX-31, AR-31): what the UI shows for a selected node and for the open
// workflow. Plain data, so it can cross from the worker; every field is readonly.

import type { Callee, Diagnostic, GraphNodeKind } from "@nf-builder/lang-core";

export interface PortConnection {
  readonly direction: "from" | "to";
  /** The node at the other end. */
  readonly node: string | null;
  /** "from params.input", "from ALIGN.bam", "to ALIGN.reads"; the port is left out for a single-port node. */
  readonly text: string;
}

export interface PortDetail {
  readonly id: string;
  readonly label: string;
  /** The formatted type; null when nothing is known. */
  readonly type: string | null;
  readonly connections: readonly PortConnection[];
  /** Why the port has no connection: an unfed input, an input fed inline, or an unused output. */
  readonly unconnected: "not-connected" | "inline" | "unused" | null;
  /** The type of an inline argument; null when not known. */
  readonly argumentType: string | null;
}

export interface NodeView {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly name: string;
  readonly kindLabel: string;
  /** The registry module name, for a registry call. */
  readonly module: string | null;
  /** The file; null when the callee is not found. */
  readonly path: string | null;
  /** The line in `path`; null when only the worker knows it. */
  readonly line: number | null;
  readonly inputs: readonly PortDetail[];
  readonly outputs: readonly PortDetail[];
}

export interface SummaryPort {
  readonly node: string;
  readonly name: string;
  readonly type: string | null;
}

export interface SummaryCall {
  readonly node: string;
  readonly name: string;
  readonly callee: string;
  readonly kindLabel: string;
  readonly module: string | null;
  readonly status: Callee["status"];
}

export interface SummaryModule {
  readonly module: string;
  readonly calls: readonly string[];
}

export interface WorkflowSummary {
  /** The workflow's name, or "Entry workflow". */
  readonly name: string;
  readonly path: string;
  /** The entry workflow, which has parameters and outputs rather than take and emit. */
  readonly entry: boolean;
  readonly typed: boolean | null;
  readonly takes: readonly SummaryPort[];
  readonly emits: readonly SummaryPort[];
  /** The entry workflow's parameters; empty for a named workflow. */
  readonly params: readonly SummaryPort[];
  /** The entry workflow's published outputs; empty for a named workflow. */
  readonly outputs: readonly SummaryPort[];
  readonly calls: readonly SummaryCall[];
  readonly modules: readonly SummaryModule[];
}

export interface DetailRow {
  readonly name: string;
  readonly value: string;
}

export interface OperatorDetail {
  readonly name: string;
  readonly description: string | null;
  readonly legacy: boolean;
}

export interface Preview {
  readonly title: "Script" | "Shell" | "Exec" | "Prompt" | "Source";
  readonly text: string;
  readonly truncated: boolean;
}

export interface DeclarationDetails {
  readonly path: string | null;
  readonly line: number | null;
  readonly description: string | null;
  readonly directives: readonly DetailRow[];
  readonly topics: readonly DetailRow[];
  readonly operators: readonly OperatorDetail[];
  readonly preview: Preview | null;
}

export interface NodeDetails {
  readonly node: string;
  readonly declaration: DeclarationDetails;
  readonly diagnostics: readonly Diagnostic[];
}

export type OutlineKind =
  | "featureFlag"
  | "include"
  | "import"
  | "params"
  | "legacyParam"
  | "record"
  | "enum"
  | "process"
  | "agent"
  | "workflow"
  | "output"
  | "function"
  | "unparsed"
  | "statement";

/** One top-level declaration of a file (F-605, FI-31): names and a range, never text. `detail` is at most 80 characters. */
export interface OutlineItem {
  readonly kind: OutlineKind;
  readonly name: string;
  readonly detail: string;
  /** 1-based. */
  readonly line: number;
  /** UTF-16 offsets into the file's text. */
  readonly range: { readonly start: number; readonly end: number };
}
