export const SNIFF_BYTES = 8000;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The text of a file, or null when it is binary (a NUL early on, or invalid UTF-8). */
export function decodeText(bytes: Uint8Array): string | null {
  const head = Math.min(bytes.length, SNIFF_BYTES);
  for (let i = 0; i < head; i += 1) if (bytes[i] === 0) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}
