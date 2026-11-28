import {
  type RefCallback,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Rows rendered at a time in each registry list (UX-14). */
export const REGISTRY_PAGE = 100;

export function nextLimit(
  limit: number,
  total: number,
  page: number = REGISTRY_PAGE,
): number {
  return Math.min(limit + page, total);
}

export function windowOf<T>(
  rows: readonly T[],
  limit: number,
): { shown: readonly T[]; remaining: number } {
  return {
    shown: rows.length > limit ? rows.slice(0, limit) : rows,
    remaining: Math.max(0, rows.length - limit),
  };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

/**
 * The number of rows to show, starting at one page and growing a page at a time, reset when `resetKey` changes.
 * `sentinelRef` goes on the "Show more" button: it grows the window when scrolled into view (200 px early), and
 * again after each growth while it stays in view. Growth runs in a transition so typing and scrolling interrupt it.
 */
export function useLazyWindow(
  total: number,
  resetKey: unknown,
): { limit: number; more: () => void; sentinelRef: RefCallback<HTMLElement> } {
  const [state, setState] = useState({ key: resetKey, limit: REGISTRY_PAGE });
  const limit = state.key === resetKey ? state.limit : REGISTRY_PAGE;
  const more = useCallback(() => {
    startTransition(() =>
      setState((s) => ({
        key: resetKey,
        limit: nextLimit(s.key === resetKey ? s.limit : REGISTRY_PAGE, total),
      })),
    );
  }, [resetKey, total]);

  const moreRef = useRef(more);
  moreRef.current = more;
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  // A new callback identity per limit re-observes the (new) sentinel, so a tall viewport keeps loading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: limit is the re-observe trigger
  const sentinelRef = useCallback<RefCallback<HTMLElement>>(
    (el) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) moreRef.current();
        },
        { root: scrollParent(el), rootMargin: "0px 0px 200px 0px" },
      );
      observer.current.observe(el);
    },
    [limit],
  );
  return { limit, more, sentinelRef };
}
