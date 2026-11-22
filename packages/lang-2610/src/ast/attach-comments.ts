// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/script/formatter/CommentAttacher.java
// (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE), mapped from Groovy nodes to our script AST.
//
// Every comment is attached to a node, so that a formatter can print it back out. The AST is organised into a tree of
// containers: constructs printed with a set of braces. Each container owns the nodes that can carry a comment directly.
// A comment is resolved against the innermost container that contains it:
//
// - an end-of-line comment after a child node is trailing on that node;
// - a comment inside the extent of a child node is hoisted to leading on that node;
// - a comment before a child node is leading on that node;
// - otherwise it is dangling on the container.
//
// The module is a container, so no comment can be lost. Positions are compared as (line, column) pairs, as upstream
// does, so that a block boundary can sit at column 0 of a line. Upstream's `ELSE_POSITION` is `IfStatement.elseRange`.
// What the port keeps from upstream, on purpose, so that results agree with `nextflow lint -format`:
// - an empty braced block, a `;` statement and a branch without braces have no children, and an empty braced block has no
//   position (it is no `else` branch);
// - `when` sections are not containers' children;
// - a receiver's nested containers are registered under the call that has it, whose range starts at the method name.
import type {
  AstNode,
  CallExpr,
  Closure,
  Comment,
  Expression,
  IfStatement,
  MethodCall,
  NamedArgument,
  NamedOutput,
  ScriptAst,
  Section,
  Statement,
  TryCatch,
} from "@nf-builder/lang-core";

type Node = AstNode & Record<string, unknown>;
type StatementLike = Statement | NamedOutput;

/** Pack a (line, column) pair into a single comparable number. */
const pos = (line: number, column: number) => line * 2 ** 32 + column;
const start = (node: AstNode) => pos(node.range.line, node.range.column);
const end = (node: AstNode) => pos(node.range.endLine, node.range.endColumn);

/**
 * Whether upstream gives the node a position. A `;` is the shared `EmptyStatement.INSTANCE` and an empty braced block is
 * a block with no source range.
 */
function hasPosition(node: AstNode): boolean {
  if (node.kind === "EmptyStatement") return false;
  return !(
    node.kind === "Block" &&
    (node as unknown as { statements: unknown[] }).statements.length === 0
  );
}

/**
 * Where a branch starts. Upstream's block of a braced branch is the statements inside the braces, so it starts at the
 * first statement.
 */
function branchStart(node: Statement): number {
  if (node.kind === "Block" && node.statements.length > 0)
    return start(node.statements[0] as Statement);
  return start(node);
}

interface Slot {
  readonly node: AstNode;
  readonly start: number;
  readonly end: number;
  /** The receiver of a method-chain link: an end-of-line comment in the link's slot trails it. */
  readonly trailing: AstNode | null;
}

class Container {
  readonly children: Slot[] = [];
  readonly nested: Container[] = [];

  constructor(
    readonly node: AstNode,
    readonly start: number,
    readonly end: number,
    /** Emit leftover comments as leading on the node instead of dangling. */
    readonly hoist: boolean,
  ) {}

  contains(comment: Comment): boolean {
    return this.start <= start(comment) && end(comment) <= this.end;
  }
}

const startOf = (comment: Comment) => start(comment);
const endOf = (comment: Comment) => end(comment);

export function attachComments(
  script: ScriptAst,
  comments: readonly Comment[],
): void {
  if (comments.length === 0) return;
  new Attacher().run(script, comments);
}

type Slots = Map<AstNode, Comment[]>;

class Attacher {
  private readonly leading: Slots = new Map();
  private readonly trailing: Slots = new Map();
  private readonly dangling: Slots = new Map();

  run(script: ScriptAst, comments: readonly Comment[]): void {
    const root = new Container(
      script,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      false,
    );
    for (const item of script.body) {
      if (isDeclaration(item)) {
        this.addChild(root, item);
        this.declaration(item, root);
      } else {
        // top-level statements are an implicit workflow with no position upstream
        this.statements([item], root);
      }
    }
    for (const comment of comments) this.attach(comment, root);
    flush(this.leading, "leadingComments");
    flush(this.trailing, "trailingComments");
    flush(this.dangling, "danglingComments");
  }

  // Attachment

  private attach(comment: Comment, container: Container): void {
    for (const nested of container.nested) {
      if (nested.contains(comment)) {
        this.attach(comment, nested);
        return;
      }
    }

    let preceding: Slot | null = null;
    let following: Slot | null = null;
    let enclosing: Slot | null = null;
    for (const child of container.children) {
      if (child.end <= startOf(comment)) {
        if (preceding === null || child.end >= preceding.end) preceding = child;
      } else if (child.start >= endOf(comment)) {
        if (following === null || child.start < following.start)
          following = child;
      } else if (
        child.start <= startOf(comment) &&
        endOf(comment) <= child.end
      ) {
        // innermost enclosing child
        if (enclosing === null || child.start >= enclosing.start)
          enclosing = child;
      }
    }

    const line = comment.range.line;
    if (!comment.ownLine && preceding && preceding.node.range.endLine === line)
      add(this.trailing, preceding.node, comment);
    else if (
      !comment.ownLine &&
      enclosing?.trailing &&
      enclosing.trailing.range.endLine === line
    )
      add(this.trailing, enclosing.trailing, comment);
    else if (enclosing) add(this.leading, enclosing.node, comment);
    else if (following) add(this.leading, following.node, comment);
    else if (!comment.ownLine && preceding)
      add(this.trailing, preceding.node, comment);
    else if (container.hoist) add(this.leading, container.node, comment);
    else add(this.dangling, container.node, comment);
  }

  private container(
    node: AstNode,
    parent: Container,
    from = start(node),
    to = end(node),
    hoist = false,
  ): Container {
    const result = new Container(node, from, to, hoist);
    parent.nested.push(result);
    return result;
  }

  private addChild(container: Container, node: AstNode): void {
    if (hasPosition(node))
      container.children.push({
        node,
        start: start(node),
        end: end(node),
        trailing: null,
      });
  }

  private addSlot(
    container: Container,
    node: AstNode,
    from: number,
    to: number,
    trailing: AstNode | null,
  ): void {
    if (from < to)
      container.children.push({ node, start: from, end: to, trailing });
  }

  // Script declarations

  private declaration(decl: Node, parent: Container): void {
    switch (decl.kind) {
      case "Enum": {
        const c = this.container(decl, parent);
        for (const constant of decl.constants as AstNode[])
          this.addChild(c, constant);
        break;
      }
      case "Agent": {
        const c = this.container(decl, parent);
        this.statements(items(decl.directives), c);
        for (const input of items(decl.inputs)) this.addChild(c, input);
        this.statements(items(decl.outputs), c);
        this.statements(items(decl.prompt), c);
        break;
      }
      case "Function": {
        const c = this.container(decl, parent);
        this.statements(
          (decl.body as { statements: Statement[] }).statements,
          c,
        );
        break;
      }
      case "OutputBlock": {
        const c = this.container(decl, parent);
        for (const output of decl.outputs as Node[]) {
          this.addChild(c, output);
          this.statements(
            (output.body as { statements: Statement[] }).statements,
            this.container(output, c),
          );
        }
        break;
      }
      case "ParamsBlock": {
        const c = this.container(decl, parent);
        for (const param of decl.params as AstNode[]) this.addChild(c, param);
        break;
      }
      case "Process": {
        const c = this.container(decl, parent);
        this.statements(items(decl.directives), c);
        if (decl.typed) {
          for (const input of items(decl.inputs)) this.addChild(c, input);
          this.statements(items(decl.stage), c);
        } else {
          this.statements(items(decl.inputs), c);
        }
        this.statements(items(decl.outputs), c);
        this.statements(items(decl.topics), c);
        this.statements(items(decl.exec), c);
        this.statements(items(decl.stub), c);
        break;
      }
      case "Record": {
        const c = this.container(decl, parent);
        for (const field of decl.fields as AstNode[]) this.addChild(c, field);
        break;
      }
      case "Workflow": {
        const c = this.container(decl, parent);
        for (const take of items(decl.takes)) this.addChild(c, take);
        this.statements(items(decl.main), c);
        this.statements(items(decl.emits), c);
        this.statements(items(decl.publishers), c);
        this.statements(items(decl.onComplete), c);
        this.statements(items(decl.onError), c);
        break;
      }
    }
  }

  // Statements

  private statements(
    nodes: readonly (StatementLike | AstNode)[],
    container: Container,
  ): void {
    for (const node of nodes) {
      this.addChild(container, node);
      this.statement(node as StatementLike, container);
    }
  }

  /** The statements of a braced block; a branch without braces has none, as upstream's non-block statements have none. */
  private blockOf(node: Statement | null): readonly Statement[] {
    return node?.kind === "Block" ? node.statements : [];
  }

  private statement(node: StatementLike, parent: Container): void {
    if (node.kind === "If") {
      this.ifStatement(node, parent);
      return;
    }
    if (node.kind === "TryCatch") {
      this.tryCatch(node, parent);
      return;
    }
    const chain = chainRoot(node);
    const container = chain
      ? this.container(node, parent, start(node), end(node), true)
      : parent;
    if (chain) this.chainSlots(chain, container);
    this.statementExpressions(node, container);
  }

  private ifStatement(node: IfStatement, parent: Container): void {
    const elseBlock = node.alternate;
    const hasElse = elseBlock !== null && hasPosition(elseBlock);
    const boundary: number =
      hasElse && elseBlock
        ? boundaryOf(node.consequent, branchStart(elseBlock))
        : end(node);
    const thenContainer = this.container(
      node.consequent,
      parent,
      start(node),
      boundary,
    );
    this.statements(this.blockOf(node.consequent), thenContainer);
    this.walk(node.condition, thenContainer);
    if (hasElse && elseBlock) {
      // the `else` keyword divides the branches: a comment before it leads the branch it introduces, a comment after it
      // belongs to that branch's body
      const elseAt = node.elseRange
        ? pos(node.elseRange.line, node.elseRange.column)
        : null;
      if (elseAt !== null)
        this.addSlot(parent, elseBlock, boundary, elseAt, null);
      if (elseBlock.kind === "If") this.statement(elseBlock, parent);
      else
        this.statements(
          this.blockOf(elseBlock),
          this.container(elseBlock, parent, elseAt ?? boundary, end(node)),
        );
    }
  }

  private tryCatch(node: TryCatch, parent: Container): void {
    const catches = node.catches;
    const first = catches[0];
    const boundary: number = first
      ? boundaryOf(node.body, start(first))
      : end(node);
    this.statements(
      this.blockOf(node.body),
      this.container(node.body, parent, start(node), boundary),
    );
    catches.forEach((clause, i) => {
      const next = catches[i + 1];
      this.statements(
        this.blockOf(clause.body),
        this.container(
          clause.body,
          parent,
          start(clause),
          next ? start(next) : end(node),
        ),
      );
    });
  }

  /** The expressions of a statement, walked for the containers inside them. */
  private statementExpressions(
    node: StatementLike,
    container: Container,
  ): void {
    switch (node.kind) {
      case "ExpressionStatement":
        this.walk(node.expression, container);
        break;
      case "VariableDeclaration":
        if (node.initializer) this.walk(node.initializer, container);
        break;
      case "Assignment":
        if (node.target.kind !== "TupleTarget")
          this.walk(node.target, container);
        this.walk(node.value, container);
        break;
      case "Return":
      case "Throw":
        if (node.value) this.walk(node.value, container);
        break;
      case "Assert":
        this.walk(node.condition, container);
        if (node.message) this.walk(node.message, container);
        break;
      case "NamedOutput":
        if (node.value) this.walk(node.value, container);
        break;
    }
  }

  /**
   * Register a slot for each link of a method chain: the gap between the end of the receiver and the start of the method
   * name, which is where the formatter breaks the line when the chain is wrapped. A comment there leads the link, or
   * trails the receiver if it is on the same line.
   */
  private chainSlots(root: Expression, container: Container): void {
    let expr: Expression | null = root;
    while (expr && isLink(expr)) {
      const receiver: Expression = receiverOf(expr);
      if (expr.kind === "MethodCall")
        this.addSlot(
          container,
          expr,
          end(receiver),
          start(expr.method),
          receiver,
        );
      expr = unparen(receiver);
    }
  }

  // Expressions

  /** The counterpart of upstream's `ExpressionWalker`: a container for each construct printed with its own brackets. */
  private walk(expr: Expression, current: Container): void {
    switch (expr.kind) {
      case "Closure": {
        const c = this.container(expr, current);
        this.statements((expr as Closure).body, c);
        break;
      }
      case "List": {
        const c = this.container(expr, current);
        for (const element of expr.elements) {
          this.addChild(c, element);
          this.walk(element, c);
        }
        break;
      }
      case "Map": {
        const c = this.container(expr, current);
        for (const entry of expr.entries) {
          this.addChild(c, entry);
          this.walk(entry.value, c);
        }
        break;
      }
      case "MethodCall":
      case "Call":
        this.call(expr, current);
        break;
      case "New":
        // upstream visits the arguments as a plain tuple: named ones as map entries, the rest without slots
        for (const arg of expr.args) {
          if (arg.kind === "NamedArgument") {
            this.addChild(current, arg);
            this.walk(arg.value, current);
          } else this.walk(arg, current);
        }
        break;
      case "GString":
        for (const part of expr.parts)
          if (part.kind === "Interpolation")
            this.walk(part.expression, current);
        break;
      case "Property":
        this.walk(expr.object, current);
        break;
      case "Index":
        this.walk(expr.object, current);
        for (const index of expr.indices) this.walk(index, current);
        break;
      case "Unary":
      case "Cast":
      case "TypeTest":
        this.walk(expr.operand, current);
        break;
      case "Binary":
        this.walk(expr.left, current);
        this.walk(expr.right, current);
        break;
      case "Ternary":
        this.walk(expr.condition, current);
        this.walk(expr.consequent, current);
        this.walk(expr.alternate, current);
        break;
      case "Elvis":
        this.walk(expr.condition, current);
        this.walk(expr.alternate, current);
        break;
      case "Parenthesized":
        this.walk(expr.expression, current);
        break;
      case "IncompleteExpression":
        this.walk(expr.object, current);
        break;
      default:
        break;
    }
  }

  private call(node: MethodCall | CallExpr, prev: Container): void {
    // Upstream's argument list: the named arguments as one map first, then the positional ones, then the closures.
    const named = node.args.filter(
      (a): a is NamedArgument => a.kind === "NamedArgument",
    );
    const positional = node.args.filter(
      (a): a is Expression => a.kind !== "NamedArgument",
    );
    const all: (NamedArgument[] | Expression)[] = [
      ...(named.length > 0 ? [named] : []),
      ...positional,
      ...node.closures,
    ];
    const lastArg = all[all.length - 1];
    // a trailing closure is printed outside the parentheses, so it is not an argument for the purpose of attachment
    const lastClosureArg =
      lastArg !== undefined &&
      !Array.isArray(lastArg) &&
      lastArg.kind === "Closure";
    const parenArgs = lastClosureArg ? all.slice(0, -1) : all;

    const receiver =
      node.kind === "MethodCall" ? node.receiver : (node.callee as Expression);
    let current = prev;
    if (parenArgs.length > 0) {
      // the receiver has its own containers, and the gap before the method name belongs to the enclosing method chain
      const from =
        node.kind === "MethodCall" && node.receiver
          ? start(node.method)
          : start(node);
      current = this.container(node, prev, from, end(node));
    }
    if (receiver) this.walk(receiver, current);
    for (const arg of parenArgs) {
      if (Array.isArray(arg)) {
        for (const entry of arg) {
          this.addChild(current, entry);
          this.walk(entry.value, current);
        }
      } else {
        this.addChild(current, arg);
        this.walk(arg, current);
      }
    }
    if (lastClosureArg) this.walk(lastArg as Expression, current);
  }
}

// Helpers

const DECLARATIONS = new Set([
  "FeatureFlag",
  "Include",
  "Import",
  "ParamsBlock",
  "LegacyParam",
  "Record",
  "Enum",
  "Process",
  "Agent",
  "Workflow",
  "OutputBlock",
  "Function",
  "IncompleteDeclaration",
]);
const isDeclaration = (node: AstNode): node is Node =>
  DECLARATIONS.has(node.kind);

/** The items of a section, or none. */
function items(section: unknown): AstNode[] {
  return section ? ((section as Section<AstNode>).items as AstNode[]) : [];
}

function add(map: Slots, node: AstNode, comment: Comment): void {
  const list = map.get(node);
  if (list) list.push(comment);
  else map.set(node, [comment]);
}

function flush(map: Slots, field: string): void {
  for (const [node, list] of map)
    (node as unknown as Record<string, Comment[]>)[field] = list;
}

/**
 * Where a block ends and the next one begins. The braces and keywords between them are not in the AST, so the split is
 * made at the end of the line that closes the first block: an end-of-line comment stays with the block it follows, an
 * own-line comment leads the next block. Upstream's braced block ends on the line of its closing brace.
 */
function boundaryOf(block: Statement, next: number): number {
  if (!hasPosition(block)) return next;
  return Math.min(pos(block.range.endLine + 1, 0), next);
}

const unparen = (e: Expression): Expression => {
  let result = e;
  while (result.kind === "Parenthesized") result = result.expression;
  return result;
};

/** A call that is a link of a chain: a method call with a receiver, or a call of a value (upstream `.call`). */
const isLink = (e: Expression): e is MethodCall | CallExpr =>
  (e.kind === "MethodCall" && e.receiver !== null) || e.kind === "Call";

const receiverOf = (e: MethodCall | CallExpr): Expression =>
  e.kind === "MethodCall" ? (e.receiver as Expression) : e.callee;

/**
 * The root method chain of a statement, if the formatter is able to wrap it: only a chain at the root of a statement or
 * an assignment value is wrapped, and only when it has at least two links.
 */
function chainRoot(node: StatementLike): Expression | null {
  let expr: Expression | null | undefined;
  switch (node.kind) {
    case "ExpressionStatement":
      expr = node.expression;
      break;
    case "Return":
      expr = node.value;
      break;
    case "Assignment":
      expr = node.value;
      break;
    case "VariableDeclaration":
      expr = node.initializer;
      break;
    case "NamedOutput":
      expr = node.value;
      break;
    default:
      return null;
  }
  if (!expr) return null;
  const root = unparen(expr);
  if (root.kind !== "MethodCall" && root.kind !== "Call") return null;
  let depth = 0;
  let link: Expression = root;
  while (isLink(link)) {
    link = unparen(receiverOf(link));
    depth++;
  }
  return depth >= 2 ? root : null;
}
