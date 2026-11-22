// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/Formatter.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE), over our script AST (plan F-110 4.1). The method
// order follows upstream; the line numbers in the comments are upstream's (Formatter.java at v26.10.7). Left out:
// `CommentAligner`, which does nothing without Harshil alignment, and the Harshil and tab options (4 spaces, LF).
import {
  type Argument,
  type AstNode,
  type CallExpr,
  type CatchClause,
  type Closure,
  type Comment,
  type Expression,
  type FormalParameter,
  hasPosition,
  type IfStatement,
  type LegacyType,
  type MapEntry,
  type MethodCall,
  type NamedArgument,
  PrintError,
  type SourceLayout,
  type Statement,
  type TypeRef,
} from "@nf-builder/lang-core";
import { commentText } from "./comments.ts";
import { FRESH_LAYOUT } from "./layout.ts";
import {
  argumentsLastLine,
  column,
  lastLine,
  line,
  methodLine,
} from "./positions.ts";
import {
  catchTypeName,
  hasLegacyType,
  hasType,
  legacyTypeText,
  NAMESPACES,
  typeName,
} from "./types.ts";

const TAB_SIZE = 4;

/** The arguments of a call as upstream lists them: the named ones as one group first, then the others, then closures. */
type ArgItem = Expression | readonly NamedArgument[];

const isGroup = (item: unknown): item is readonly NamedArgument[] =>
  Array.isArray(item);

const isNamed = (arg: Argument): arg is NamedArgument =>
  arg.kind === "NamedArgument";

const unparen = (expr: Expression): Expression => {
  let result = expr;
  while (result.kind === "Parenthesized") result = result.expression;
  return result;
};

/** A call that is a link of a method chain: one with an explicit receiver (upstream `!isImplicitThis()`). */
const isLink = (expr: Expression): expr is MethodCall | CallExpr =>
  (expr.kind === "MethodCall" && expr.receiver !== null) ||
  expr.kind === "Call";

const receiverOf = (call: MethodCall | CallExpr): Expression | null =>
  call.kind === "MethodCall" ? call.receiver : call.callee;

const isTripleQuoted = (text: string) =>
  text.startsWith('"""') || text.startsWith("'''");

const lines = (text: string) => text.replace(/\r\n?/g, "\n");

export class Formatter {
  /** The comments the formatter wrote (upstream `CommentAttacher.markEmitted`). */
  readonly emitted = new Set<Comment>();

  private buffer = "";
  private indentCount = 0;
  private stringIndentDelta = 0;
  private currentRootExpr: Expression | null = null;
  private inWrappedMethodChain = false;

  constructor(private readonly layout: SourceLayout = FRESH_LAYOUT) {}

  toString(): string {
    return this.buffer;
  }

  /** What has been written so far; the declaration visitor needs to know whether anything is there (L211). */
  get length(): number {
    return this.buffer.length;
  }

  append(text: string): void {
    this.buffer += text;
  }

  appendIndent(): void {
    this.buffer += " ".repeat(TAB_SIZE * this.indentCount);
  }

  appendNewLine(): void {
    this.buffer += "\n";
  }

  incIndent(): void {
    this.indentCount++;
  }

  decIndent(): void {
    this.indentCount--;
  }

  // L117: comments

  /**
   * Append the comments that precede a node, along with any blank lines that separate them from each other and from the
   * node (L123).
   */
  appendLeadingComments(node: AstNode | null): void {
    if (node === null) return;
    for (const comment of node.leadingComments ?? []) {
      this.appendBlankLines(comment.range.line);
      this.appendComment(comment);
    }
    this.appendBlankLines(line(node));
  }

  /** The comments that precede a node printed after a fixed prefix, such as an `else` keyword (L139). */
  appendCommentsBefore(node: AstNode): void {
    for (const comment of node.leadingComments ?? [])
      this.appendComment(comment);
  }

  /** The comments that belong to a construct but not to any child, e.g. one before a closing brace (L150). */
  appendDanglingComments(node: AstNode): void {
    for (const comment of node.danglingComments ?? []) {
      this.appendBlankLines(comment.range.line);
      this.appendComment(comment);
    }
  }

  hasTrailingComment(node: AstNode): boolean {
    return (node.trailingComments ?? []).length > 0;
  }

  appendTrailingComment(node: AstNode): void {
    for (const comment of node.trailingComments ?? []) {
      this.emitted.add(comment);
      this.append(" ");
      this.append(commentText(comment).replaceAll("\n", " "));
    }
  }

  private hasComments(node: AstNode): boolean {
    return (
      (node.leadingComments ?? []).length > 0 ||
      (node.trailingComments ?? []).length > 0 ||
      (node.danglingComments ?? []).length > 0
    );
  }

  /** L210: the blank lines that precede `line` in the source. Nothing before the first output. */
  private appendBlankLines(line: number): void {
    if (this.buffer.length === 0) return;
    const count = this.layout.blankLinesBefore(line);
    for (let i = 0; i < count; i++) this.appendNewLine();
  }

  /** L218 */
  private appendComment(comment: Comment): void {
    this.emitted.add(comment);
    const parts = commentText(comment).split("\n");
    for (const [i, part] of parts.entries()) {
      const text = part.trim();
      this.appendIndent();
      // preserve the canonical alignment of a block comment
      if (i > 0 && text.startsWith("*")) this.append(" ");
      this.append(text);
      this.appendNewLine();
    }
  }

  // L232: string re-indentation

  /**
   * Begin a statement, recording how far its indentation moved from the source. A multi-line string inside it is shifted
   * by the same amount. Only a statement that begins its own source line has an indentation to compare (L246).
   */
  beginStatement(node: AstNode): number {
    const previous = this.stringIndentDelta;
    this.stringIndentDelta =
      hasPosition(node.range) &&
      this.layout.startsLine(line(node), column(node))
        ? TAB_SIZE * this.indentCount - (column(node) - 1)
        : 0;
    return previous;
  }

  endStatement(previous: number): void {
    this.stringIndentDelta = previous;
  }

  /**
   * Shift the interior lines of a multi-line string by the indentation shift of the statement that contains it. Blank
   * lines are left alone, and a line is never shifted past its first non-whitespace character (L263).
   */
  private reindentString(raw: string): string {
    const text = lines(raw);
    const delta = this.stringIndentDelta;
    if (delta === 0 || !text.includes("\n")) return text;
    const parts = text.split("\n");
    let result = parts[0] as string;
    for (const part of parts.slice(1)) {
      result += "\n";
      if (part === "") continue;
      if (delta > 0) {
        result += " ".repeat(delta) + part;
      } else {
        let strip = 0;
        while (strip < -delta && strip < part.length && part[strip] === " ")
          strip++;
        result += part.slice(strip);
      }
    }
    return result;
  }

  // L302: statements

  /** The statements of a block, then the comments left dangling in it (L305). */
  statements(nodes: readonly Statement[], danglingOwner: AstNode | null): void {
    for (const node of nodes) this.statement(node);
    if (danglingOwner !== null) this.appendDanglingComments(danglingOwner);
  }

  statement(node: Statement): void {
    switch (node.kind) {
      case "Block":
        this.statements(node.statements, node);
        return;
      case "ExpressionStatement":
        this.simpleStatement(node, unparen(node.expression), () =>
          this.expression(node.expression),
        );
        return;
      case "VariableDeclaration":
        this.simpleStatement(node, null, () => this.variableDeclaration(node));
        return;
      case "Assignment":
        this.simpleStatement(node, null, () => this.assignment(node));
        return;
      case "If":
        this.ifElse(node, true);
        return;
      case "TryCatch":
        this.tryCatch(node);
        return;
      case "Return": {
        // a bare `return` is `return null`
        const value = node.value;
        this.simpleStatement(
          node,
          value && unparen(value),
          () => {
            this.append("return ");
            if (value) this.expression(value);
            else this.append("null");
          },
          false,
        );
        return;
      }
      case "Throw":
        this.simpleStatement(
          node,
          null,
          () => {
            this.append("throw ");
            this.expression(node.value);
          },
          false,
        );
        return;
      case "Assert":
        this.simpleStatement(
          node,
          null,
          () => {
            this.append("assert ");
            this.expression(node.condition);
            if (node.message) {
              this.append(" : ");
              this.expression(node.message);
            }
          },
          false,
        );
        return;
      case "EmptyStatement":
        return;
    }
  }

  /** L358 (`visitExpressionStatement`) and the statements that share its shape (return L382, assert L397, throw L430). */
  private simpleStatement(
    node: Statement,
    root: Expression | null,
    body: () => void,
    labelled = true,
  ): void {
    const cre = this.currentRootExpr;
    this.currentRootExpr = root;
    this.appendLeadingComments(node);
    this.appendIndent();
    const sid = this.beginStatement(node);
    if (labelled) this.statementLabels(node);
    body();
    this.endStatement(sid);
    this.appendTrailingComment(node);
    this.appendNewLine();
    this.currentRootExpr = cre;
  }

  /** L372 */
  private statementLabels(node: Statement): void {
    for (const label of node.labels ?? []) {
      this.append(label.name);
      this.append(": ");
    }
  }

  /** The expression a statement is made of, as upstream's `ExpressionStatement.getExpression()`. */
  private statementExpression(node: Statement): void {
    switch (node.kind) {
      case "ExpressionStatement":
        this.expression(node.expression);
        return;
      case "VariableDeclaration":
        this.variableDeclaration(node);
        return;
      case "Assignment":
        this.assignment(node);
        return;
      default:
        throw new PrintError(`not an expression statement: ${node.kind}`, node);
    }
  }

  /** `DeclarationExpression` (L594) */
  private variableDeclaration(
    node: Extract<Statement, { kind: "VariableDeclaration" }>,
  ): void {
    this.append("def ");
    if (node.multiple) {
      this.append("(");
      for (const [i, target] of node.targets.entries()) {
        if (i > 0) this.append(", ");
        this.append(target.name.name);
        if (hasType(target.type)) {
          this.append(": ");
          this.typeAnnotation(target.type);
        }
      }
      this.append(")");
    } else {
      const target = node.targets[0];
      if (target) {
        this.append(target.name.name);
        if (hasLegacyType(node.legacyType)) {
          this.append(": ");
          this.legacyTypeAnnotation(node.legacyType);
        } else if (hasType(target.type)) {
          this.append(": ");
          this.typeAnnotation(target.type);
        }
      }
    }
    if (node.initializer) {
      this.append(" = ");
      this.withRoot(node.initializer, () =>
        this.expression(node.initializer as Expression),
      );
    }
  }

  /** The assignment case of `visitBinaryExpression` (L618-L633) */
  private assignment(node: Extract<Statement, { kind: "Assignment" }>): void {
    if (node.target.kind === "TupleTarget") {
      this.append("(");
      this.append(node.target.names.map((n) => n.name).join(", "));
      this.append(")");
    } else {
      this.expression(node.target);
    }
    this.append(` ${node.operator} `);
    this.withRoot(node.value, () => this.expression(node.value));
  }

  private withRoot(root: Expression, body: () => void): void {
    const cre = this.currentRootExpr;
    this.currentRootExpr = unparen(root);
    body();
    this.currentRootExpr = cre;
  }

  /** L315 */
  private ifElse(node: IfStatement, preIndent: boolean): void {
    // an `else if` is printed by its parent, which has already emitted the comments that precede it
    if (preIndent) {
      this.appendLeadingComments(node);
      this.appendIndent();
    }
    this.append("if (");
    this.expression(unparen(node.condition));
    this.append(") {\n");
    this.incIndent();
    this.branch(node.consequent);
    this.decIndent();
    this.appendIndent();
    this.append("}");
    const elseBlock = node.alternate;
    if (elseBlock?.kind === "If") {
      this.appendTrailingComment(node);
      this.appendNewLine();
      this.appendCommentsBefore(elseBlock);
      this.appendIndent();
      this.append("else ");
      this.ifElse(elseBlock, false);
      return;
    }
    if (elseBlock && elseBlock.kind !== "EmptyStatement") {
      this.appendNewLine();
      this.appendCommentsBefore(elseBlock);
      this.appendIndent();
      this.append("else {\n");
      this.incIndent();
      this.branch(elseBlock);
      this.decIndent();
      this.appendIndent();
      this.append("}");
    }
    this.appendTrailingComment(node);
    this.appendNewLine();
  }

  /** `visit(ifBlock)`: a braced branch prints its statements and then its dangling comments; any other, itself. */
  private branch(node: Statement): void {
    this.statement(node);
  }

  /** L413 */
  private tryCatch(node: Extract<Statement, { kind: "TryCatch" }>): void {
    this.appendLeadingComments(node);
    this.appendIndent();
    this.append("try {\n");
    this.incIndent();
    this.branch(node.body);
    this.decIndent();
    this.appendIndent();
    this.append("}");
    this.appendTrailingComment(node);
    this.appendNewLine();
    for (const clause of node.catches) this.catchClause(clause);
  }

  /** L442: one `catch` per type of a multi-catch; the comments of the clause go with the first. */
  private catchClause(clause: CatchClause): void {
    const types: (TypeRef | null)[] =
      clause.types.length > 0 ? [...clause.types] : [null];
    for (const [i, type] of types.entries()) {
      if (i === 0) this.appendLeadingComments(clause);
      else this.appendBlankLines(line(clause));
      this.appendIndent();
      this.append(`catch (${clause.variable.name}`);
      if (hasType(type)) {
        this.append(": ");
        this.append(catchTypeName(type));
      }
      this.append(") {\n");
      this.incIndent();
      this.branch(clause.body);
      this.decIndent();
      this.appendIndent();
      this.append("}");
      if (i === types.length - 1) this.appendTrailingComment(clause);
      this.appendNewLine();
    }
  }

  // L464: expressions

  expression(node: Expression): void {
    switch (node.kind) {
      case "Variable":
        this.append(node.name);
        return;
      case "Number":
        this.append(node.text);
        return;
      case "String":
        this.append(
          isTripleQuoted(node.text)
            ? this.reindentString(node.text)
            : lines(node.text),
        );
        return;
      case "Boolean":
        this.append(node.value ? "true" : "false");
        return;
      case "Null":
        this.append("null");
        return;
      case "GString":
        this.gstring(node);
        return;
      case "List":
        this.list(node);
        return;
      case "Map":
        this.map(node);
        return;
      case "Closure":
        this.closure(node);
        return;
      case "Property":
        this.expression(node.object);
        this.append(node.navigation);
        this.append(
          node.property.kind === "Identifier"
            ? node.property.name
            : lines(node.property.text),
        );
        return;
      case "Index":
        this.expression(node.object);
        this.append("[");
        if (node.indices.length === 1) {
          this.expression(node.indices[0] as Expression);
        } else {
          // several indices are one list
          this.append("[");
          this.positionalArgs(node.indices, false);
          this.append("]");
        }
        this.append("]");
        return;
      case "MethodCall":
      case "Call":
        this.methodCall(node);
        return;
      case "New":
        this.append("new ");
        this.typeAnnotation(node.type);
        this.append("(");
        this.arguments(this.argItems(node), false);
        this.append(")");
        return;
      case "Unary":
        this.append(node.operator);
        this.expression(node.operand);
        return;
      case "Binary":
        this.expression(node.left);
        if (node.operator === ".." || node.operator === "..<") {
          // L828: a range has no spaces
          this.append(node.operator);
        } else {
          this.append(` ${node.operator} `);
        }
        this.expression(node.right);
        return;
      case "Cast":
        this.expression(node.operand);
        this.append(" as ");
        this.typeAnnotation(node.type);
        return;
      case "TypeTest":
        this.expression(node.operand);
        this.append(` ${node.operator} `);
        this.typeAnnotation(node.type);
        return;
      case "Ternary":
        this.ternary(node);
        return;
      case "Elvis":
        this.expression(node.condition);
        this.append(" ?: ");
        this.expression(node.alternate);
        return;
      case "Parenthesized":
        // Groovy records the parentheses as a level on the inner expression, and prints them once however deep
        this.append("(");
        this.expression(unparen(node));
        this.append(")");
        return;
      case "IncompleteExpression":
        throw new PrintError("incomplete expression", node);
    }
  }

  /** L469 (`visitMethodCallExpression`); a `CallExpr` is upstream's synthetic `.call`. */
  private methodCall(node: MethodCall | CallExpr): void {
    const beginWrappedMethodChain = this.shouldWrapMethodChain(node);
    if (beginWrappedMethodChain) this.inWrappedMethodChain = true;

    const receiver = receiverOf(node);
    if (receiver !== null) {
      this.expression(receiver);
      if (this.inWrappedMethodChain) {
        const receiverComment = this.hasTrailingComment(receiver);
        this.appendTrailingComment(receiver);
        this.incIndent();
        const linkComments = node.leadingComments ?? [];
        // a namespace receiver stays on the same line, unless a comment needs a line of its own
        const target = unparen(receiver);
        const namespace =
          target.kind === "Variable" && NAMESPACES.has(target.name);
        if (!namespace || linkComments.length > 0 || receiverComment) {
          this.appendNewLine();
          for (const comment of linkComments) this.appendComment(comment);
          this.appendIndent();
        }
      }
      if (node.kind === "MethodCall" && node.navigation !== null) {
        this.append(node.navigation);
      } else {
        this.append(".");
      }
    }

    if (node.kind === "MethodCall") {
      this.append(
        node.method.kind === "Identifier"
          ? node.method.name
          : lines(node.method.text),
      );
    } else {
      this.append("call");
    }

    const iwmc = this.inWrappedMethodChain;
    this.inWrappedMethodChain = false;
    const items = this.argItems(node);
    const last = items[items.length - 1];
    const lastClosureArg =
      last !== undefined && !isGroup(last) && last.kind === "Closure";
    const parenArgs = lastClosureArg ? items.slice(0, -1) : items;
    if (parenArgs.length > 0 || !lastClosureArg) {
      const wrap =
        this.shouldWrapMethodCall(node) || this.hasCommentsIn(node, parenArgs);
      this.append("(");
      if (wrap) this.incIndent();
      this.arguments(parenArgs, wrap);
      if (wrap) {
        this.appendNewLine();
        this.appendDanglingComments(node);
        this.decIndent();
        this.appendIndent();
      }
      this.append(")");
    }
    if (lastClosureArg) {
      this.append(" ");
      this.expression(last as Expression);
    }
    this.inWrappedMethodChain = iwmc;

    if (receiver !== null && this.inWrappedMethodChain) this.decIndent();
    if (beginWrappedMethodChain) this.inWrappedMethodChain = false;
  }

  /** L546 (`visitDirective`): a call printed as a command call, `name args`. */
  directive(owner: AstNode, call: MethodCall): void {
    this.appendIndent();
    const sid = this.beginStatement(owner);
    this.append(
      call.method.kind === "Identifier" ? call.method.name : call.method.value,
    );
    const items = this.argItems(call);
    if (items.length > 0) {
      const wrap = this.hasCommentsIn(call, items);
      if (wrap) this.incIndent();
      else this.append(" ");
      const start = this.buffer.length;
      this.arguments(items, wrap);
      // `name [...]` would be parsed as an index expression
      if (!wrap && this.buffer[start] === "[") {
        this.buffer = `${this.buffer.slice(0, start - 1)}(${this.buffer.slice(start)})`;
      }
      if (wrap) {
        this.appendNewLine();
        this.appendDanglingComments(call);
        this.decIndent();
        this.appendIndent();
      }
    }
    this.endStatement(sid);
    this.appendTrailingComment(owner);
    this.appendNewLine();
  }

  /** The arguments of a call in upstream's order: the named ones first as one group, then the rest, then the closures. */
  private argItems(node: {
    readonly args: readonly Argument[];
    readonly closures?: readonly Closure[];
  }): ArgItem[] {
    const named = node.args.filter(isNamed);
    const positional = node.args.filter((a): a is Expression => !isNamed(a));
    return [
      ...(named.length > 0 ? [named] : []),
      ...positional,
      ...(node.closures ?? []),
    ];
  }

  /** L576 (`visitArguments`) */
  arguments(items: readonly ArgItem[], wrap: boolean): void {
    const first = items[0];
    const named = first !== undefined && isGroup(first) ? first : null;
    const positional = (named ? items.slice(1) : items) as Expression[];
    this.positionalArgs(positional, wrap);
    if (named) {
      if (positional.length > 0) this.append(wrap ? "," : ", ");
      this.namedArgs(named, wrap);
    }
  }

  /** L592 (`visitBinaryExpression`) is in `statement`; this is L637 (`visitTernaryExpression`). */
  private ternary(node: Extract<Expression, { kind: "Ternary" }>): void {
    if (this.shouldWrapExpression(node)) {
      this.expression(node.condition);
      this.incIndent();
      this.appendNewLine();
      this.appendIndent();
      this.append("? ");
      this.expression(node.consequent);
      this.appendNewLine();
      this.appendIndent();
      this.append(": ");
      this.expression(node.alternate);
      this.decIndent();
    } else {
      this.expression(node.condition);
      this.append(" ? ");
      this.expression(node.consequent);
      this.append(" : ");
      this.expression(node.alternate);
    }
  }

  /** L679 (`visitClosureExpression`) */
  private closure(node: Closure): void {
    this.append("{");
    if (node.params !== null && node.params.length > 0) {
      this.append(" ");
      this.parameters(node.params);
      this.append(" ->");
    }
    const dangling = node.danglingComments ?? [];
    const inlineDangling =
      dangling.length > 0 &&
      dangling.every((c) => c.text.startsWith("/*") && !c.text.includes("\n"));
    const hasComments = dangling.length > 0;
    const body = node.body;
    const only = body.length === 1 ? (body[0] as Statement) : null;
    if (body.length === 0 && (dangling.length === 0 || inlineDangling)) {
      for (const comment of dangling) {
        this.emitted.add(comment);
        this.append(" ");
        this.append(comment.text);
      }
      this.append(" }");
    } else if (
      only !== null &&
      (only.kind === "ExpressionStatement" ||
        only.kind === "VariableDeclaration" ||
        only.kind === "Assignment") &&
      !this.shouldWrapExpression(node) &&
      !hasComments &&
      !this.hasComments(only)
    ) {
      this.append(" ");
      this.statementLabels(only);
      this.statementExpression(only);
      this.append(" }");
    } else {
      this.appendNewLine();
      this.incIndent();
      this.statements(body, null);
      this.appendDanglingComments(node);
      this.decIndent();
      this.appendIndent();
      this.append("}");
    }
  }

  /** L715 */
  parameters(params: readonly FormalParameter[]): void {
    for (const [i, param] of params.entries()) {
      this.append(param.name.name);
      if (hasLegacyType(param.legacyType)) {
        this.append(": ");
        this.legacyTypeAnnotation(param.legacyType);
      } else if (hasType(param.type)) {
        this.append(": ");
        this.typeAnnotation(param.type);
      }
      if (param.defaultValue) {
        this.append(" = ");
        this.expression(param.defaultValue);
      }
      if (i + 1 < params.length) this.append(", ");
    }
  }

  /** L748 (`visitListExpression`) */
  private list(node: Extract<Expression, { kind: "List" }>): void {
    const wrap = node.trailingComma || this.hasCommentsIn(node, node.elements);
    this.append("[");
    if (wrap) this.incIndent();
    this.positionalArgs(node.elements, wrap);
    if (wrap) {
      this.appendNewLine();
      this.appendDanglingComments(node);
      this.decIndent();
      this.appendIndent();
    }
    this.append("]");
  }

  /** L764 */
  protected positionalArgs(args: readonly Expression[], wrap: boolean): void {
    const comma = wrap ? "," : ", ";
    const trailingComma = wrap && args.length > 1;
    for (const [i, arg] of args.entries()) {
      if (wrap) {
        this.appendNewLine();
        this.appendLeadingComments(arg);
        this.appendIndent();
      }
      this.expression(arg);
      if (trailingComma || i + 1 < args.length) this.append(comma);
      if (wrap) this.appendTrailingComment(arg);
    }
  }

  /** L783 (`visitMapExpression`) */
  private map(node: Extract<Expression, { kind: "Map" }>): void {
    if (node.entries.length === 0) {
      this.append("[:]");
      return;
    }
    const wrap = node.trailingComma || this.hasCommentsIn(node, node.entries);
    this.append("[");
    if (wrap) this.incIndent();
    this.namedArgs(node.entries, wrap);
    if (wrap) {
      this.appendNewLine();
      this.appendDanglingComments(node);
      this.decIndent();
      this.appendIndent();
    }
    this.append("]");
  }

  /** L802 */
  protected namedArgs(
    args: readonly (NamedArgument | MapEntry)[],
    wrap: boolean,
  ): void {
    const comma = wrap ? "," : ", ";
    const trailingComma = wrap && args.length > 1;
    for (const [i, arg] of args.entries()) {
      if (wrap) {
        this.appendNewLine();
        this.appendLeadingComments(arg);
        this.appendIndent();
      }
      this.entry(arg);
      if (trailingComma || i + 1 < args.length) this.append(comma);
      if (wrap) this.appendTrailingComment(arg);
    }
  }

  /** L821 (`visitMapEntryExpression`) */
  private entry(node: NamedArgument | MapEntry): void {
    const key = node.kind === "NamedArgument" ? node.name : node.key;
    if (key.kind === "Identifier") this.append(key.name);
    else if (key.kind === "String") this.append(lines(key.text));
    else this.expression(key);
    this.append(": ");
    this.expression(node.value);
  }

  /** L905 (`visitGStringExpression`): every interpolation is braced. */
  private gstring(node: Extract<Expression, { kind: "GString" }>): void {
    const tripleQuoted = node.quote === '"""';
    this.append(node.quote);
    for (const part of node.parts) {
      if (part.kind === "GStringText") {
        this.append(
          tripleQuoted ? this.reindentString(part.text) : lines(part.text),
        );
      } else {
        this.append("${");
        this.expression(part.expression);
        this.append("}");
      }
    }
    this.append(node.quote);
  }

  /** L877 (`visitTypeAnnotation`) for a modern type. */
  typeAnnotation(type: TypeRef): void {
    this.append(typeName(type));
  }

  /** L877 (`visitTypeAnnotation`) for a legacy one: its text as written, without whitespace. */
  legacyTypeAnnotation(type: LegacyType): void {
    this.append(legacyTypeText(type));
  }

  // L936: helpers

  /** L938 */
  private hasCommentsIn(
    container: AstNode,
    args: readonly (ArgItem | MapEntry)[],
  ): boolean {
    if ((container.danglingComments ?? []).length > 0) return true;
    // a group of named arguments is one node upstream, and carries no comment of its own
    return args.some((arg) => !isGroup(arg) && this.hasComments(arg));
  }

  /** L951 */
  private hasChainComments(node: MethodCall | CallExpr): boolean {
    let expr: Expression = node;
    while (isLink(expr)) {
      const receiver = receiverOf(expr) as Expression;
      if (
        (expr.leadingComments ?? []).length > 0 ||
        (receiver.trailingComments ?? []).length > 0
      )
        return true;
      expr = unparen(receiver);
    }
    return false;
  }

  /** L993 */
  private shouldWrapExpression(node: AstNode): boolean {
    return line(node) < lastLine(node);
  }

  /** L997 */
  private shouldWrapMethodCall(node: MethodCall | CallExpr): boolean {
    if (node.trailingComma) return true;
    const start =
      node.kind === "MethodCall" ? methodLine(node) : lastLine(node.callee);
    return start < argumentsLastLine(node);
  }

  /** L1005 */
  private shouldWrapMethodChain(node: MethodCall | CallExpr): boolean {
    if (this.currentRootExpr !== node) return false;
    // a comment between two links can only be emitted by wrapping
    if (this.hasChainComments(node)) return true;
    if (!this.shouldWrapExpression(node)) return false;

    let root: Expression = node;
    let depth = 0;
    while (isLink(root)) {
      root = unparen(receiverOf(root) as Expression);
      depth += 1;
    }
    return this.shouldWrapExpression(root) ? false : depth >= 2;
  }
}
