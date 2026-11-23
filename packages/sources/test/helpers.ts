import { readFileSync } from "node:fs";

export const GOLDEN_URL = new URL(
  "../../../tools/registry-snapshot/test/fixtures/expected/registry/index.json",
  import.meta.url,
);
export const goldenText = (): string => readFileSync(GOLDEN_URL, "utf8");
export const golden = (): Record<string, unknown> =>
  JSON.parse(goldenText()) as Record<string, unknown>;

export const SNAPSHOT_URL = "https://site.test/app/registry/";

export interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export type Handler = (
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
