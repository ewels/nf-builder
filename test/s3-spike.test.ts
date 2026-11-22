import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  editName,
  expectedMessage,
  FIXTURE_CASE,
  FIXTURE_URI,
  KNOWN_ERROR_LINE,
  withUndefinedVariable,
} from "../e2e/s3-spike/fixture.ts";
import { spikeCsp, spikeHeaders } from "../e2e/s3-spike/headers.ts";
import {
  encodeMessage,
  type JsonRpcMessage,
  MessageDecoder,
} from "../e2e/s3-spike/lsp-framing.ts";
import {
  type Environment,
  median,
  parseVmHwmKb,
  parseVmRssKb,
  type RunMetrics,
  summarise,
  THRESHOLDS,
  toMarkdown,
  verdict,
} from "../e2e/s3-spike/metrics.ts";
import {
  readLanguageServerPin,
  sha256File,
  verifySha256,
} from "../e2e/s3-spike/prepare.ts";
import {
  CHEERPJ_ORIGIN,
  DEFAULT_VARIANT,
  parseVariant,
  variantLabel,
} from "../e2e/s3-spike/protocol.ts";
import {
  type Diagnostic,
  runSession,
  type Transport,
} from "../e2e/s3-spike/session.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";
import {
  cspProblems,
  SITE_POLICY_HEADERS,
} from "../scripts/security-policy.ts";

const SPIKE_DIR = join(REPO_ROOT, "e2e/s3-spike");
const CASE_FILE = join(
  REPO_ROOT,
  "tools/oracle/cases",
  FIXTURE_CASE,
  "main.nf",
);
const text = readFileSync(CASE_FILE, "utf8");

describe("S3 spike: LSP framing", () => {
  it("F-007 ADR-0010: encodeMessage frames a JSON-RPC message with a Content-Length counted in UTF-8 bytes", () => {
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "x",
      params: { text: "café → ok" },
    };
    const bytes = encodeMessage(message);
    const raw = new TextDecoder().decode(bytes);
    const [header, body] = raw.split("\r\n\r\n");
    const length = Number(/^Content-Length: (\d+)$/.exec(header ?? "")?.[1]);
    expect(length).toBe(new TextEncoder().encode(body).length);
    expect(length).toBeGreaterThan((body ?? "").length);
    expect(JSON.parse(body ?? "")).toEqual(message);
  });

  const two: JsonRpcMessage[] = [
    { jsonrpc: "2.0", id: 1, result: { text: "é→" } },
    { jsonrpc: "2.0", method: "m", params: { a: "→→→" } },
  ];
  const stream = new Uint8Array(
    two.flatMap((m) => Array.from(encodeMessage(m))),
  );

  it("F-007 ADR-0010: MessageDecoder returns the same messages whatever the chunk boundaries", () => {
    for (let cut = 0; cut <= stream.length; cut++) {
      const decoder = new MessageDecoder();
      const got = [
        ...decoder.push(stream.slice(0, cut)),
        ...decoder.push(stream.slice(cut)),
      ];
      expect(got).toEqual(two);
      expect(decoder.buffered).toBe(0);
    }
    const bytewise = new MessageDecoder();
    const got: JsonRpcMessage[] = [];
    for (const byte of stream) got.push(...bytewise.push(Uint8Array.of(byte)));
    expect(got).toEqual(two);
    expect(bytewise.buffered).toBe(0);
  });

  it("F-007 ADR-0010: MessageDecoder throws on a header without Content-Length, naming the header", () => {
    const decoder = new MessageDecoder();
    const bad = new TextEncoder().encode("X-Other: 5\r\n\r\n{}");
    expect(() => decoder.push(bad)).toThrow(/X-Other: 5/);
  });
});

describe("S3 spike: fixture", () => {
  it("F-007 step 1: the oracle case has 500 lines with undefined_channel on line 487, and withUndefinedVariable changes only that line", () => {
    const lines = text.split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.length - 1).toBe(500);
    expect(lines[KNOWN_ERROR_LINE - 1]).toBe("    undefined_channel.view()");
    const changed = withUndefinedVariable(text, "undefined_channel_1").split(
      "\n",
    );
    expect(changed.length).toBe(lines.length);
    const diff = lines.flatMap((line, i) => (changed[i] === line ? [] : [i]));
    expect(diff).toEqual([KNOWN_ERROR_LINE - 1]);
    expect(changed[KNOWN_ERROR_LINE - 1]).toBe(
      "    undefined_channel_1.view()",
    );
    expect(() => withUndefinedVariable("a\nb\n", "x")).toThrow();
    expect(editName(0)).toBe("undefined_channel");
    expect(editName(3)).toBe("undefined_channel_3");
    expect(expectedMessage("a")).toBe("`a` is not defined");
    expect(FIXTURE_URI).toBe("file:///spike/main.nf");
  });
});

describe("S3 spike: variants", () => {
  it("F-007: parseVariant reads java, wasmGC and preload, defaults to CheerpJ 5.0 and Java 17, and rejects unknown keys and Java versions", () => {
    expect(DEFAULT_VARIANT).toEqual({
      cheerpj: "5.0",
      java: 17,
      wasmGC: false,
      preload: false,
    });
    expect(parseVariant("")).toEqual(DEFAULT_VARIANT);
    expect(parseVariant("java=21&wasmGC=1&preload=1")).toEqual({
      cheerpj: "5.0",
      java: 21,
      wasmGC: true,
      preload: true,
    });
    expect(variantLabel(DEFAULT_VARIANT)).toBe("CheerpJ 5.0, Java 17");
    expect(variantLabel(parseVariant("java=21&wasmGC=1&preload=1"))).toBe(
      "CheerpJ 5.0, Java 21, wasmGC, preload",
    );
    expect(() => parseVariant("speed=9")).toThrow(/speed/);
    expect(() => parseVariant("java=8")).toThrow(/8/);
    expect(() => parseVariant("wasmGC=maybe")).toThrow(/maybe/);
    expect(CHEERPJ_ORIGIN).toBe("https://cjrtnc.leaningtech.com");
  });
});

describe("S3 spike: no version literals", () => {
  it("ADR-0010 LA-02: no file under e2e/s3-spike contains a Nextflow version literal", () => {
    const files = readdirSync(SPIKE_DIR, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((e) => e.isFile() && /\.(ts|json|html)$/.test(e.name))
      .map((e) => join(e.parentPath, e.name));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      expect(body, file).not.toMatch(/\b\d{2}\.(04|10)\.\d+\b/);
      expect(body, file).not.toMatch(/\bv\d{2}\.\d{2}\.\d+\b/);
    }
  });
});

type Reply = (message: JsonRpcMessage) => JsonRpcMessage[];

/** A scripted fake server: every reply advances the fake clock by 50 and arrives on a microtask. */
function fakeServer(reply?: Reply, advance = true) {
  const clock = { t: 0 };
  const sent: JsonRpcMessage[] = [];
  let listener: (m: JsonRpcMessage) => void = () => {};
  const deliver = (messages: JsonRpcMessage[]) => {
    if (messages.length === 0) return;
    queueMicrotask(() => {
      if (advance) clock.t += 50;
      for (const m of messages) listener(m);
    });
  };
  const defaultReply: Reply = (m) => {
    if (m.method === "initialize")
      return [
        {
          jsonrpc: "2.0",
          id: m.id,
          result: { capabilities: { textDocumentSync: 2 } },
        },
      ];
    if (m.method === "shutdown")
      return [{ jsonrpc: "2.0", id: m.id, result: null }];
    const doc = m.params as
      | {
          textDocument?: { uri: string; text?: string };
          contentChanges?: { text: string }[];
        }
      | undefined;
    const body = doc?.textDocument?.text ?? doc?.contentChanges?.[0]?.text;
    if (
      m.method === "textDocument/didOpen" ||
      m.method === "textDocument/didChange"
    )
      return [diagnosticsFor(FIXTURE_URI, body ?? "")];
    return [];
  };
  const transport: Transport = {
    send(message) {
      sent.push(message);
      deliver((reply ?? defaultReply)(message));
    },
    onMessage(l) {
      listener = l;
    },
  };
  return {
    transport,
    sent,
    clock,
    now: () => clock.t,
    emit: (m: JsonRpcMessage) => deliver([m]),
  };
}

function diag(message: string): Diagnostic {
  return {
    range: {
      start: { line: 486, character: 4 },
      end: { line: 486, character: 21 },
    },
    severity: 1,
    source: "nextflow",
    message,
  };
}

function diagnosticsFor(uri: string, body: string): JsonRpcMessage {
  const name = /^ {4}(undefined_channel(?:_\d+)?)\.view\(\)$/m.exec(body)?.[1];
  return {
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri,
      diagnostics: name ? [diag(expectedMessage(name))] : [],
    },
  };
}

const OPTIONS = { fixtureText: text, edits: 5, timeoutMs: 1000 };

describe("S3 spike: session", () => {
  it("F-007 step 1: runSession sends initialize, initialized and textDocument/didOpen in that order, then shutdown and exit", async () => {
    const server = fakeServer();
    const result = await runSession(server.transport, {
      ...OPTIONS,
      now: server.now,
    });
    expect(result.sent).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
      ...Array(5).fill("textDocument/didChange"),
      "shutdown",
      "exit",
    ]);
    expect(server.sent.map((m) => m.method)).toEqual(result.sent);
    const init = server.sent[0]?.params;
    expect(init).toEqual({
      processId: null,
      rootUri: null,
      workspaceFolders: null,
      capabilities: {},
    });
    expect(result.initializeResult.capabilities.textDocumentSync).toBe(2);
    const changes = server.sent.filter(
      (m) => m.method === "textDocument/didChange",
    );
    expect(
      changes.map(
        (m) =>
          (m.params as { textDocument: { version: number } }).textDocument
            .version,
      ),
    ).toEqual([2, 3, 4, 5, 6]);
  });

  it("F-007 step 1: runSession takes the first diagnostics only from a publishDiagnostics for the fixture URI that names undefined_channel", async () => {
    const server = fakeServer((m) => {
      if (m.method === "textDocument/didOpen")
        return [
          diagnosticsFor("file:///other.nf", text),
          {
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: { uri: FIXTURE_URI, diagnostics: [] },
          },
          diagnosticsFor(FIXTURE_URI, text),
        ];
      return fakeServerDefault(m);
    });
    const result = await runSession(server.transport, {
      ...OPTIONS,
      edits: 0,
      now: server.now,
    });
    expect(result.firstDiagnostics).toEqual([
      diag(expectedMessage("undefined_channel")),
    ]);
  });

  it("F-007 step 2: runSession timestamps initialize, didOpen, first diagnostics and every edit with the injected clock", async () => {
    const server = fakeServer();
    const result = await runSession(server.transport, {
      ...OPTIONS,
      edits: 2,
      now: server.now,
    });
    expect(result.initializeSentAt).toBe(0);
    expect(result.initializeResponseAt).toBe(50);
    expect(result.didOpenSentAt).toBe(50);
    expect(result.firstDiagnosticsAt).toBe(100);
    expect(result.edits).toEqual([
      { name: "undefined_channel_1", sentAt: 100, diagnosticsAt: 150 },
      { name: "undefined_channel_2", sentAt: 150, diagnosticsAt: 200 },
    ]);
    expect(result.shutdownAt).toBe(250);
  });

  it("F-007 step 2: runSession waits for the diagnostics naming each edit's variable and ignores stale ones", async () => {
    const server = fakeServer((m) => {
      const first = (
        m.params as { contentChanges?: { text: string }[] } | undefined
      )?.contentChanges?.[0]?.text;
      if (
        m.method === "textDocument/didChange" &&
        first?.includes("undefined_channel_1.view")
      ) {
        // The stale diagnostics (the previous text) arrive first, then the fresh ones.
        return [
          diagnosticsFor(FIXTURE_URI, text),
          diagnosticsFor(FIXTURE_URI, first),
        ];
      }
      return fakeServerDefault(m);
    });
    const result = await runSession(server.transport, {
      ...OPTIONS,
      edits: 1,
      now: server.now,
    });
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.name).toBe("undefined_channel_1");
  });

  it("F-007 step 1: runSession answers server requests with a null result and rejects on timeout naming the stage", async () => {
    const server = fakeServer((m) => {
      if (m.method === "initialize")
        return [
          {
            jsonrpc: "2.0",
            id: 77,
            method: "window/workDoneProgress/create",
            params: {},
          },
          ...fakeServerDefault(m),
        ];
      return fakeServerDefault(m);
    });
    await runSession(server.transport, {
      ...OPTIONS,
      edits: 0,
      now: server.now,
    });
    expect(server.sent).toContainEqual({
      jsonrpc: "2.0",
      id: 77,
      result: null,
    });

    const silent = fakeServer(() => []);
    await expect(
      runSession(silent.transport, {
        ...OPTIONS,
        timeoutMs: 20,
        now: silent.now,
      }),
    ).rejects.toThrow(
      "S3 session: timed out after 20 ms waiting for initialize",
    );
  });
});

/** The default reply, reused by scripted replies that only change one step. */
function fakeServerDefault(m: JsonRpcMessage): JsonRpcMessage[] {
  if (m.method === "initialize")
    return [
      {
        jsonrpc: "2.0",
        id: m.id,
        result: { capabilities: { textDocumentSync: 2 } },
      },
    ];
  if (m.method === "shutdown")
    return [{ jsonrpc: "2.0", id: m.id, result: null }];
  const p = m.params as
    | { textDocument?: { text?: string }; contentChanges?: { text: string }[] }
    | undefined;
  const body = p?.textDocument?.text ?? p?.contentChanges?.[0]?.text;
  if (
    m.method === "textDocument/didOpen" ||
    m.method === "textDocument/didChange"
  )
    return [diagnosticsFor(FIXTURE_URI, body ?? "")];
  return [];
}

const ENVIRONMENT: Environment = {
  date: "2026-11-22",
  chromium: "Chrome/157",
  cpu: "Xeon",
  cores: 4,
  memoryGb: 16,
  proxy: true,
  loaderSha256: "abc",
};

function run(overrides: Partial<RunMetrics>): RunMetrics {
  return {
    variant: "CheerpJ 5.0, Java 17",
    kind: "cold",
    coldStartMs: 5000,
    firstDiagnosticsMs: 1000,
    editDiagnosticsMs: [1000, 1000, 1000],
    baselineRssMb: 100,
    peakRssMb: 300,
    longTaskMaxMs: 10,
    requests: { cdn: 3, app: 3 },
    bytes: { cdn: 100, jar: 200 },
    ...overrides,
  };
}

const STAT = { median: 1, max: 1 };
const SUMMARY = {
  variant: "v",
  coldRuns: 3,
  warmRuns: 3,
  coldStartMs: { median: 5000, max: 6000 },
  warmStartMs: STAT,
  memoryMb: { median: 200, max: 250 },
  peakRssMb: { median: 300, max: 320 },
  firstDiagnosticsMs: STAT,
  editDiagnosticsMs: { median: 1500, max: 1800 },
};

describe("S3 spike: metrics", () => {
  it("ADR-0010: THRESHOLDS equal the ADR's cold start under 10 s, memory under 500 MB and diagnostics on a 500-line file under 2 s", () => {
    const adr = readFileSync(
      join(REPO_ROOT, "docs/adr/0010-language-server-spike.md"),
      "utf8",
    );
    expect(adr).toMatch(/under 10 s/);
    expect(adr).toMatch(/under 500 MB/);
    expect(adr).toMatch(/under 2 s/);
    expect(THRESHOLDS).toEqual({
      coldStartMs: 10_000,
      memoryMb: 500,
      diagnosticsMs: 2_000,
    });
  });

  it("F-007 step 2 ADR-0010: verdict passes only when cold start, memory and diagnostics medians are all under threshold, and names each miss", () => {
    expect(verdict(SUMMARY)).toEqual({ pass: true, misses: [] });
    const cold = verdict({
      ...SUMMARY,
      coldStartMs: { median: 18_200, max: 20_000 },
    });
    expect(cold.pass).toBe(false);
    expect(cold.misses).toEqual(["cold start 18.2 s (threshold 10 s)"]);
    const memory = verdict({ ...SUMMARY, memoryMb: { median: 640, max: 700 } });
    expect(memory.misses).toEqual(["memory 640 MB (threshold 500 MB)"]);
    const diagnostics = verdict({
      ...SUMMARY,
      editDiagnosticsMs: { median: 2600, max: 3000 },
    });
    expect(diagnostics.misses).toEqual(["diagnostics 2.6 s (threshold 2 s)"]);
    const all = verdict({
      ...SUMMARY,
      coldStartMs: { median: 18_200, max: 20_000 },
      memoryMb: { median: 640, max: 700 },
      editDiagnosticsMs: { median: 2600, max: 3000 },
    });
    expect(all.pass).toBe(false);
    expect(all.misses).toHaveLength(3);
  });

  it("F-007 step 2: summarise takes cold start and memory from cold runs, warm start from warm runs, and diagnostics from every run", () => {
    const runs = [
      run({
        coldStartMs: 9000,
        baselineRssMb: 100,
        peakRssMb: 400,
        editDiagnosticsMs: [1000, 3000, 2000],
      }),
      run({
        coldStartMs: 10_500,
        baselineRssMb: 100,
        peakRssMb: 500,
        editDiagnosticsMs: [1000, 1000, 1000],
      }),
      run({
        coldStartMs: 9500,
        baselineRssMb: 100,
        peakRssMb: 600,
        editDiagnosticsMs: [2000, 2000, 2000],
      }),
      run({
        kind: "warm",
        coldStartMs: 4000,
        baselineRssMb: null,
        peakRssMb: null,
        editDiagnosticsMs: [500, 500, 500],
      }),
      run({
        kind: "warm",
        coldStartMs: 6000,
        baselineRssMb: null,
        peakRssMb: null,
        editDiagnosticsMs: [500, 500, 500],
      }),
    ];
    const [s] = summarise(runs);
    expect(summarise(runs)).toHaveLength(1);
    expect(s?.coldRuns).toBe(3);
    expect(s?.warmRuns).toBe(2);
    expect(s?.coldStartMs).toEqual({ median: 9500, max: 10_500 });
    expect(s?.warmStartMs).toEqual({ median: 5000, max: 6000 });
    expect(s?.memoryMb).toEqual({ median: 400, max: 500 });
    expect(s?.peakRssMb).toEqual({ median: 500, max: 600 });
    // Each run's median edit latency: 2000, 1000, 2000, 500, 500 -> median 1000
    expect(s?.editDiagnosticsMs).toEqual({ median: 1000, max: 2000 });
    expect(s?.verdict.pass).toBe(true);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("F-007 step 2: toMarkdown prints the environment and one row per variant with each metric, its ADR 0010 threshold and pass or miss", () => {
    const passing = {
      ...SUMMARY,
      variant: "CheerpJ 5.0, Java 17",
      verdict: verdict(SUMMARY),
    };
    const missing = {
      ...SUMMARY,
      variant: "CheerpJ 5.0, Java 21",
      coldStartMs: { median: 18_200, max: 20_000 },
    };
    const md = toMarkdown(
      [passing, { ...missing, verdict: verdict(missing) }],
      ENVIRONMENT,
      {
        initializeMs: 1000,
        firstDiagnosticsMs: 1200,
        editDiagnosticsMs: [600, 700],
      },
    );
    expect(md).toContain("Chrome/157");
    expect(md).toContain("2026-11-22");
    expect(md).toContain("CheerpJ 5.0, Java 17");
    expect(md).toContain("CheerpJ 5.0, Java 21");
    expect(md).toContain("10 s");
    expect(md).toContain("500 MB");
    expect(md).toContain("2 s");
    expect(md).toContain("18.2 s");
    expect(md).toMatch(/miss/i);
    expect(md).toMatch(/pass/i);
    expect(md).toMatch(/plain Java/i);
  });

  it("F-007 step 2: parseVmHwmKb and parseVmRssKb read /proc status text and throw when the field is missing", () => {
    const status = "Name:\tchrome\nVmHWM:\t  276000 kB\nVmRSS:\t  250000 kB\n";
    expect(parseVmHwmKb(status)).toBe(276_000);
    expect(parseVmRssKb(status)).toBe(250_000);
    expect(() => parseVmHwmKb("Name:\tx\n")).toThrow(/VmHWM/);
    expect(() => parseVmRssKb("Name:\tx\n")).toThrow(/VmRSS/);
  });
});

const CDN = "https://cjrtnc.leaningtech.com";

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

describe("S3 spike: headers", () => {
  const production = SITE_POLICY_HEADERS;
  const prodCsp = production["Content-Security-Policy"] ?? "";

  function diff(kind: "cheerpj" | "qa30") {
    const before = directives(prodCsp);
    const after = directives(spikeCsp(kind, prodCsp));
    expect([...after.keys()]).toEqual([...before.keys()]);
    const changes: Record<string, string[]> = {};
    for (const [name, sources] of after) {
      const was = before.get(name) ?? [];
      expect(sources.slice(0, was.length), name).toEqual(was);
      const added = sources.slice(was.length);
      if (added.length > 0) changes[name] = added;
    }
    return changes;
  }

  it("ADR-0022: the spike CSP is the site policy (`SITE_POLICY_HEADERS`) plus the CheerpJ CDN in script-src and connect-src and 'unsafe-eval' in script-src, and nothing else", () => {
    expect(diff("cheerpj")).toEqual({
      "script-src": [CDN, "'unsafe-eval'"],
      "connect-src": [CDN],
    });
    expect(cspProblems(spikeCsp("cheerpj", prodCsp)).sort()).toEqual(
      [
        "script-src allows 'unsafe-eval'",
        `connect-src allows ${CDN}, which is not on the ADR 0002 allow-list`,
      ].sort(),
    );
  });

  it("ADR-0022: the QA-30 probe CSP adds only the CheerpJ CDN and 'wasm-unsafe-eval', so its only QA-30 problem is the CDN in connect-src", () => {
    expect(diff("qa30")).toEqual({
      "script-src": [CDN, "'wasm-unsafe-eval'"],
      "connect-src": [CDN],
    });
    expect(cspProblems(spikeCsp("qa30", prodCsp))).toEqual([
      `connect-src allows ${CDN}, which is not on the ADR 0002 allow-list`,
    ]);
  });

  it("ADR-0022: spikeHeaders keeps every other site policy header unchanged", () => {
    for (const kind of ["cheerpj", "qa30"] as const) {
      const headers = spikeHeaders(kind);
      expect(headers["Content-Security-Policy"]).toBe(spikeCsp(kind, prodCsp));
      for (const [name, value] of Object.entries(production)) {
        if (name !== "Content-Security-Policy")
          expect(headers[name], name).toBe(value);
      }
      expect(Object.keys(headers).sort()).toEqual(
        Object.keys(production).sort(),
      );
    }
  });
});

describe("S3 spike: expected diagnostics, pin and jar", () => {
  it("F-007 step 1 ADR-0019: expected-diagnostics.json and the s3-known-error-500 oracle case expect the same error", () => {
    const cases = readFileSync(
      join(REPO_ROOT, "tools/oracle/cases/cases.yaml"),
      "utf8",
    );
    const entry =
      cases.split(/^ {2}- id: /m).find((c) => c.startsWith(FIXTURE_CASE)) ?? "";
    expect(entry).toContain(`errors: ["${expectedMessage(editName(0))}"]`);
    const expected = JSON.parse(
      readFileSync(join(SPIKE_DIR, "expected-diagnostics.json"), "utf8"),
    );
    expect(expected.uri).toBe(FIXTURE_URI);
    expect(expected.diagnostics).toEqual([
      {
        range: {
          start: { line: KNOWN_ERROR_LINE - 1, character: 4 },
          end: { line: KNOWN_ERROR_LINE - 1, character: 21 },
        },
        severity: 1,
        source: "nextflow",
        message: expectedMessage(editName(0)),
      },
    ]);
  });

  it("F-007: readLanguageServerPin reads languageServer from upstream.json and explains a missing file", () => {
    const root = mkdtempSync(join(tmpdir(), "s3-pin-"));
    expect(() => readLanguageServerPin(root)).toThrow(/F-006/);
    expect(() => readLanguageServerPin(root)).toThrow(/S3_LANGUAGE_SERVER_JAR/);
    mkdirSync(join(root, "packages/lang-2610"), { recursive: true });
    const file = join(root, "packages/lang-2610/upstream.json");
    writeFileSync(file, JSON.stringify({ nextflow: { version: "x" } }));
    expect(() => readLanguageServerPin(root)).toThrow(/F-006/);
    const pin = {
      tag: "t1",
      url: "https://example.test/a.jar",
      sha256: "ab".repeat(32),
      commit: "c",
    };
    writeFileSync(file, JSON.stringify({ languageServer: pin }));
    expect(readLanguageServerPin(root)).toEqual({
      tag: "t1",
      url: "https://example.test/a.jar",
      sha256: "ab".repeat(32),
    });
  });

  it("F-007: verifySha256 accepts the expected hash and rejects another, naming both", () => {
    const dir = mkdtempSync(join(tmpdir(), "s3-sha-"));
    const file = join(dir, "x.jar");
    writeFileSync(file, "hello");
    const actual = sha256File(file);
    expect(actual).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(() => verifySha256(file, actual)).not.toThrow();
    const wrong = "0".repeat(64);
    expect(() => verifySha256(file, wrong)).toThrow(
      new RegExp(`${file}.*${wrong}.*${actual}`),
    );
  });
});

describe("S3 spike: config", () => {
  it("F-007 ADR-0022: the root Playwright config never collects the spike, and the spike config collects only *.spike.ts", async () => {
    const spike = (await import("../e2e/s3-spike.config.ts")).default;
    expect(spike.testMatch).toBe("**/*.spike.ts");
    expect(spike.testDir).toBe("s3-spike");
    const names = readdirSync(SPIKE_DIR, { recursive: true, encoding: "utf8" });
    expect(names.some((n) => n.endsWith(".spike.ts"))).toBe(true);
    for (const name of names)
      expect(name, name).not.toMatch(/\.(spec|test)\.[cm]?[jt]sx?$/);
    const root = (await import("../playwright.config.ts")).default;
    expect(root.testMatch).toBeUndefined();
    expect(root.testDir).toBe("e2e");
    const { sandboxProxy } = await import("../e2e/s3-spike.config.ts");
    expect(sandboxProxy({})).toBeUndefined();
    expect(sandboxProxy({ HTTPS_PROXY: "http://127.0.0.1:1" })).toEqual({
      server: "http://127.0.0.1:1",
      bypass: "localhost,127.0.0.1",
    });
  });
});
