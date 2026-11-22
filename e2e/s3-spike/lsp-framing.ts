// LSP base-protocol framing. Runs in Node and in the browser worker: no DOM or Node types.
export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMessage(message: JsonRpcMessage): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const head = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head);
  bytes.set(body, head.length);
  return bytes;
}

function indexOfHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (
      bytes[i] === 13 &&
      bytes[i + 1] === 10 &&
      bytes[i + 2] === 13 &&
      bytes[i + 3] === 10
    )
      return i;
  }
  return -1;
}

export class MessageDecoder {
  private pending: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): JsonRpcMessage[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    this.pending = joined;
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const end = indexOfHeaderEnd(this.pending);
      if (end < 0) break;
      const header = decoder.decode(this.pending.subarray(0, end));
      const match = /^Content-Length: *(\d+)$/im.exec(header);
      if (!match)
        throw new Error(`LSP header without Content-Length: ${header}`);
      const length = Number(match[1]);
      const start = end + 4;
      if (this.pending.length < start + length) break;
      const body = decoder.decode(this.pending.subarray(start, start + length));
      messages.push(JSON.parse(body) as JsonRpcMessage);
      this.pending = this.pending.slice(start + length);
    }
    return messages;
  }

  get buffered(): number {
    return this.pending.length;
  }
}
