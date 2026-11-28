// Saving bytes as a file in the browser (F-404): a hidden link to a blob URL, clicked once. A sandboxed frame without
// `allow-downloads` ignores the click (ADR 0044); nothing here depends on it succeeding.

/** Immediate revocation cancels the download in some browsers, so the URL lives a minute (F-404). */
const REVOKE_AFTER_MS = 60_000;

export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  doc: Document = document,
  timer: (fn: () => void, ms: number) => void = (fn, ms) => {
    setTimeout(fn, ms);
  },
): void {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
  );
  const link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  timer(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
