export * from "./config.ts";
export type {
  ConfigParseResult,
  ParseProblem,
  ParseResult,
  ScriptParseResult,
} from "./parse-result.ts";
export type {
  Comment,
  CommentKind,
  CommentSlots,
  NodeBase,
  Position,
  Range,
} from "./range.ts";
export * from "./script.ts";
export type { DeclarationHead, Unparsed } from "./unparsed.ts";
export { type AstNode, childNodes, walk } from "./walk.ts";
