// Plain-Java reference for spike S3: the same session as the browser run, against `java -jar` over stdio.
// Needs `java` on PATH. node e2e/s3-spike/reference.ts [--write-expected] [--runs 3]
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURE_URI } from "./fixture.ts";
import { encodeMessage, MessageDecoder } from "./lsp-framing.ts";
import { median, type ReferenceResult } from "./metrics.ts";
import { CACHE_DIR, EXPECTED_PATH, FIXTURE_PATH } from "./paths.ts";
import { ensureJar, readLanguageServerPin } from "./prepare.ts";
import { runSession, type SessionResult, type Transport } from "./session.ts";

/** stderr is ignored: JAVA_TOOL_OPTIONS and logging noise. */
export function stdioTransport(
  child: ChildProcessWithoutNullStreams,
): Transport {
  const decoder = new MessageDecoder();
  child.stderr.resume();
  return {
    send(message) {
      child.stdin.write(encodeMessage(message));
    },
    onMessage(listener) {
      child.stdout.on("data", (chunk: Buffer) => {
        for (const message of decoder.push(chunk)) listener(message);
      });
    },
  };
}

export async function referenceRun(
  jar: string,
  fixtureText: string,
  edits: number,
): Promise<{ initializeMs: number; session: SessionResult }> {
  const startedAt = performance.now();
  const child = spawn("java", ["-jar", jar], { stdio: "pipe" });
  const failed = new Promise<never>((_, reject) => {
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code !== 0 && code !== null)
        reject(new Error(`java exited with status ${code}`));
    });
  });
  try {
    const session = await Promise.race([
      runSession(stdioTransport(child), {
        fixtureText,
        edits,
        now: () => performance.now(),
        timeoutMs: 60_000,
      }),
      failed,
    ]);
    return { initializeMs: session.initializeResponseAt - startedAt, session };
  } finally {
    child.kill();
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const writeExpected = argv.includes("--write-expected");
  const runsAt = argv.indexOf("--runs");
  const runs = runsAt >= 0 ? Number(argv[runsAt + 1]) : 3;
  if (!Number.isInteger(runs) || runs < 1) {
    console.error("--runs needs a positive integer");
    return 1;
  }
  const jar =
    process.env.S3_LANGUAGE_SERVER_JAR ?? ensureJar(readLanguageServerPin());
  const fixtureText = readFileSync(FIXTURE_PATH, "utf8");
  const results: { initializeMs: number; session: SessionResult }[] = [];
  for (let i = 0; i < runs; i++)
    results.push(await referenceRun(jar, fixtureText, 5));

  const first = results[0];
  if (!first) return 1;
  if (writeExpected) {
    writeFileSync(
      EXPECTED_PATH,
      `${JSON.stringify({ uri: FIXTURE_URI, diagnostics: first.session.firstDiagnostics }, null, 2)}\n`,
    );
  }
  const reference: ReferenceResult = {
    initializeMs: median(results.map((r) => r.initializeMs)),
    firstDiagnosticsMs: median(
      results.map(
        (r) => r.session.firstDiagnosticsAt - r.session.didOpenSentAt,
      ),
    ),
    editDiagnosticsMs: results.flatMap((r) =>
      r.session.edits.map((e) => e.diagnosticsAt - e.sentAt),
    ),
  };
  const out = join(CACHE_DIR, "reference.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ runs, ...reference }, null, 2)}\n`);
  console.log(
    `S3 reference (${runs} runs): initialize ${reference.initializeMs.toFixed(0)} ms, first diagnostics ${reference.firstDiagnosticsMs.toFixed(0)} ms, edit diagnostics median ${median(reference.editDiagnosticsMs).toFixed(0)} ms`,
  );
  console.log(JSON.stringify(first.session.firstDiagnostics));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));
