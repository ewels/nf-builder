// What a drag from an output port tells the canvas about every input port (F-302, UX-25). The statuses come from the
// engine's dry run; the components only map them to classes (AR-31).
import type {
  ConnectionStatus,
  ConnectionTarget,
  PortRef,
} from "@nf-builder/engine";
import { createContext } from "react";

/** Node id to input port id to status. */
export type TargetStatusMap = ReadonlyMap<
  string,
  ReadonlyMap<string, ConnectionStatus>
>;

/** Null while no connection is being dragged, or while the engine hasn't answered yet: every target looks normal. */
export const ConnectTargetsContext = createContext<TargetStatusMap | null>(
  null,
);

export function targetStatusMap(
  targets: readonly ConnectionTarget[],
): TargetStatusMap {
  const map = new Map<string, Map<string, ConnectionStatus>>();
  for (const t of targets) {
    const ports = map.get(t.node) ?? new Map<string, ConnectionStatus>();
    ports.set(t.port, t.status);
    map.set(t.node, ports);
  }
  return map;
}

/** The port a React Flow handle id (`in:<port>` or `out:<port>`) stands for; null for any other id. */
export function portRefOfHandle(
  node: string,
  handle: string | null | undefined,
): PortRef | null {
  if (handle === null || handle === undefined) return null;
  if (handle.startsWith("in:")) return { node, port: handle.slice(3) };
  if (handle.startsWith("out:")) return { node, port: handle.slice(4) };
  return null;
}
