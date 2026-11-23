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
