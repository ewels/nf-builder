// Where focus goes when a project dialog closes (F-203, WCAG 2.4.3).

/**
 * The element to focus once a dialog has gone: the one that opened it if it is still on the page and is a real target,
 * else `fallback`. WebKit doesn't focus a button on a mouse click, so the recorded opener can be `<body>`; focusing
 * that would drop the user at the top of the page.
 */
export function focusTarget(
  opener: HTMLElement | null,
  fallback: HTMLElement | null,
): HTMLElement | null {
  const usable =
    opener !== null &&
    opener.isConnected &&
    opener !== opener.ownerDocument.body;
  return usable ? opener : fallback;
}
