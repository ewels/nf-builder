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

/** The ports a legacy `.out` selector picks: all, the one named so, or the n-th (or `[n]`, a port made on demand). */
function selectPorts(
  ports: readonly PortSpec[],
  selector: string | number | null,
): PortSpec[] {
  if (selector === null) return [...ports];
  if (typeof selector === "string")
    return ports.filter((p) => p.id === selector);
  const picked = ports.find((p) => p.id === `[${selector}]`) ?? ports[selector];
  return picked === undefined ? [] : [picked];
}

export class WorkflowScope {
  readonly #bindings = new Map<string, readonly Value[]>();
  /** Legacy `.out` (F-107): the calls that can reach this point, by callee name. */
  readonly #calls = new Map<string, readonly Value[]>();
  /** Legacy `runner = PROC`: a variable that stands for a callee. */
  readonly #aliases = new Map<string, string>();

  /** The values `name` is bound to; none when it isn't bound. */
  lookup(name: string): readonly Value[] {
    return this.#bindings.get(name) ?? [];
  }

  /** Binds `name`, replacing an earlier binding (and a callee alias). */
  bind(name: string, values: readonly Value[]): void {
    this.#bindings.set(name, values);
    this.#aliases.delete(name);
  }

  /** Records the call of `callee` that reaches from here on. */
  recordCall(callee: string, value: Value): void {
    this.#calls.set(callee, [value]);
  }

  /** `name = CALLEE`: `name` stands for a callee, and no value. */
  bindAlias(name: string, callee: string): void {
    this.#bindings.set(name, []);
    this.#aliases.set(name, callee);
  }

  /** The callee `name` stands for: itself, or the one it aliases; null when it is a bound variable. */
  calleeOf(name: string): string | null {
    if (this.lookup(name).length > 0) return null;
    return this.#aliases.get(name) ?? name;
  }

  /** The calls of the callee `name` stands for that reach this point. */
  callsOf(name: string): readonly Value[] {
    const callee = this.calleeOf(name);
    return callee === null ? [] : (this.#calls.get(callee) ?? []);
  }

  /** Gives every binding of the node `id` the extra output `port` (a legacy callee's `.out` selection on demand). */
  addPort(id: string, port: PortSpec): void {
    const widen = (v: Value): Value =>
      v.node === id ? { node: id, ports: [...v.ports, port] } : v;
    for (const table of [this.#bindings, this.#calls])
      for (const [name, values] of table) table.set(name, values.map(widen));
  }

  /**
   * `<callee>.out`, `.out.<name>` or `.out[<n>]` of the calls that reach this point: the named or n-th output, or
   * all of them for a null selector. Null when no call reaches or nothing is selected.
   */
  resolveOut(
    name: string,
    selector: string | number | null,
  ): ResolvedRead | null {
    const sources: ResolvedRead["sources"][number][] = [];
    for (const value of this.callsOf(name)) {
      const ports = selectPorts(value.ports, selector);
      for (const port of ports)
        sources.push({
          port: { node: value.node, port: port.id },
          type: port.type,
        });
    }
    if (sources.length === 0) return null;
    const text =
      selector === null
        ? `${name}.out`
        : typeof selector === "string"
          ? `${name}.out.${selector}`
          : `${name}.out[${selector}]`;
    return { variable: text, consumed: 0, sources };
  }

  /**
   * `<name>.<port>` reads that output port; any other read of a value reads all its outputs (the one output of a
   * single-output value). Null when `name` is unbound or has no outputs.
   */
  resolveRead(read: ReadPath): ResolvedRead | null {
    if (read.properties[0] === "out" && this.calleeOf(read.name) !== null) {
      const named = read.properties[1];
      const byName =
        named === undefined ? null : this.resolveOut(read.name, named);
      const out = byName ?? this.resolveOut(read.name, null);
      if (out !== null) {
        const used = byName === null ? 1 : 2;
        return {
          ...out,
          variable: [read.name, ...read.properties.slice(0, used)].join("."),
          consumed: used,
        };
      }
    }
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
