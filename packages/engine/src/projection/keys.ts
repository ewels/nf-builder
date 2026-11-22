// Node keys (AR-11, ADR 0008). A key depends only on names and order, never on offsets, so it survives whitespace
// changes. Grammar:
//   key   = path "#" workflow "/" local      workflow = a name, or "" for the entry workflow
//   local = var | var "~" n                  the n-th assignment (n >= 2) to var
//         | callee "@" n                     the n-th unassigned node of that callee (n >= 1)
//         | ":code@" n | ":take:" name | ":emit:" name | ":params" | ":output"
// Identifiers contain none of `~ @ : / #`, so the forms can't collide; the path may contain `#`, so parsing splits at
// the last one.

import type { NodeKey, NodeKeyLocal } from "@nf-builder/lang-core";

function formatLocal(local: NodeKeyLocal): string {
  switch (local.kind) {
    case "assigned":
      return local.occurrence <= 1
        ? local.variable
        : `${local.variable}~${local.occurrence}`;
    case "unassigned":
      return `${local.callee}@${local.occurrence}`;
    case "code":
      return `:code@${local.occurrence}`;
    case "take":
      return `:take:${local.name}`;
    case "emit":
      return `:emit:${local.name}`;
    case "params":
      return ":params";
    case "output":
      return ":output";
  }
}

export function formatNodeKey(key: NodeKey): string {
  return `${key.path}#${key.workflow ?? ""}/${formatLocal(key.local)}`;
}

/** A canonical decimal integer of at least `min` (no sign, no leading zero); null otherwise. */
function count(text: string, min: number): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

function parseLocal(text: string): NodeKeyLocal | null {
  if (text === ":params") return { kind: "params" };
  if (text === ":output") return { kind: "output" };
  if (text.startsWith(":")) {
    const code = /^:code@(.+)$/.exec(text);
    if (code !== null) {
      const occurrence = count(code[1] as string, 1);
      return occurrence === null ? null : { kind: "code", occurrence };
    }
    const role = /^:(take|emit):(.+)$/.exec(text);
    if (role === null || /[~@:/]/.test(role[2] as string)) return null;
    return { kind: role[1] as "take" | "emit", name: role[2] as string };
  }
  const at = text.lastIndexOf("@");
  if (at >= 0) {
    const callee = text.slice(0, at);
    const occurrence = count(text.slice(at + 1), 1);
    if (callee === "" || occurrence === null || /[~@:/]/.test(callee))
      return null;
    return { kind: "unassigned", callee, occurrence };
  }
  const tilde = text.indexOf("~");
  const variable = tilde < 0 ? text : text.slice(0, tilde);
  if (variable === "" || /[~@:/]/.test(variable)) return null;
  if (tilde < 0) return { kind: "assigned", variable, occurrence: 1 };
  const occurrence = count(text.slice(tilde + 1), 2);
  return occurrence === null
    ? null
    : { kind: "assigned", variable, occurrence };
}

/** The inverse of `formatNodeKey`; null when `id` isn't a key. */
export function parseNodeKey(id: string): NodeKey | null {
  const hash = id.lastIndexOf("#");
  if (hash < 0) return null;
  const rest = id.slice(hash + 1);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const local = parseLocal(rest.slice(slash + 1));
  if (local === null) return null;
  const workflow = rest.slice(0, slash);
  return {
    path: id.slice(0, hash),
    workflow: workflow === "" ? null : workflow,
    local,
  };
}

/** Hands out the keys of one workflow in source order: assignments are numbered per variable, unassigned nodes per callee. */
export class KeyAllocator {
  readonly #path: string;
  readonly #workflow: string | null;
  readonly #assigned = new Map<string, number>();
  readonly #unassigned = new Map<string, number>();
  #code = 0;

  constructor(path: string, workflow: string | null) {
    this.#path = path;
    this.#workflow = workflow;
  }

  #format(local: NodeKeyLocal): string {
    return formatNodeKey({
      path: this.#path,
      workflow: this.#workflow,
      local,
    });
  }

  #next(counts: Map<string, number>, name: string): number {
    const occurrence = (counts.get(name) ?? 0) + 1;
    counts.set(name, occurrence);
    return occurrence;
  }

  assigned(variable: string): string {
    return this.#format({
      kind: "assigned",
      variable,
      occurrence: this.#next(this.#assigned, variable),
    });
  }

  unassigned(callee: string): string {
    return this.#format({
      kind: "unassigned",
      callee,
      occurrence: this.#next(this.#unassigned, callee),
    });
  }

  code(): string {
    this.#code += 1;
    return this.#format({ kind: "code", occurrence: this.#code });
  }

  take(name: string): string {
    return this.#format({ kind: "take", name });
  }

  emit(name: string): string {
    return this.#format({ kind: "emit", name });
  }

  params(): string {
    return this.#format({ kind: "params" });
  }

  output(): string {
    return this.#format({ kind: "output" });
  }
}
