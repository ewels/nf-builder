/**
 * Absolute URLs that appear in the built app but are never fetched, so the IO-41 host scan skips them.
 * This is NOT the runtime allow-list (scripts/allow-list.ts) and grants no network access; the CSP still blocks them.
 * Add an entry only for a URL the app never requests: an XML namespace identifier, a docs link in an error
 * message, or (later) a link the user opens in a new tab. Give the reason; prefer "exact" or the narrowest prefix.
 */
export type NonFetchedUrl = {
  match: "exact" | "prefix";
  url: string;
  reason: string;
};

export const NON_FETCHED_URLS: readonly NonFetchedUrl[] = [
  {
    match: "exact",
    url: "http://www.w3.org/2000/svg",
    reason: "SVG namespace URI used by React DOM; an identifier, never fetched",
  },
  {
    match: "exact",
    url: "http://www.w3.org/1999/xlink",
    reason: "XLink namespace URI used by React DOM",
  },
  {
    match: "exact",
    url: "http://www.w3.org/1998/Math/MathML",
    reason: "MathML namespace URI used by React DOM",
  },
  {
    match: "exact",
    url: "http://www.w3.org/XML/1998/namespace",
    reason: "XML namespace URI used by React DOM",
  },
  {
    match: "prefix",
    url: "https://react.dev/errors/",
    reason:
      "React production error messages link to their explanation; shown as text, never fetched",
  },
  {
    match: "prefix",
    url: "https://docs.seqera.io/nextflow/",
    reason:
      "Documentation links in the palette (palette.json `docs`); shown as links for the user to open, never fetched by the app",
  },
];
