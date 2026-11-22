// The names a workflow body has bound, and how a read resolves to ports of graph nodes (AR-10, F-106 2.3). A name can
// bind several values (F-107's conditional dataflow); F-106 always binds one.

import type { FlowType, PortRef } from "@nf-builder/lang-core";
import type { PortSpec } from "./signature";

/** A node a name stands for and the output ports it has. */
export interface Value {
  readonly node: string;
  readonly ports: readonly PortSpec[];
}

export interface ReadPath {
  readonly name: string;
  readonly properties: readonly string[];
}

export interface ResolvedRead {
  /** The text of the part of the read that names the value: `samples_ch`, `params.reads`, `res.txt`. */
  readonly variable: string;
  /** How many of the read's properties `variable` used (`res.txt.size` uses one). */
  readonly consumed: number;
  readonly sources: readonly {
    readonly port: PortRef;
    readonly type: FlowType | null;
  }[];
}

export class WorkflowScope {
  readonly #bindings = new Map<string, readonly Value[]>();

  /** The values `name` is bound to; none when it isn't bound. */
  lookup(name: string): readonly Value[] {
    return this.#bindings.get(name) ?? [];
  }

  /** Binds `name`, replacing an earlier binding. */
  bind(name: string, values: readonly Value[]): void {
    this.#bindings.set(name, values);
  }

  /**
   * `<name>.<port>` reads that output port; any other read of a value reads all its outputs (the one output of a
   * single-output value). Null when `name` is unbound or has no outputs.
   */
  resolveRead(read: ReadPath): ResolvedRead | null {
    const first = read.properties[0];
    const sources: ResolvedRead["sources"][number][] = [];
    let consumed = Number.POSITIVE_INFINITY;
    for (const value of this.lookup(read.name)) {
      const named =
        first === undefined
          ? undefined
          : value.ports.find((p) => p.id === first);
      const ports = named ? [named] : value.ports;
      if (ports.length === 0) continue;
      consumed = Math.min(consumed, named ? 1 : 0);
      for (const port of ports)
        sources.push({
          port: { node: value.node, port: port.id },
          type: port.type,
        });
    }
    if (sources.length === 0) return null;
    return {
      variable: [read.name, ...read.properties.slice(0, consumed)].join("."),
      consumed,
      sources,
    };
  }
}
