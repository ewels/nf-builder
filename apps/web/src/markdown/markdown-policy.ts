// What a Markdown preview may contain (F-605, FI-30, QA-31, ADR 0048): pure rules with no DOM and no dependencies.

/** Elements that survive sanitising: none runs code, loads anything, submits or restyles. */
export const MARKDOWN_TAGS: readonly string[] = [
  ..."a abbr b blockquote br caption cite code col colgroup dd del details dfn div dl dt em h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var".split(
    " ",
  ),
];

/** Attributes that survive: no style, class, event handler or attribute that makes the browser fetch. */
export const MARKDOWN_ATTRIBUTES: readonly string[] = [
  ..."href title alt src align colspan rowspan scope open checked disabled type start reversed id name lang dir width height".split(
    " ",
  ),
];

export type LinkTarget =
  | {
      readonly kind: "external";
      readonly url: string;
      readonly newTab: boolean;
    }
  | { readonly kind: "project"; readonly path: string }
  | {
      readonly kind: "inert";
      readonly reason: "fragment" | "scheme" | "outside" | "empty";
    };

// browsers drop tabs and newlines inside a URL and ignore leading control characters and spaces
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is exactly what is being removed
const IGNORED = /[\u0000- ]/g;

/** Sorts a link by where it goes: out of the app, to a project file, or nowhere. */
export function classifyLink(href: string, from: string): LinkTarget {
  const trimmed = href.trim();
  if (trimmed === "") return { kind: "inert", reason: "empty" };
  const squeezed = trimmed.replace(IGNORED, "");
  if (squeezed.startsWith("#")) return { kind: "inert", reason: "fragment" };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(squeezed)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") {
    return { kind: "external", url: trimmed, newTab: true };
  }
  if (scheme === "mailto") {
    return { kind: "external", url: trimmed, newTab: false };
  }
  if (
    scheme !== undefined ||
    squeezed.startsWith("//") ||
    squeezed.startsWith("\\\\")
  ) {
    return { kind: "inert", reason: "scheme" };
  }
  const path = resolveProjectPath(from, trimmed);
  return path === null
    ? { kind: "inert", reason: "outside" }
    : { kind: "project", path };
}

/** A relative link resolved against the folder of `from`; null when it is empty or leaves the project. */
export function resolveProjectPath(from: string, href: string): string | null {
  const bare = href.replace(/[?#].*$/s, "");
  if (bare === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const rooted = decoded.startsWith("/");
  const segments: string[] = rooted ? [] : from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else segments.push(part);
  }
  return segments.length === 0 ? null : segments.join("/");
}

/** Only an image carried in the link itself is shown, so the preview never makes a request (IO-41). */
export function isAllowedImageSource(src: string): boolean {
  return /^data:image\/(png|gif|jpeg|webp|avif|svg\+xml)[;,]/i.test(src.trim());
}
