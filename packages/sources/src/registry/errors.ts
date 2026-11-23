import type { RegistryErrorCode, RegistryFailure } from "./types.ts";

export class RegistryError extends Error implements RegistryFailure {
  readonly code: RegistryErrorCode;
  readonly url: string;
  readonly status: number | null;
  constructor(
    code: RegistryErrorCode,
    url: string,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.url = url;
    this.status = status;
  }
}

/** A RegistryError as plain data; anything else becomes { code: "network", message }. */
export function toFailure(error: unknown): RegistryFailure {
  if (error instanceof RegistryError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "network",
    message: error instanceof Error ? error.message : String(error),
  };
}

/** `fetch`, rejecting with "timeout" when aborted and "network" otherwise (offline, DNS or CORS). */
export async function request(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  what: string,
): Promise<Response> {
  try {
    return await doFetch(url, init);
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new RegistryError("timeout", url, `${what} timed out.`);
    }
    throw new RegistryError(
      "network",
      url,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** The body of a 2xx JSON response; "http" for any other status, "invalid" for a body that isn't JSON. */
export async function readJson(
  response: Response,
  url: string,
  what: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new RegistryError(
      "http",
      url,
      `${what} request failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new RegistryError(
      "invalid",
      url,
      `${what} has content type "${type}", not JSON.`,
      response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new RegistryError("invalid", url, `${what} is not valid JSON.`);
  }
}
