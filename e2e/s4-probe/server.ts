import type { APIRequestContext } from "@playwright/test";
import {
  type Hop,
  nextOrigin,
  type Preflight,
  pickHeaders,
  type ServerResult,
} from "./report.ts";

const MAX_HOPS = 5;
const TIMEOUT_MS = 20_000;
// First line only: Playwright appends a call log.
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

async function preflight(
  request: APIRequestContext,
  url: string,
  origin: string,
): Promise<Preflight> {
  try {
    const response = await request.fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: TIMEOUT_MS,
    });
    return {
      status: response.status(),
      headers: pickHeaders(response.headers()),
    };
  } catch (error) {
    return { error: message(error) };
  }
}

/** GET with Origin: pageOrigin, following Location by hand, then an OPTIONS preflight on the first URL. Never throws. */
export async function probeServer(
  request: APIRequestContext,
  url: string,
  pageOrigin: string,
): Promise<ServerResult> {
  const hops: Hop[] = [];
  let error: string | undefined;
  let current = url;
  let origin = pageOrigin;
  for (let i = 0; i < MAX_HOPS; i++) {
    const started = performance.now();
    try {
      const response = await request.get(current, {
        headers: { Origin: origin },
        maxRedirects: 0,
        failOnStatusCode: false,
        timeout: TIMEOUT_MS,
      });
      const headers = pickHeaders(response.headers());
      hops.push({
        url: current,
        sentOrigin: origin,
        status: response.status(),
        durationMs: Math.round((performance.now() - started) * 10) / 10,
        headers,
      });
      const location = headers.location;
      if (response.status() < 300 || response.status() >= 400 || !location)
        break;
      const next = new URL(location, current).href;
      origin = nextOrigin(pageOrigin, current, next, origin);
      current = next;
    } catch (e) {
      error = message(e);
      break;
    }
  }
  return {
    hops,
    preflight: await preflight(request, url, pageOrigin),
    error,
  };
}
