// The lean Monaco build (F-208, AR-32, QA-01): the editor core plus the contributions the Code view uses, and none of
// the languages or the TypeScript, CSS, HTML and JSON workers a full import would bring. Only the lazy code-editor
// module imports this one. The internal paths are pinned by the exact version of monaco-editor; tsc fails if one goes.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js";
// Ctrl+M then Tab leaves the editor by keyboard (QA-11); F-701 audits it.
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
// A bundled worker file, so Monaco never falls back to a blob: worker (worker-src 'self', QA-30).
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker({ name: "monaco-editor" }),
};

export const NEXTFLOW_LANGUAGE_ID = "nextflow";

export { monaco };
