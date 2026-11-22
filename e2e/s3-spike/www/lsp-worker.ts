// Classic worker (Vite bundles it as an IIFE): CheerpJ, the language server jar and the pipe bridge.
// Findings that decide this shape (spike S3 report): java.io.Piped*Stream fail ("Write end dead"), library-mode calls
// must be awaited one at a time, and Class.forName hung; two java.nio pipes and LSPLauncher work.
import {
  encodeMessage,
  type JsonRpcMessage,
  MessageDecoder,
} from "../lsp-framing.ts";
import {
  JAR_APP_PATH,
  loaderUrl,
  type PageToWorker,
  type WorkerStage,
  type WorkerToPage,
} from "../protocol.ts";

const post = (message: WorkerToPage): void => self.postMessage(message);
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const outbox: JsonRpcMessage[] = [];
let wantResources = false;
let stage: WorkerStage = "workerStarted";

function mark(next: WorkerStage): void {
  stage = next;
  post({ type: "mark", stage: next });
}

self.addEventListener("securitypolicyviolation", (event) => {
  post({
    type: "csp",
    directive: event.effectiveDirective,
    blockedURI: event.blockedURI,
  });
});

async function start(
  message: Extract<PageToWorker, { type: "start" }>,
): Promise<void> {
  const { variant, preloadResources } = message;
  mark("workerStarted");
  importScripts(loaderUrl(variant));
  mark("loaderLoaded");
  await cheerpjInit({
    version: variant.java,
    status: "none",
    wasmGC: variant.wasmGC,
    ...(variant.preload && preloadResources ? { preloadResources } : {}),
  });
  mark("cheerpjReady");
  const lib = await cheerpjRunLibrary(JAR_APP_PATH);
  mark("libraryLoaded");

  const Pipe = await lib.java.nio.channels.Pipe;
  const Channels = await lib.java.nio.channels.Channels;
  const ByteBuffer = await lib.java.nio.ByteBuffer;
  const toServer = await Pipe.open();
  const toClient = await Pipe.open();
  const serverIn = await Channels.newInputStream(await toServer.source());
  const clientOut = await Channels.newOutputStream(await toServer.sink());
  const serverOut = await Channels.newOutputStream(await toClient.sink());
  const clientIn = await toClient.source();
  await clientIn.configureBlocking(false);
  const buffer = await ByteBuffer.allocate(65536);
  const chunk = new Int8Array(65536);
  const LSPLauncher = await lib.org.eclipse.lsp4j.launch.LSPLauncher;
  const Server = await lib.nextflow.lsp.NextflowLanguageServer;
  const server = await new Server();
  const launcher = await LSPLauncher.createServerLauncher(
    server,
    serverIn,
    serverOut,
  );
  await server.connect(await launcher.getRemoteProxy());
  await launcher.startListening();
  mark("serverStarted");

  // The pump is the only place that calls Java from now on: one awaited call at a time.
  const decoder = new MessageDecoder();
  for (;;) {
    while (outbox.length > 0) {
      const bytes = encodeMessage(outbox.shift() as JsonRpcMessage);
      const i8 = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
      await clientOut.write(i8, 0, i8.length);
      await clientOut.flush();
    }
    await buffer.clear();
    const n: number = await clientIn.read(buffer);
    if (n > 0) {
      await buffer.flip();
      await buffer.get(chunk, 0, n);
      for (const m of decoder.push(new Uint8Array(chunk.buffer.slice(0, n))))
        post({ type: "message", message: m });
    } else await sleep(10);
    if (wantResources) {
      wantResources = false;
      post({ type: "runtimeResources", json: cjGetRuntimeResources() });
    }
  }
}

self.onmessage = (event: MessageEvent<PageToWorker>) => {
  const data = event.data;
  if (data.type === "send") outbox.push(data.message);
  else if (data.type === "runtimeResources") wantResources = true;
  else {
    start(data).catch((error: unknown) => {
      post({
        type: "error",
        stage,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
};
