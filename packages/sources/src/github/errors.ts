export type GithubErrorKind =
  | "invalid-input"
  | "not-found"
  | "no-such-ref"
  | "empty"
  | "rate-limited"
  | "refused"
  | "truncated"
  | "network"
  | "download"
  | "incomplete"
  | "unexpected"
  | "aborted";

export interface GithubErrorDetail {
  readonly host?: "api" | "raw";
  readonly status?: number | null;
  readonly resetAt?: number | null;
  readonly retryAfterSeconds?: number | null;
  readonly path?: string | null;
}

export class GithubError extends Error {
  readonly kind: GithubErrorKind;
  readonly host: "api" | "raw";
  readonly status: number | null;
  /** Epoch milliseconds when the primary rate limit resets. */
  readonly resetAt: number | null;
  readonly retryAfterSeconds: number | null;
  readonly path: string | null;

  constructor(
    kind: GithubErrorKind,
    message: string,
    detail: GithubErrorDetail = {},
  ) {
    super(message);
    this.name = "GithubError";
    this.kind = kind;
    this.host = detail.host ?? "api";
    this.status = detail.status ?? null;
    this.resetAt = detail.resetAt ?? null;
    this.retryAfterSeconds = detail.retryAfterSeconds ?? null;
    this.path = detail.path ?? null;
  }
}

const number = (res: Response, header: string): number | null => {
  const value = res.headers.get(header);
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** ADR 0009, IO-14: what a non-2xx response means. */
export function errorFromResponse(
  res: Response,
  host: "api" | "raw",
  path: string | null = null,
): GithubError {
  const status = res.status;
  const detail = { host, status, path };
  if (host === "raw") {
    if (status === 429)
      return new GithubError(
        "rate-limited",
        "GitHub is limiting downloads.",
        detail,
      );
    return new GithubError("download", `HTTP ${status}`, detail);
  }
  if (status === 403 || status === 429) {
    const reset = number(res, "x-ratelimit-reset");
    if (number(res, "x-ratelimit-remaining") === 0)
      return new GithubError("rate-limited", "Rate limit used up.", {
        ...detail,
        resetAt: reset === null ? null : reset * 1000,
        retryAfterSeconds: number(res, "retry-after"),
      });
    return new GithubError("refused", "GitHub refused the request.", {
      ...detail,
      retryAfterSeconds: number(res, "retry-after"),
    });
  }
  if (status === 404) return new GithubError("not-found", "Not found.", detail);
  if (status === 409)
    return new GithubError("empty", "Empty repository.", detail);
  if (status === 422)
    return new GithubError("no-such-ref", "No such ref.", detail);
  return new GithubError("unexpected", `HTTP ${status}`, detail);
}
