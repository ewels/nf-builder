// Markdown to a sanitised DocumentFragment (F-605, FI-30, QA-31, ADR 0048). Raw HTML is rendered and sanitised, as GitHub
// does. Nothing here builds an HTML string for the page: the caller appends the returned fragment. Links, images and
// inputs are rewritten on the fragment, not in DOMPurify hooks, and the preview never makes a request (IO-41).
import createDOMPurify from "dompurify";
import { Marked } from "marked";
import {
  classifyLink,
  isAllowedImageSource,
  MARKDOWN_ATTRIBUTES,
  MARKDOWN_TAGS,
} from "./markdown-policy";

/** A string only this chunk holds, so the chunk tests can find it in built files. */
export const MARKDOWN_PREVIEW_MARKER = "f605-markdown-preview-chunk";

export interface RenderOptions {
  /** The path of the Markdown file, which relative links resolve against. */
  readonly path: string;
  readonly window?: Window;
}

type Purifier = ReturnType<typeof createDOMPurify>;

const marked = new Marked({ gfm: true, breaks: false });
const purifiers = new WeakMap<Window, Purifier>();

function purifierFor(window: Window): Purifier {
  let found = purifiers.get(window);
  if (found === undefined) {
    found = createDOMPurify(
      window as unknown as Parameters<typeof createDOMPurify>[0],
    );
    purifiers.set(window, found);
  }
  return found;
}

/** Renders `text` into a fragment holding only what the policy allows. */
export function renderMarkdown(
  text: string,
  options: RenderOptions,
): DocumentFragment {
  const win = options.window ?? window;
  const html = marked.parse(text, { async: false });
  const fragment = purifierFor(win).sanitize(html, {
    ALLOWED_TAGS: [...MARKDOWN_TAGS],
    ALLOWED_ATTR: [...MARKDOWN_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style", "script", "source"],
    FORBID_ATTR: ["style", "class"],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
  rewriteLinks(fragment, options.path);
  rewriteImages(fragment);
  rewriteInputs(fragment);
  return fragment;
}

function rewriteLinks(fragment: DocumentFragment, from: string): void {
  for (const a of fragment.querySelectorAll("a[href]")) {
    const target = classifyLink(a.getAttribute("href") ?? "", from);
    if (target.kind === "external") {
      a.setAttribute("href", target.url);
      a.setAttribute("rel", "noopener noreferrer");
      if (target.newTab) {
        a.setAttribute("target", "_blank");
        const hidden = a.ownerDocument.createElement("span");
        hidden.className = "visually-hidden";
        hidden.textContent = " (opens in a new tab)";
        a.append(hidden);
      }
      continue;
    }
    a.removeAttribute("href");
    a.removeAttribute("target");
    if (target.kind === "project") {
      a.setAttribute("role", "link");
      a.setAttribute("tabindex", "0");
      a.setAttribute("data-path", target.path);
    }
  }
}

function rewriteImages(fragment: DocumentFragment): void {
  for (const img of fragment.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (isAllowedImageSource(src)) continue;
    const alt = img.getAttribute("alt")?.trim();
    const placeholder = img.ownerDocument.createElement("span");
    placeholder.className = "markdown-image";
    placeholder.setAttribute("title", `Image not shown: ${src}`);
    placeholder.textContent = `[${alt === undefined || alt === "" ? "Image" : alt}]`;
    img.replaceWith(placeholder);
  }
}

function rewriteInputs(fragment: DocumentFragment): void {
  for (const input of fragment.querySelectorAll("input")) {
    if (input.getAttribute("type")?.toLowerCase() !== "checkbox") {
      input.remove();
      continue;
    }
    input.setAttribute("disabled", "");
  }
}

/** The project path of the link an event came from, or null. */
export function projectLinkOf(target: EventTarget | null): string | null {
  if (typeof Element === "undefined" || !(target instanceof Element))
    return null;
  return target.closest("[data-path]")?.getAttribute("data-path") ?? null;
}
