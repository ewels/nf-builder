import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One recorded response. Text bodies are inline; binary bodies are files next to `requests.json`. */
interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
  bodyFile?: string;
}
type Recording = Record<string, RecordedResponse>;

const KEPT_HEADERS =
  /^(content-type|location|x-nf-module-checksum|ratelimit-.*)$/;
const REQUESTS = "requests.json";

const keyOf = (input: string | URL | Request): string =>
  `GET ${typeof input === "object" && "url" in input ? input.url : String(input)}`;
const isText = (type: string): boolean =>
  /^(application\/json|text\/)/.test(type);

/** Wraps `inner` and writes every response into `dir` (`requests.json` plus binary bodies), for later replay. */
export function recordingFetch(
  dir: string,
  inner: typeof fetch = globalThis.fetch,
): typeof fetch {
  mkdirSync(dir, { recursive: true });
  const recording: Recording = {};
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await inner(input, init);
    const headers: Record<string, string> = {};
    for (const [name, value] of response.headers)
      if (KEPT_HEADERS.test(name)) headers[name] = value;
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const entry: RecordedResponse = { status: response.status, headers };
    if (isText(headers["content-type"] ?? "") || bytes.length === 0)
      entry.body = new TextDecoder().decode(bytes);
    else {
      entry.bodyFile = `blob-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bin`;
      writeFileSync(join(dir, entry.bodyFile), bytes);
    }
    recording[keyOf(input)] = entry;
    const sorted = Object.fromEntries(
      Object.entries(recording).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    writeFileSync(join(dir, REQUESTS), `${JSON.stringify(sorted, null, 1)}\n`);
    return response;
  }) as typeof fetch;
}

/** Serves the responses recorded in `dir`. A URL that was not recorded throws, naming it. */
export function replayFetch(
  dir: string,
): typeof fetch & { readonly requested: readonly string[] } {
  const recording = JSON.parse(
    readFileSync(join(dir, REQUESTS), "utf8"),
  ) as Recording;
  const requested: string[] = [];
  const replay = (async (input: string | URL | Request) => {
    const key = keyOf(input);
    const url = key.slice(4);
    requested.push(url);
    const entry = recording[key];
    if (!entry) throw new Error(`replay: no recorded response for ${url}`);
    const body = entry.bodyFile
      ? new Uint8Array(readFileSync(join(dir, entry.bodyFile)))
      : (entry.body ?? "");
    return new Response(body, { status: entry.status, headers: entry.headers });
  }) as typeof fetch & { requested: readonly string[] };
  Object.defineProperty(replay, "requested", { get: () => requested });
  return replay;
}
