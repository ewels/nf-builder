// Type probes (F-106 1.3): a line `def probeN: Boolean = <expr>` makes `nextflow lint` print the type nf-lang infers for
// <expr> as an assignment error. The projection tests strip these lines and compare the recorded messages with ports.

export interface Probe {
  /** The 1-based line in the unstripped text. */
  readonly line: number;
  readonly expression: string;
}

const PROBE = /^[ \t]*def probe\d+: Boolean = (.*)$/;

/** Removes every whole probe line; `probes` carry their line numbers in the original text. */
export function stripProbes(text: string): { text: string; probes: Probe[] } {
  const probes: Probe[] = [];
  const kept: string[] = [];
  text.split("\n").forEach((line, index) => {
    const match = PROBE.exec(line);
    if (match === null) kept.push(line);
    else
      probes.push({ line: index + 1, expression: (match[1] as string).trim() });
  });
  return { text: kept.join("\n"), probes };
}

/** A type as nf-lang prints it in a message. */
export type NfType =
  | { kind: "channel" | "value" | "plain"; element: string }
  | { kind: "record"; fields: { name: string; type: NfType }[] }
  | { kind: "unknown" };

const MESSAGE = /cannot be assigned to value with type ([\s\S]*)$/;

/** Reads one printed type: `Channel<Path>`, `Value<Path>`, `Path`, `?`, or `Record { a: T … }` (one field per line). */
export function parseNfTypeText(text: string): NfType {
  const t = text.trim();
  if (t === "?" || t === "") return { kind: "unknown" };
  const record = /^Record\s*\{([\s\S]*)\}$/.exec(t);
  if (record !== null) {
    const fields: { name: string; type: NfType }[] = [];
    for (const line of (record[1] as string).split("\n")) {
      const field = /^\s*([^\s:]+):\s*(.*?)\s*$/.exec(line);
      if (field !== null)
        fields.push({
          name: field[1] as string,
          type: parseNfTypeText(field[2] as string),
        });
    }
    return { kind: "record", fields };
  }
  const wrapped = /^(Channel|Value)<([\s\S]*)>$/.exec(t);
  if (wrapped !== null)
    return {
      kind: wrapped[1] === "Channel" ? "channel" : "value",
      element: (wrapped[2] as string).trim(),
    };
  return { kind: "plain", element: t };
}

/** The type in a probe's lint message; null when the message isn't a probe's. */
export function parseNfType(message: string): NfType | null {
  const match = MESSAGE.exec(message);
  return match === null ? null : parseNfTypeText(match[1] as string);
}
