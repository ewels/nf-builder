import { readFileSync } from "node:fs";
import type { RegistryError } from "../src/index";

const GOLDEN_URL = new URL(
  "../../../tools/registry-snapshot/test/fixtures/expected/registry/index.json",
  import.meta.url,
);
export const goldenText = (): string => readFileSync(GOLDEN_URL, "utf8");
export const golden = (): Record<string, unknown> =>
  JSON.parse(goldenText()) as Record<string, unknown>;

const PORTS_URL = new URL(
  "../../../tools/registry-snapshot/test/fixtures/expected/registry/ports.json",
  import.meta.url,
);
export const portsText = (): string => readFileSync(PORTS_URL, "utf8");
export const portsGolden = (): Record<string, unknown> =>
  JSON.parse(portsText()) as Record<string, unknown>;

export const SNAPSHOT_URL = "https://site.test/app/registry/";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** A fake fetch that records calls. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export const jsonResponse = (
  body: string,
  contentType = "application/json; charset=utf-8",
  status = 200,
) => new Response(body, { status, headers: { "content-type": contentType } });

/** The error `p` rejects with; throws if it resolves. */
export async function rejection(p: Promise<unknown>): Promise<RegistryError> {
  try {
    await p;
  } catch (e) {
    return e as RegistryError;
  }
  throw new Error("expected rejection");
}

export const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/live/${name}`, import.meta.url), "utf8");

/** Serves the snapshot and the live fixtures. */
export function serve(
  overrides: (url: string) => Response | undefined = () => undefined,
) {
  return fakeFetch((url) => {
    const o = overrides(url);
    if (o) return o;
    if (url === `${SNAPSHOT_URL}ports.json`) return jsonResponse(portsText());
    if (url.startsWith(SNAPSHOT_URL)) return jsonResponse(goldenText());
    if (url.includes("/modules/list") && url.includes("kind=Process"))
      return jsonResponse(fixture("modules-process-1.json"));
    if (url.includes("/modules/list") && url.includes("kind=Workflow"))
      return jsonResponse(fixture("modules-workflow-1.json"));
    if (url.includes("/plugins"))
      return jsonResponse(fixture("plugins-1.json"));
    return jsonResponse("{}", "application/json", 404);
  });
}
