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
    match: "exact",
    url: "http://www.w3.org/1999/xhtml",
    reason:
      "XHTML namespace URI used by d3-selection in React Flow; an identifier, never fetched",
  },
  {
    match: "exact",
    url: "http://www.w3.org/2000/xmlns/",
    reason:
      "XMLNS namespace URI used by d3-selection in React Flow; an identifier, never fetched",
  },
  {
    match: "exact",
    url: "https://reactflow.dev?utm_source=attribution",
    reason:
      "The React Flow attribution link, shown on the canvas and opened by the user in a new tab; the app never fetches it",
  },
  {
    match: "prefix",
    url: "https://reactflow.dev/",
    reason:
      "Help links in React Flow's error messages; shown as text, never fetched",
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
      "Documentation links kept in the palette data (palette.json `docs`); the app does not fetch them",
  },
  {
    match: "exact",
    url: "https://code.visualstudio.com/docs/editor/codebasics#_multicursor-modifier",
    reason:
      "A docs link in a Monaco settings description (F-208); shown as text, never fetched",
  },
  {
    match: "exact",
    url: "https://code.visualstudio.com/docs/editor/codebasics#_find-and-replace",
    reason:
      "A docs link in a Monaco message (F-208); shown as text, never fetched",
  },
  {
    match: "exact",
    url: "https://github.com/microsoft/monaco-editor#faq",
    reason:
      "A link in a Monaco console warning (F-208); logged as text, never fetched",
  },
  {
    match: "exact",
    url: "https://github.com/microsoft/vscode/issues/new",
    reason:
      "Monaco's product-configuration report-issue URL (F-208); never opened or fetched by the app",
  },
  {
    match: "exact",
    url: "https://github.com/microsoft/vscode/blob/main/LICENSE.txt",
    reason:
      "Monaco's product-configuration licence URL (F-208); never opened or fetched by the app",
  },
  {
    match: "exact",
    url: "https://github.com/markedjs/marked.",
    reason:
      "Text in a marked error message inside Monaco (F-208); never fetched",
  },
  {
    match: "exact",
    url: "https://microsoft.com",
    reason: "Sample markdown in a Monaco string helper (F-208); never fetched",
  },
  {
    match: "exact",
    url: "https://github.com/microsoft/vscode/issues/103170",
    reason:
      "A comment in CSS inside a JavaScript string that Monaco injects for its menus (F-208); never fetched",
  },
];
