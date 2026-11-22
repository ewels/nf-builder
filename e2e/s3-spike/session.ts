// The LSP client script, shared by the page (over the worker) and the plain-Java reference (over stdio).
// Runs in Node and in the browser: no DOM or Node types.
import {
  editName,
  expectedMessage,
  FIXTURE_URI,
  withUndefinedVariable,
} from "./fixture.ts";
import type { JsonRpcMessage } from "./lsp-framing.ts";

export interface Transport {
  send(message: JsonRpcMessage): void;
  onMessage(listener: (message: JsonRpcMessage) => void): void;
}

export type Position = { line: number; character: number };
export type Diagnostic = {
  range: { start: Position; end: Position };
  severity?: number;
  source?: string;
  message: string;
};

export type SessionOptions = {
  /** The committed oracle case file (undefined_channel on line 487). */
  fixtureText: string;
  edits: number;
  now: () => number;
  timeoutMs: number;
};

export type SessionResult = {
  /** Methods in send order. */
  sent: string[];
  initializeResult: { capabilities: Record<string, unknown> };
  initializeSentAt: number;
  initializeResponseAt: number;
  didOpenSentAt: number;
  firstDiagnosticsAt: number;
  firstDiagnostics: Diagnostic[];
  edits: { name: string; sentAt: number; diagnosticsAt: number }[];
  shutdownAt: number;
};

type Waiter = {
  predicate: (message: JsonRpcMessage) => boolean;
  resolve: (value: { message: JsonRpcMessage; at: number }) => void;
};

function diagnosticsNaming(
  message: JsonRpcMessage,
  name: string,
): Diagnostic[] | null {
  if (message.method !== "textDocument/publishDiagnostics") return null;
  const params = message.params as
    | { uri?: string; diagnostics?: Diagnostic[] }
    | undefined;
  if (params?.uri !== FIXTURE_URI) return null;
  const list = params.diagnostics ?? [];
  return list.some((d) => d.message === expectedMessage(name)) ? list : null;
}

export async function runSession(
  transport: Transport,
  options: SessionOptions,
): Promise<SessionResult> {
  const { now, timeoutMs } = options;
  const waiters = new Set<Waiter>();
  const sent: string[] = [];

  transport.onMessage((message) => {
    if (message.id !== undefined && message.id !== null && message.method) {
      transport.send({ jsonrpc: "2.0", id: message.id, result: null });
      return;
    }
    const at = now();
    for (const waiter of [...waiters]) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        waiter.resolve({ message, at });
      }
    }
  });

  function expectMessage(
    stage: string,
    predicate: (message: JsonRpcMessage) => boolean,
  ): Promise<{ message: JsonRpcMessage; at: number }> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(
          new Error(
            `S3 session: timed out after ${timeoutMs} ms waiting for ${stage}`,
          ),
        );
      }, timeoutMs);
      waiters.add(waiter);
    });
  }

  function send(message: JsonRpcMessage): void {
    if (message.method) sent.push(message.method);
    transport.send(message);
  }

  function expectDiagnostics(stage: string, name: string) {
    return expectMessage(stage, (m) => diagnosticsNaming(m, name) !== null);
  }

  const initializeSentAt = now();
  const initialized = expectMessage(
    "initialize",
    (m) => m.id === 1 && (m.result !== undefined || m.error !== undefined),
  );
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      processId: null,
      rootUri: null,
      workspaceFolders: null,
      capabilities: {},
    },
  });
  const init = await initialized;
  if (init.message.error)
    throw new Error(
      `S3 session: initialize failed: ${init.message.error.message}`,
    );
  send({ jsonrpc: "2.0", method: "initialized", params: {} });

  const first = expectDiagnostics("first diagnostics", editName(0));
  const didOpenSentAt = now();
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri: FIXTURE_URI,
        languageId: "nextflow",
        version: 1,
        text: options.fixtureText,
      },
    },
  });
  const firstResult = await first;
  const firstDiagnostics =
    diagnosticsNaming(firstResult.message, editName(0)) ?? [];

  const edits: SessionResult["edits"] = [];
  for (let i = 1; i <= options.edits; i++) {
    const name = editName(i);
    const done = expectDiagnostics(`diagnostics for edit ${i}`, name);
    const sentAt = now();
    send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: FIXTURE_URI, version: i + 1 },
        contentChanges: [
          { text: withUndefinedVariable(options.fixtureText, name) },
        ],
      },
    });
    edits.push({ name, sentAt, diagnosticsAt: (await done).at });
  }

  const down = expectMessage(
    "shutdown",
    (m) => m.id === 2 && (m.result !== undefined || m.error !== undefined),
  );
  send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
  const shutdownAt = (await down).at;
  send({ jsonrpc: "2.0", method: "exit" });

  return {
    sent,
    initializeResult: init.message.result as SessionResult["initializeResult"],
    initializeSentAt,
    initializeResponseAt: init.at,
    didOpenSentAt,
    firstDiagnosticsAt: firstResult.at,
    firstDiagnostics,
    edits,
    shutdownAt,
  };
}
