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

const BASE_TAG = /<base\b[^>]*>/gi;
const OPEN_TAG = /<[a-z][^>]*>/gi;
const HANDLER_WITH_VALUE = /[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const HANDLER_WITHOUT_VALUE = /[\s/]on[a-z]+(?=[\s/>]|$)/gi;

/**
 * Drops event-handler attributes and base tags from raw HTML in the Markdown. This only keeps the CSP report log quiet:
 * Chromium reports them even when the markup is parsed in an inert document. DOMPurify stays the sanitiser, so a miss
 * here is a blocked and reported attempt, never an executed one.
 */
export function stripNoisyHtml(html: string): string {
  return html
    .replace(BASE_TAG, "")
    .replace(OPEN_TAG, (tag) =>
      tag.replace(HANDLER_WITH_VALUE, "").replace(HANDLER_WITHOUT_VALUE, ""),
    );
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => stripNoisyHtml(text),
  },
});
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
  // Parse into an inert document, not with DOMParser: Chromium reports CSP violations for the untrusted markup when
  // DOMParser parses it, and an inert document runs nothing and has no policy. DOMPurify then cleans the node in place.
  // The document of a template's content has no browsing context, so an img parsed here fetches nothing either.
  const holder = win.document.implementation
    .createHTMLDocument("")
    .createElement("template").content;
  const inert = holder.ownerDocument;
  const range = inert.createRange();
  range.selectNodeContents(holder);
  const root = inert.createElement("div");
  root.append(range.createContextualFragment(html));
  purifierFor(win).sanitize(root, {
    ALLOWED_TAGS: [...MARKDOWN_TAGS],
    ALLOWED_ATTR: [...MARKDOWN_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style", "script", "source"],
    FORBID_ATTR: ["style", "class"],
    IN_PLACE: true,
  });
  rewriteLinks(root, options.path);
  rewriteImages(root);
  rewriteInputs(root);
  const fragment = win.document.createDocumentFragment();
  for (const child of root.childNodes) {
    fragment.append(win.document.importNode(child, true));
  }
  return fragment;
}

function rewriteLinks(fragment: ParentNode, from: string): void {
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

function rewriteImages(fragment: ParentNode): void {
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

function rewriteInputs(fragment: ParentNode): void {
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
