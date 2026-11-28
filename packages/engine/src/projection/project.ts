// The projection (AR-10, F-106): one graph per workflow, computed from the project model. Nodes are calls, chains,
// factories, takes, params and code shells; edges are def-use links. Plain data, deterministic, never throws (IO-14).
// Node keys: ./keys.ts. Types: ./types.ts, with nf-lang's call-typing rules in ./signature.ts (Apache-2.0).

import type {
  Argument,
  Callee,
  ChainStep,
  Expression,
  FlowType,
  GraphEdge,
  GraphNode,
  Guard,
  IfStatement,
  IncludableDeclaration,
  LegacyOperator,
  MethodCall,
  Port,
  PortRef,
  ProjectedStatement,
  Projection,
  Range,
  ScriptAst,
  ScriptCatalogue,
  SourceFile,
  Statement,
  TypeRef,
  WorkflowDef,
  WorkflowRef,
} from "@nf-builder/lang-core";
import type { Binding } from "../model/file-model";
import type { ProjectModel } from "../model/project";
import { buildCodeNode } from "./code";
import { branchesOf } from "./conditional";
import { inlineType } from "./inline";
import { KeyAllocator } from "./keys";
import {
  integerIndex,
  legacyOperatorType,
  outPath,
  type PipeStep,
  pipeSteps,
  setTarget,
  unwrap,
} from "./legacy";
import {
  type DataflowLibrary,
  dataflowLibrary,
  type OperatorArguments,
} from "./library";
import { variablesRead } from "./reads";
import {
  type ReadPath,
  type ResolvedRead,
  type Value,
  WorkflowScope,
} from "./scope";
import {
  callDataflow,
  emitName,
  fallbackSignature,
  type LegacySignature,
  legacyProcessSignature,
  legacyResultDataflow,
  type PortSpec,
  pipelineSignature,
  processSignature,
  type Signature,
  spec,
  workflowSignature,
} from "./signature";
import { flowFromDeclared, UNKNOWN, wrapFlow } from "./types";

export interface Projector {
  /** Every workflow of every Nextflow file, modelled or not, in path then source order. */
  workflows(): readonly WorkflowRef[];
  /** The graph of one workflow (`null` name: the entry workflow); null for an unparsed or missing workflow. */
  project(path: string, workflow: string | null): Projection | null;
}

type WorkflowNode = WorkflowDef | ScriptAst;
interface Listed {
  readonly ref: WorkflowRef;
  /** Null for a workflow the parser kept as `Unparsed`. */
  readonly node: WorkflowNode | null;
}

const STATEMENT_KINDS: ReadonlySet<string> = new Set([
  "Block",
  "ExpressionStatement",
  "VariableDeclaration",
  "Assignment",
  "If",
  "TryCatch",
  "Return",
  "Throw",
  "Assert",
]);

/** The top-level statements nf-lang wraps in an unnamed workflow. */
function scriptStatements(ast: ScriptAst): Statement[] {
  return ast.body.filter((item): item is Statement =>
    STATEMENT_KINDS.has(item.kind),
  );
}

function listWorkflows(source: SourceFile): Listed[] {
  if (source.language !== "nextflow" || source.ast === null) return [];
  const ast = source.ast;
  const out: Listed[] = [];
  for (const item of ast.body) {
    if (item.kind === "Workflow")
      out.push({
        ref: {
          path: source.path,
          name: item.name?.name ?? null,
          modelled: true,
          typed: item.typed,
          range: item.range,
        },
        node: item,
      });
    else if (item.kind === "Unparsed" && item.head?.keyword === "workflow")
      out.push({
        ref: {
          path: source.path,
          name: item.head.name,
          modelled: false,
          typed: null,
          range: item.range,
        },
        node: null,
      });
  }
  if (scriptStatements(ast).length > 0 && !out.some((l) => l.ref.name === null))
    out.push({
      ref: {
        path: source.path,
        name: null,
        modelled: true,
        typed: ast.typesEnabled,
        range: ast.range,
      },
      node: ast,
    });
  return out;
}

/** The inferred types of a callee workflow's emits, by port name (unknown ones left out). */
type EmitTypes = (
  path: string,
  workflow: string | null,
) => ReadonlyMap<string, FlowType>;

/** One operator of a chain: a method call's, or a pipe step's. */
interface StepCall {
  readonly operator: string;
  readonly range: Range;
  readonly args: readonly Argument[];
  readonly closures: number;
}

const stepCall = (
  operator: string,
  range: Range,
  call: MethodCall | null,
): StepCall => ({
  operator,
  range,
  args: call?.args ?? [],
  closures:
    (call?.closures.length ?? 0) +
    (call?.args.filter((a) => a.kind === "Closure").length ?? 0),
});

/** A pipe: its source, its steps, and the variable of a final `set { v }`. */
interface PipePlan {
  readonly source: Expression;
  readonly steps: readonly PipeStep[];
  readonly set: string | null;
}

interface Callable {
  readonly callee: Callee;
  readonly signature: (argumentCount: number) => Signature;
  /** A legacy process's ports, which also give its results' dataflow kind (F-107). */
  readonly legacy?: LegacySignature;
}

/** What a feeding expression contributes to an input port. */
interface Feed {
  /** The argument's text, which an edit may patch; null for a feed that isn't one (a pipe's, a fork's). */
  readonly range: Range | null;
  readonly edges: readonly FeedEdge[];
  /** The type of the argument when known: its source for a direct feed, else its inline type. */
  readonly type: FlowType | null;
}
type FeedEdge = Omit<GraphEdge, "id" | "to">;

const OUT = "out";
const argumentValue = (argument: MethodCall["args"][number]): Expression =>
  argument.kind === "NamedArgument" ? argument.value : argument;
const methodName = (call: MethodCall): string | null =>
  call.method.kind === "Identifier" ? call.method.name : null;

function port(s: PortSpec, feed?: Feed): Port {
  return {
    id: s.id,
    label: s.label,
    type: s.type,
    argument: feed?.range ?? null,
    // an inline argument (one that reads no graph value) keeps its type for LA-32 checks
    argumentType: feed?.edges.length === 0 ? feed.type : null,
    ...(s.components === undefined ? {} : { components: s.components }),
  };
}

const edgesOf = (resolved: ResolvedRead, direct: boolean): FeedEdge[] =>
  resolved.sources.map((s) => ({
    from: s.port,
    type: s.type ?? UNKNOWN,
    variable: resolved.variable,
    direct,
  }));

/** A feed from a resolved read: direct when it reads one port whole. */
function readFeed(range: Range, read: ReadPath, resolved: ResolvedRead): Feed {
  const direct =
    resolved.sources.length === 1 &&
    resolved.consumed === read.properties.length;
  return {
    range,
    edges: edgesOf(resolved, direct),
    type: direct ? (resolved.sources[0]?.type ?? null) : null,
  };
}

/** A node as the projector builds it: `#add` gives it the guards around it. */
type PendingNode<N = GraphNode> = N extends unknown ? Omit<N, "guards"> : never;

class Projecting {
  #nodes: GraphNode[] = [];
  #edges = new Map<string, GraphEdge>();
  #scope = new WorkflowScope();
  /** The `if` branches around the statement being projected. */
  #guardStack: Guard[] = [];
  readonly #keys: KeyAllocator;
  readonly #statements: ProjectedStatement[] = [];
  /** The names the statement being projected has bound. */
  #bound: string[] = [];
  /** Whether a statement in the `if` being tried bound a graph value (an alias, a call result) or made a non-code node. */
  #flowed = false;

  constructor(
    private readonly model: ProjectModel,
    private readonly library: DataflowLibrary,
    private readonly text: string,
    private readonly ref: WorkflowRef,
    private readonly node: WorkflowNode,
    private readonly emitTypes: EmitTypes,
  ) {
    this.#keys = new KeyAllocator(ref.path, ref.name);
  }

  run(): Projection {
    const node = this.node;
    const takes = node.kind === "Workflow" ? (node.takes?.items ?? []) : [];
    const statements =
      node.kind === "Workflow"
        ? (node.main?.items ?? [])
        : scriptStatements(node);
    this.#addParams(node);
    for (const take of takes) {
      const id = this.#keys.take(take.name.name);
      const type = flowFromDeclared(take.type);
      this.#add({
        id,
        kind: "take",
        label: take.name.name,
        inputs: [],
        outputs: [port(spec(OUT, type))],
        range: take.range,
        name: take.name.name,
      });
      this.#scope.bind(take.name.name, [
        { node: id, ports: [spec(OUT, type)] },
      ]);
    }
    for (const statement of statements) this.#statement(statement);
    this.#addEmits(node);
    this.#addOutput(node);
    return {
      workflow: this.ref,
      nodes: this.#nodes,
      edges: this.#sortedEdges(),
      statements: this.#statements,
    };
  }

  // ---- params ----

  #fileAst(): ScriptAst | null {
    const source = this.model.file(this.ref.path)?.source;
    return source?.language === "nextflow" ? source.ast : null;
  }

  #addParams(node: WorkflowNode): void {
    const ast = this.#fileAst();
    const block = ast?.body.find((i) => i.kind === "ParamsBlock") ?? null;
    const read = new Set<string>();
    const sections =
      node.kind === "Workflow"
        ? [node.main, node.emits, node.publishers].filter((s) => s !== null)
        : scriptStatements(node);
    // closure reads count too: a code node's closures read parameters it is wired to
    for (const section of sections)
      for (const r of variablesRead(section))
        if (r.name === "params" && r.property !== null) read.add(r.property);
    const entry = this.ref.name === null;
    // legacy `params.x = ...` in the entry script, in source order (F-107)
    const declared: string[] = [];
    for (const item of entry ? (ast?.body ?? []) : []) {
      const target = item.kind === "LegacyParam" ? item.target : null;
      if (
        target?.object.kind === "Variable" &&
        target.object.name === "params" &&
        target.property.kind === "Identifier" &&
        !declared.includes(target.property.name)
      )
        declared.push(target.property.name);
    }
    if (!(entry && block !== null) && read.size === 0 && declared.length === 0)
      return;
    const specs: PortSpec[] = [];
    for (const p of block?.params ?? [])
      specs.push(spec(p.name.name, flowFromDeclared(p.type)));
    for (const name of declared)
      if (!specs.some((s) => s.id === name)) specs.push(spec(name, null));
    for (const name of read)
      if (!specs.some((s) => s.id === name)) specs.push(spec(name, null));
    const id = this.#keys.params();
    this.#add({
      id,
      kind: "params",
      label: "params",
      inputs: [],
      outputs: specs.map((s) => port(s)),
      range: block?.range ?? node.range,
    });
    this.#scope.bind("params", [{ node: id, ports: specs }]);
  }

  // ---- emits, publish and output ----

  #addEmits(node: WorkflowNode): void {
    const items = node.kind === "Workflow" ? (node.emits?.items ?? []) : [];
    items.forEach((item, index) => {
      const name = emitName(item, index, items.length);
      const value = item.kind === "NamedOutput" ? item.value : item.expression;
      const declared =
        item.kind === "NamedOutput" ? flowFromDeclared(item.type) : null;
      const feed =
        value === null ? this.#feedName(name, item.range) : this.#feed(value);
      const id = this.#keys.emit(name);
      this.#add({
        id,
        kind: "emit",
        label: name,
        inputs: [port(spec("in", declared), feed)],
        outputs: [],
        range: item.range,
        name,
      });
      this.#connect(feed, { node: id, port: "in" });
    });
  }

  #addOutput(node: WorkflowNode): void {
    // only the entry workflow publishes, and the output block belongs to it (a named workflow with `publish:` is Unparsed)
    if (this.ref.name !== null) return;
    const publishers = node.kind === "Workflow" ? node.publishers : null;
    const block = this.#fileAst()?.body.find((i) => i.kind === "OutputBlock");
    if (block === undefined && publishers === null) return;
    const specs: PortSpec[] = [];
    for (const o of block?.outputs ?? [])
      specs.push(spec(o.name.name, flowFromDeclared(o.type)));
    const feeds = new Map<string, Feed>();
    for (const item of publishers?.items ?? []) {
      const name = item.name.name;
      feeds.set(
        name,
        item.value === null
          ? this.#feedName(name, item.range)
          : this.#feed(item.value),
      );
      if (!specs.some((s) => s.id === name)) specs.push(spec(name, null));
    }
    const id = this.#keys.output();
    this.#add({
      id,
      kind: "output",
      label: "output",
      inputs: specs.map((s) => port(s, feeds.get(s.id))),
      outputs: [],
      range: block?.range ?? publishers?.range ?? node.range,
    });
    for (const [name, feed] of feeds)
      this.#connect(feed, { node: id, port: name });
  }

  // ---- statements ----

  /** Whether legacy forms apply (`.out`, pipes, legacy operators and factories): lint rejects them in typed code. */
  get #legacy(): boolean {
    return this.ref.typed !== true;
  }

  #statement(statement: Statement): void {
    if (statement.kind === "EmptyStatement") return;
    if (statement.kind === "If" && this.#transparentIf(statement)) return;
    const before = this.#nodes.length;
    this.#bound = [];
    const guards = [...this.#guardStack];
    this.#project(statement);
    const created = this.#nodes.slice(before);
    if (created.some((n) => n.kind !== "code")) this.#flowed = true;
    this.#statements.push({
      range: statement.range,
      nodes: created.map((n) => n.id),
      binds: this.#bound,
      modelled: !created.some((n) => n.kind === "code"),
      guards,
    });
  }

  #add(node: PendingNode): void {
    this.#nodes.push({ ...node, guards: [...this.#guardStack] } as GraphNode);
  }

  /** Runs `fn` inside a branch: the nodes it makes carry the guard. */
  #guarded<T>(guard: Guard, fn: () => T): T {
    this.#guardStack.push(guard);
    try {
      return fn();
    } finally {
      this.#guardStack.pop();
    }
  }

  /** Puts everything the projector has built back as it is now, for a branch that turns out not to be dataflow. */
  #checkpoint(): () => void {
    const nodes = [...this.#nodes];
    const edges = new Map(this.#edges);
    const scope = this.#scope.fork();
    const statements = this.#statements.length;
    const keys = this.#keys.checkpoint();
    return () => {
      this.#nodes = nodes;
      this.#edges = edges;
      this.#scope = scope;
      this.#statements.length = statements;
      keys();
    };
  }

  /**
   * An `if` with dataflow in a branch is transparent: its branch statements are projected in order, each carrying
   * the branch guards, and each branch starts from the bindings before the `if`. After it, a name holds the
   * definitions of every branch end (and the earlier one without an `else`). An `if` with no dataflow in it is
   * left to be one code node. False in that case.
   */
  #transparentIf(statement: IfStatement): boolean {
    const undo = this.#checkpoint();
    const outer = this.#flowed;
    this.#flowed = false;
    this.#ifBranches(statement);
    const found = this.#flowed;
    this.#flowed = outer || found;
    if (!found) undo();
    return found;
  }

  #ifBranches(statement: IfStatement): void {
    const incoming = this.#scope;
    const ends: WorkflowScope[] = [];
    const branch = (body: Statement, which: "then" | "else") => {
      const scope = incoming.fork();
      this.#scope = scope;
      const items = body.kind === "Block" ? body.statements : [body];
      this.#guarded(
        { condition: statement.condition.range, branch: which },
        () => {
          for (const item of items) this.#statement(item);
        },
      );
      // a nested `if` without dataflow swaps in a restored scope, so the branch ends in whatever is current
      const end = this.#scope;
      // a `def` in a branch is local to it
      end.restore(
        items.flatMap((i) =>
          i.kind === "VariableDeclaration" && i.def
            ? i.targets.map((t) => t.name.name)
            : [],
        ),
        incoming,
      );
      ends.push(end);
    };
    branch(statement.consequent, "then");
    if (statement.alternate !== null) branch(statement.alternate, "else");
    this.#scope = incoming;
    incoming.join(ends, statement.alternate !== null);
  }

  #bindValues(name: string, values: readonly Value[]): void {
    if (values.length > 0) this.#flowed = true;
    this.#scope.bind(name, values);
    this.#bound.push(name);
  }

  /** The values a reference resolved to, one per node with the ports it reads. */
  #valuesOf(resolved: ResolvedRead): Value[] {
    const byNode = new Map<string, PortSpec[]>();
    for (const s of resolved.sources)
      byNode.set(s.port.node, [
        ...(byNode.get(s.port.node) ?? []),
        spec(s.port.port, s.type),
      ]);
    return [...byNode].map(([node, ports]) => ({ node, ports }));
  }

  #project(statement: Statement): void {
    let variable: string | null = null;
    let expression: Expression | null = null;
    let declared: TypeRef | null = null;
    if (statement.kind === "ExpressionStatement")
      expression = statement.expression;
    else if (
      statement.kind === "VariableDeclaration" &&
      !statement.multiple &&
      statement.targets.length === 1
    ) {
      variable = statement.targets[0]?.name.name ?? null;
      declared = statement.targets[0]?.type ?? null;
      expression = statement.initializer;
    } else if (
      statement.kind === "Assignment" &&
      statement.operator === "=" &&
      statement.target.kind === "Variable"
    ) {
      variable = statement.target.name;
      expression = statement.value;
    }
    // `def x` and `x = null` bind nothing
    if (
      variable !== null &&
      (expression === null || expression.kind === "Null")
    ) {
      this.#bindValues(variable, []);
      return;
    }
    if (
      expression !== null &&
      this.#dataflowStatement(expression, variable, declared)
    )
      return;
    this.#code(statement, variable, expression);
  }

  /** Projects a statement's expression when it is dataflow, an alias or a call-result property; false for anything else. */
  #dataflowStatement(
    expression: Expression,
    variable: string | null,
    declared: TypeRef | null,
  ): boolean {
    const e = unwrap(expression);
    const pipe = this.#pipeOf(e);
    if (pipe !== null) {
      const values = this.#pipe(pipe, variable);
      if (variable !== null) this.#bindValues(variable, values);
      return true;
    }
    if (this.#isDataflow(e)) {
      const value = this.#build(e, variable, flowFromDeclared(declared));
      if (variable !== null) this.#bindValues(variable, [value]);
      return true;
    }
    if (this.#isOutputOfCall(e)) {
      const nested = this.#nested(e);
      if (nested === null) return false;
      if (variable !== null) this.#bindValues(variable, [nested.value]);
      return true;
    }
    // `ref.set { v }` and `ref.tap { v }` on a bare reference are aliases
    if (
      e.kind === "MethodCall" &&
      this.#isAssignCall(e) &&
      e.receiver !== null
    ) {
      const ref = this.#reference(e.receiver);
      const target = setTarget(e);
      if (ref === null || !this.#aliasable(ref) || target === null)
        return false;
      this.#bindValues(target.variable.name, this.#valuesOf(ref.resolved));
      return true;
    }
    if (variable === null) return false;
    if (this.#conditionalValue(e, variable)) return true;
    // `runner = PROC`: the variable stands for a process or workflow (legacy only)
    if (
      this.#legacy &&
      e.kind === "Variable" &&
      this.#scope.lookup(e.name).length === 0 &&
      this.#callableByName(e.name) !== null
    ) {
      this.#scope.bindAlias(variable, this.#scope.calleesOf(e.name));
      this.#bound.push(variable);
      this.#flowed = true;
      return true;
    }
    // an assignment of a graph reference creates no node
    const ref = this.#reference(e);
    if (ref === null || !this.#aliasable(ref)) return false;
    this.#bindValues(variable, this.#valuesOf(ref.resolved));
    return true;
  }

  /**
   * Whether a graph reference stands for the value itself, so an assignment, `set`/`tap`, ternary branch or pipe
   * source over it is an alias: it consumed all its properties, and isn't a property of a code node's value (`x.p`).
   */
  #aliasable(ref: { read: ReadPath; resolved: ResolvedRead } | null): boolean {
    if (ref === null) return false;
    const { read, resolved } = ref;
    if (resolved.consumed !== read.properties.length) return false;
    return !(
      read.properties.length > 0 &&
      resolved.sources.some((src) => this.#isCodeNode(src.port.node))
    );
  }

  #isCodeNode(id: string): boolean {
    return this.#nodes.some((n) => n.id === id && n.kind === "code");
  }

  #code(
    statement: Statement,
    variable: string | null,
    expression: Expression | null,
  ): void {
    const { node, edges } = buildCodeNode(statement, {
      scope: this.#scope,
      keys: this.#keys,
      text: this.text,
      isCode: (id) => this.#isCodeNode(id),
      // a copy of a graph value (`w2 = w`) has that value's type; anything else an inline one
      assignedType: () =>
        variable === null || expression === null
          ? null
          : this.#feed(expression).type,
    });
    this.#add(node);
    for (const edge of edges) this.#edges.set(edge.id, edge);
    // each assigned name now stands for this node's port of that name, replacing an earlier binding
    for (const output of node.outputs) {
      this.#bound.push(output.id);
      this.#scope.bind(output.id, [{ node: node.id, ports: [output] }]);
    }
  }

  // ---- dataflow expressions ----

  /** A variable, or a chain of simple properties on one, that the scope resolves to graph values. */
  #reference(expression: Expression) {
    const e = unwrap(expression);
    const out = this.#legacy ? outPath(e) : null;
    if (out !== null) {
      this.#demand(out);
      // `X.out[n]` isn't a property chain; `X.out` and `X.out.name` resolve in the scope
      if (e.kind === "Index") {
        const resolved = this.#scope.resolveOut(out.callee, out.selector);
        return resolved === null
          ? null
          : { read: { name: out.callee, properties: [] }, resolved };
      }
    }
    if (!isChain(e)) return null;
    const read = variablesRead(e, { closures: false })[0];
    if (read === undefined) return null;
    const resolved = this.#scope.resolveRead(read);
    return resolved === null ? null : { read, resolved };
  }

  #isFactoryCall(call: MethodCall): boolean {
    const name = methodName(call);
    const receiver = call.receiver;
    return (
      name !== null &&
      receiver !== null &&
      receiver.kind === "Variable" &&
      this.#scope.lookup(receiver.name).length === 0 &&
      (this.library.isFactory(receiver.name, name) ||
        // a legacy factory the catalogue lacks, such as `channel.from`: its type isn't known
        (this.#legacy &&
          (receiver.name === "channel" || receiver.name === "Channel")))
    );
  }

  /** `E.set { v }` or `E.tap { v }` in nf-lang's assignment shape. */
  #isAssignCall(call: MethodCall): boolean {
    const name = methodName(call);
    return (
      name !== null &&
      call.receiver !== null &&
      this.library.legacyResult(name) === "assign" &&
      setTarget(call) !== null
    );
  }

  /** A `.out` selection of a callee that has no declared ports (unresolved or unparsed) adds the port it names. */
  #demand(out: NonNullable<ReturnType<typeof outPath>>): void {
    if (out.selector === null) return;
    const id =
      typeof out.selector === "string" ? out.selector : `[${out.selector}]`;
    for (const value of this.#scope.callsOf(out.callee)) {
      const at = this.#nodes.findIndex((n) => n.id === value.node);
      const found = this.#nodes[at];
      if (
        found?.kind !== "call" ||
        found.callee.status === "modelled" ||
        value.ports.some((p) => p.id === id)
      )
        continue;
      const added = spec(id, null);
      this.#nodes[at] = { ...found, outputs: [...found.outputs, port(added)] };
      this.#scope.addPort(value.node, added);
    }
  }

  /** A catalogue operator on a dataflow expression, or on a reference whose single source isn't plain. */
  #isOperatorCall(call: MethodCall): boolean {
    const name = methodName(call);
    if (name === null || call.receiver === null) return false;
    const receiver = unwrap(call.receiver);
    const legacy = this.library.legacyResult(name);
    if (legacy === "assign")
      return (
        this.#isAssignCall(call) &&
        (this.#isDataflow(receiver) || this.#isOutputOfCall(receiver))
      );
    if (legacy !== null && !this.#legacy) return false;
    let kind: FlowType["dataflow"] = null;
    if (!this.#isDataflow(receiver) && !this.#isOutputOfCall(receiver)) {
      const ref = this.#reference(receiver);
      if (ref === null) return false;
      // a property the scope didn't consume (`split.small`) is of unknown type
      const { sources, consumed } = ref.resolved;
      if (sources.length === 1 && consumed === ref.read.properties.length)
        kind = sources[0]?.type?.dataflow ?? null;
    }
    return kind !== "plain" && this.library.isOperator(name, kind);
  }

  /** `<call>.<name>`: a property of a dataflow expression, which stands for one output of the node it creates. */
  #isOutputOfCall(expression: Expression): boolean {
    const e = unwrap(expression);
    if (e.kind === "Index")
      // `CALL(...)[n]` (legacy results are indexable)
      return (
        this.#legacy &&
        integerIndex(e) !== null &&
        this.#isCall(unwrap(e.object))
      );
    return (
      e.kind === "Property" &&
      e.property.kind === "Identifier" &&
      this.#isDataflow(e.object)
    );
  }

  #isCall(e: Expression): boolean {
    return (
      e.kind === "MethodCall" &&
      e.receiver === null &&
      this.#callable(e) !== null
    );
  }

  #callable(call: MethodCall): Callable | null {
    const name = methodName(call);
    if (name === null || call.receiver !== null) return null;
    return this.#callableByName(name);
  }

  #callableByName(name: string): Callable | null {
    const binding = this.model.lookup(this.ref.path, name);
    return binding === undefined ? null : this.#resolveBinding(name, binding);
  }

  #resolveBinding(name: string, binding: Binding): Callable | null {
    let declaration: IncludableDeclaration | null;
    let path: string | null = this.ref.path;
    let module: string | null = null;
    let pipeline = false;
    if (binding.kind === "declaration") declaration = binding.declaration;
    else {
      declaration = binding.entry.declaration;
      pipeline = binding.entry.pipeline;
      const target = binding.include.target;
      if (target.kind === "plugin") return null;
      path = target.kind === "file" ? target.path : null;
      module =
        target.kind === "file" || target.kind === "missing"
          ? target.module
          : null;
    }
    const callable = (
      kind: Callee["kind"],
      status: Callee["status"],
      typed: boolean | null,
      signature: Callable["signature"] = fallbackSignature,
    ): Callable => ({
      callee: { name, kind, status, typed, path, module },
      signature,
    });
    if (declaration === null) return callable(null, "unresolved", null);
    if (declaration.kind === "Unparsed") {
      const keyword = declaration.head?.keyword;
      if (
        keyword !== "process" &&
        keyword !== "workflow" &&
        keyword !== "agent"
      )
        return null;
      return callable(pipeline ? "pipeline" : keyword, "unparsed", null);
    }
    if (
      pipeline &&
      (declaration.kind === "Workflow" ||
        declaration.kind === "Script" ||
        declaration.kind === "ParamsBlock")
    )
      return callable(
        "pipeline",
        "modelled",
        declaration.kind === "Workflow" ? declaration.typed : null,
        (n) => {
          const source =
            path === null ? undefined : this.model.file(path)?.source;
          return source?.language === "nextflow" && source.ast !== null
            ? pipelineSignature(source.ast)
            : fallbackSignature(n);
        },
      );
    switch (declaration.kind) {
      case "Process":
      case "Agent": {
        if (declaration.kind === "Process" && !declaration.typed) {
          const legacy = legacyProcessSignature(declaration, this.library);
          return {
            ...callable("process", "modelled", false, () => legacy),
            legacy,
          };
        }
        const signature = processSignature(declaration, this.library);
        return callable(
          declaration.kind === "Agent" ? "agent" : "process",
          "modelled",
          true,
          () => signature,
        );
      }
      case "Workflow": {
        // the emit types come from the callee's own projection, so the signature is built when a call needs it
        const workflow = declaration.name?.name ?? null;
        let signature: Signature | undefined;
        return callable("workflow", "modelled", declaration.typed, () => {
          signature ??= workflowSignature(
            declaration,
            (id) =>
              (path === null
                ? undefined
                : this.emitTypes(path, workflow).get(id)) ?? null,
          );
          return signature;
        });
      }
      default:
        return null;
    }
  }

  #isDataflow(expression: Expression): boolean {
    const e = unwrap(expression);
    if (e.kind !== "MethodCall") return false;
    if (this.#isFactoryCall(e)) return true;
    if (e.receiver === null) return this.#callable(e) !== null;
    return this.#isOperatorCall(e);
  }

  #build(
    expression: Expression,
    assigned: string | null,
    declared: FlowType | null = null,
  ): Value {
    const e = unwrap(expression) as MethodCall;
    if (this.#isFactoryCall(e)) return this.#factory(e, assigned, declared);
    if (e.receiver === null) return this.#call(e, assigned);
    if (this.#isAssignCall(e)) return this.#assign(e);
    return this.#chain(e, assigned, declared);
  }

  // ---- feeding ports ----

  /**
   * The node a dataflow expression creates, or for `<call>.<name>` the call's node with that output port (a direct
   * feed); a property that names no output reads all of them, indirectly. Null for anything else.
   */
  #nested(expression: Expression): { value: Value; direct: boolean } | null {
    if (this.#isDataflow(expression)) {
      const value = this.#build(expression, null);
      return { value, direct: value.ports.length === 1 };
    }
    const e = unwrap(expression);
    if (!this.#isOutputOfCall(e)) return null;
    if (e.kind !== "Property" && e.kind !== "Index") return null;
    const value = this.#build(e.object, null);
    const index = e.kind === "Index" ? integerIndex(e) : null;
    const name =
      e.kind === "Property" && e.property.kind === "Identifier"
        ? e.property.name
        : "";
    const named =
      index === null
        ? value.ports.filter((p) => p.id === name)
        : value.ports.slice(index, index + 1);
    return named.length > 0
      ? { value: { node: value.node, ports: named }, direct: true }
      : { value, direct: false };
  }

  #feed(expression: Expression): Feed {
    const range = expression.range;
    const nested = this.#nested(expression);
    if (nested !== null)
      return this.#valueFeed(nested.value, range, nested.direct);
    const ref = this.#reference(expression);
    if (ref !== null) return readFeed(range, ref.read, ref.resolved);
    const edges: FeedEdge[] = [];
    for (const read of variablesRead(expression, { closures: false })) {
      const resolved = this.#scope.resolveRead(read);
      if (resolved !== null) edges.push(...edgesOf(resolved, false));
    }
    return { range, edges, type: inlineType(expression, this.library) };
  }

  /** A feed that reads the variable `name` whole (a bare `emit: x` or `publish: x`). */
  #feedName(name: string, range: Range): Feed {
    const read = { name, properties: [] };
    const resolved = this.#scope.resolveRead(read);
    return resolved === null
      ? { range, edges: [], type: null }
      : readFeed(range, read, resolved);
  }

  #connect(feed: Feed, to: PortRef): void {
    for (const edge of feed.edges) {
      const id = `${edge.from.node}[${edge.from.port}] -> ${to.node}[${to.port}]`;
      if (!this.#edges.has(id))
        this.#edges.set(id, {
          id,
          from: edge.from,
          to,
          type: edge.type,
          variable: edge.variable,
          direct: edge.direct,
        });
    }
  }

  // ---- nodes ----

  #call(call: MethodCall, assigned: string | null): Value {
    const callable = this.#callable(call) as Callable;
    const record =
      callable.callee.kind === "pipeline" &&
      callable.callee.status === "modelled"
        ? recordArguments(call)
        : null;
    const args =
      record === null
        ? call.args.map(argumentValue)
        : record.map((r) => r.value);
    const feeds = args.map((a) => this.#feed(a));
    return this.#callNode(callable, feeds, record, call.range, assigned);
  }

  /** The call node for `callable` with one feed per argument (a pipeline's `record(...)` keys them by name). */
  #callNode(
    callable: Callable,
    feeds: readonly Feed[],
    record: ReturnType<typeof recordArguments>,
    range: Range,
    assigned: string | null,
  ): Value {
    const pipeline =
      callable.callee.kind === "pipeline" &&
      callable.callee.status === "modelled";
    const signature = callable.signature(feeds.length);
    // each feed goes to the input port with the same position, or, for a pipeline's record(...), the same name
    const inputSpecs: PortSpec[] = [];
    const fed = new Map<string, Feed>();
    if (record !== null) {
      inputSpecs.push(...signature.inputs);
      record.forEach((r, i) => {
        if (!inputSpecs.some((s) => s.id === r.key))
          inputSpecs.push(spec(r.key, null));
        fed.set(r.key, feeds[i] as Feed);
      });
    } else {
      const count = pipeline
        ? feeds.length
        : Math.max(signature.inputs.length, feeds.length);
      for (let i = 0; i < count; i++) {
        const input =
          (pipeline ? undefined : signature.inputs[i]) ??
          spec(`$${i + 1}`, null);
        inputSpecs.push(input);
        if (feeds[i]) fed.set(input.id, feeds[i] as Feed);
      }
    }
    const { callee } = callable;
    const kind =
      callable.legacy === undefined
        ? callDataflow(feeds.map((f) => f.type))
        : legacyResultDataflow(
            callable.legacy,
            feeds.map((f) => f.type?.dataflow ?? null),
          );
    const processLike = callee.kind === "process" || callee.kind === "agent";
    const outputs = signature.outputs.map((o): PortSpec => {
      if (!processLike || (!callee.typed && callable.legacy === undefined))
        return o;
      const element = o.type?.element ?? null;
      return {
        ...o,
        type:
          o.type !== null &&
          (o.type.dataflow === "channel" || o.type.dataflow === "value")
            ? o.type
            : wrapFlow(kind, element),
      };
    });
    const name = callee.name;
    const id =
      assigned === null
        ? this.#keys.unassigned(name)
        : this.#keys.assigned(assigned);
    this.#add({
      id,
      kind: "call",
      label: name,
      inputs: inputSpecs.map((s) => port(s, fed.get(s.id))),
      outputs: outputs.map((s) => port(s)),
      range,
      callee,
    });
    for (const [input, feed] of fed)
      this.#connect(feed, { node: id, port: input });
    const value = { node: id, ports: outputs };
    this.#scope.recordCall(callee.name, value);
    return value;
  }

  // ---- pipes ----

  /** A pipe's steps with its final `set { v }` taken off; null when the expression isn't a projectable pipe. */
  #pipeOf(e: Expression): PipePlan | null {
    if (!this.#legacy || e.kind !== "Binary") return null;
    const pipe = pipeSteps(e);
    if (pipe === null) return null;
    const steps = [...pipe.steps];
    const source = unwrap(pipe.source);
    if (
      !(
        this.#isDataflow(source) ||
        this.#isOutputOfCall(source) ||
        this.#aliasable(this.#reference(source))
      )
    )
      return null;
    const last = steps[steps.length - 1];
    const target =
      last?.kind === "step" && last.expression.kind === "MethodCall"
        ? setTarget(last.expression)
        : null;
    const set = target?.form === "set" ? target.variable.name : null;
    if (set !== null) steps.pop();
    for (const step of steps) {
      if (step.kind === "fork") {
        if (!step.names.every((n) => this.#callableByName(n) !== null))
          return null;
      } else if (step.kind === "step") {
        const callable = this.#callableByName(step.name) !== null;
        // `set` is only the last step, and `tap` isn't a step: both would have to bind
        const operator =
          this.library.legacyResult(step.name) !== "assign" &&
          this.library.isOperator(step.name, null);
        if (!callable && !operator) return null;
      }
    }
    return { source, steps, set };
  }

  /** A feed for one or more ports of a value (several ports of one value are read indirectly). */
  #valueFeed(
    value: Value,
    range: Range | null,
    direct = value.ports.length === 1,
  ): Feed {
    return {
      range,
      edges: value.ports.map((p) => ({
        from: { node: value.node, port: p.id },
        type: p.type ?? UNKNOWN,
        variable: null,
        direct,
      })),
      type: direct ? (value.ports[0]?.type ?? null) : null,
    };
  }

  /** `a | b | (c & d) | e`: the values the last step produces. The last node takes `assigned` (or the `set` variable). */
  #pipe({ source, steps, set }: PipePlan, assigned: string | null): Value[] {
    const final = set ?? assigned;
    const ref =
      this.#isDataflow(source) || this.#isOutputOfCall(source)
        ? null
        : this.#reference(source);
    let current: Value[] =
      ref === null
        ? [(this.#nested(source) as { value: Value }).value]
        : this.#valuesOf(ref.resolved);
    let at = 0;
    while (at < steps.length) {
      const step = steps[at] as PipeStep;
      const range = step.range;
      const spread = current.flatMap((v) =>
        v.ports.map((p) => this.#valueFeed({ node: v.node, ports: [p] }, null)),
      );
      if (step.kind === "fork") {
        current = step.names.map((name) =>
          this.#callNode(
            this.#callableByName(name) as Callable,
            spread,
            null,
            range,
            null,
          ),
        );
        at += 1;
      } else if (step.kind === "step" && this.#callableByName(step.name)) {
        const extra =
          step.expression.kind === "MethodCall"
            ? step.expression.args.map((a) => this.#feed(argumentValue(a)))
            : [];
        current = [
          this.#callNode(
            this.#callableByName(step.name) as Callable,
            [...spread, ...extra],
            null,
            range,
            at === steps.length - 1 ? final : null,
          ),
        ];
        at += 1;
      } else {
        // consecutive operators are one chain, on the first value, with the other values as argument ports
        const group: StepCall[] = [];
        let end = at;
        while (end < steps.length) {
          const s = steps[end] as PipeStep;
          if (s.kind !== "step" || this.#callableByName(s.name) !== null) break;
          group.push(
            stepCall(
              s.name,
              s.range,
              s.expression.kind === "MethodCall" ? s.expression : null,
            ),
          );
          end += 1;
        }
        const [first, ...rest] = current;
        current = [
          this.#chainNode(
            range,
            this.#valueFeed(first as Value, null),
            rest.map((v) => this.#valueFeed(v, null)),
            group,
            end === steps.length ? final : null,
            null,
          ),
        ];
        at = end;
      }
    }
    if (set !== null) this.#bindValues(set, current);
    return current;
  }

  /** What a branch of a ternary or elvis expression stands for: dataflow, a graph reference, or neither. */
  #branchKind(e: Expression): "dataflow" | "reference" | "other" {
    const x = unwrap(e);
    if (
      this.#pipeOf(x) !== null ||
      this.#isDataflow(x) ||
      this.#isOutputOfCall(x)
    )
      return "dataflow";
    if (this.#aliasable(this.#reference(x))) return "reference";
    return "other";
  }

  /**
   * `x = c ? A : B` and `x = a ?: b`, where a branch is dataflow or a graph reference and the others read no graph
   * value: dataflow branches become nodes guarded by the condition (the first keyed `x`, the next `x~2`), and `x`
   * is bound to every branch's values. False for any other expression.
   */
  #conditionalValue(e: Expression, variable: string): boolean {
    const branches = branchesOf(e);
    if (branches === null) return false;
    const kinds = branches.map((b) => this.#branchKind(b.expression));
    if (!kinds.some((k) => k !== "other")) return false;
    const readsNothing = branches.every(
      (b, i) =>
        kinds[i] !== "other" ||
        variablesRead(b.expression, { closures: false }).every(
          (r) => this.#scope.resolveRead(r) === null,
        ),
    );
    if (!readsNothing) return false;
    const values: Value[] = [];
    branches.forEach((b, i) => {
      const x = unwrap(b.expression);
      if (kinds[i] === "other") return;
      this.#guarded(b.guard, () => {
        const pipe = this.#pipeOf(x);
        if (kinds[i] === "reference") {
          const ref = this.#reference(x);
          if (ref !== null) values.push(...this.#valuesOf(ref.resolved));
        } else if (pipe !== null) values.push(...this.#pipe(pipe, variable));
        else if (this.#isDataflow(x)) values.push(this.#build(x, variable));
        else values.push((this.#nested(x) as { value: Value }).value);
      });
    });
    this.#bindValues(variable, values);
    return true;
  }

  /**
   * `E.set { v }` behaves like `v = E`, and `E.tap { v }` ends the chain there: E's top node is keyed `v` and any
   * operators after the tap read it (AR-12). Neither makes a node of its own.
   */
  #assign(call: MethodCall): Value {
    const target = setTarget(call) as NonNullable<ReturnType<typeof setTarget>>;
    const receiver = unwrap(call.receiver as Expression);
    const value = this.#isDataflow(receiver)
      ? this.#build(receiver, target.variable.name)
      : (this.#nested(receiver) as { value: Value }).value;
    this.#bindValues(target.variable.name, [value]);
    return value;
  }

  #factory(
    call: MethodCall,
    assigned: string | null,
    declared: FlowType | null,
  ): Value {
    const receiver = call.receiver as Expression & { kind: "Variable" };
    const name = methodName(call) as string;
    const positional = call.args.filter((a) => a.kind !== "NamedArgument");
    const types = positional.map((a) => {
      const t = inlineType(argumentValue(a), this.library);
      return t?.dataflow === "plain" ? t.element : null;
    });
    const named = call.args.some((a) => a.kind === "NamedArgument");
    const result = this.library.factoryType(name, types, named);
    const type = declared ?? result;
    const label = `channel.${name}`;
    const id =
      assigned === null
        ? this.#keys.unassigned(label)
        : this.#keys.assigned(assigned);
    this.#add({
      id,
      kind: "factory",
      label,
      inputs: [],
      outputs: [port(spec(OUT, type))],
      range: call.range,
      namespace: receiver.name,
      factory: name,
    });
    return { node: id, ports: [spec(OUT, type)] };
  }

  #chain(
    outer: MethodCall,
    assigned: string | null,
    declared: FlowType | null,
  ): Value {
    const calls: MethodCall[] = [];
    let at: Expression = outer;
    for (;;) {
      at = unwrap(at);
      // a `tap` or `set` ends the chain: what it taps is the base, keyed by its variable
      if (
        at.kind === "MethodCall" &&
        !this.#isFactoryCall(at) &&
        this.#isOperatorCall(at) &&
        !this.#isAssignCall(at)
      ) {
        calls.unshift(at);
        at = at.receiver as Expression;
      } else break;
    }
    const steps = calls.map((call) =>
      stepCall(methodName(call) as string, call.range, call),
    );
    return this.#chainNode(
      outer.range,
      this.#feed(at),
      [],
      steps,
      assigned,
      declared,
    );
  }

  /**
   * The chain node for `steps` on `base`. `extras` are further values the receiver stands for (the other results of
   * a fork): they go to the first step's argument ports.
   */
  #chainNode(
    range: Range,
    base: Feed,
    extras: readonly Feed[],
    calls: readonly StepCall[],
    assigned: string | null,
    declared: FlowType | null,
  ): Value {
    let current: FlowType = base.type ?? UNKNOWN;
    let voidEnd = false;
    const pending: { port: Port; feed: Feed }[] = [];
    const steps = calls.map((call, index): ChainStep => {
      const operator = call.operator;
      const stepNumber = index + 1;
      const named = call.args.some((a) => a.kind === "NamedArgument");
      const closures = call.closures;
      const feeds: { argument: Argument | null; feed: Feed | null }[] = [
        ...(index === 0 ? extras : []).map((feed) => ({
          argument: null,
          feed,
        })),
        ...call.args.map((argument) => ({
          argument,
          feed:
            argument.kind === "Closure"
              ? null
              : this.#feed(argumentValue(argument)),
        })),
      ];
      const operatorArguments: OperatorArguments = {
        positional: feeds
          .filter(
            (f) => f.argument?.kind !== "NamedArgument" && f.feed !== null,
          )
          .map((f) => (f.feed as Feed).type),
        named,
        closures,
      };
      const names = this.library.parameterNames(
        operator,
        current,
        operatorArguments,
      );
      let positionalSeen = 0;
      feeds.forEach(({ argument, feed }, argIndex) => {
        const isNamed = argument?.kind === "NamedArgument";
        if (!isNamed) positionalSeen += 1;
        if (feed === null || feed.edges.length === 0) return;
        const parameter =
          names?.[isNamed ? 0 : positionalSeen - 1 + (named ? 1 : 0)];
        pending.push({
          port: port(
            {
              id: `${stepNumber}:${argIndex + 1}`,
              label: `${operator}(${parameter ?? argIndex + 1})`,
              type: null,
            },
            feed,
          ),
          feed,
        });
      });
      const legacy = this.library.legacyResult(operator);
      const result =
        legacy !== null && legacy !== "assign"
          ? legacyOperatorType(operator, legacy, current)
          : this.library.operatorType(operator, current, operatorArguments);
      voidEnd = result === "void" && index === calls.length - 1;
      current = result === "void" ? UNKNOWN : result;
      return { operator, range: call.range, known: legacy === null };
    });
    const first = steps[0]?.operator ?? "";
    const id =
      assigned === null
        ? this.#keys.unassigned(`.${first}`)
        : this.#keys.assigned(assigned);
    const outputs = voidEnd ? [] : [spec(OUT, declared ?? current)];
    this.#add({
      id,
      kind: "chain",
      label: steps.map((s) => `.${s.operator}`).join(""),
      inputs: [port(spec("in", null), base), ...pending.map((p) => p.port)],
      outputs: outputs.map((s) => port(s)),
      range,
      steps,
    });
    this.#connect(base, { node: id, port: "in" });
    for (const p of pending)
      this.#connect(p.feed, { node: id, port: p.port.id });
    return { node: id, ports: outputs };
  }

  #sortedEdges(): GraphEdge[] {
    const order = new Map(this.#nodes.map((n, i) => [n.id, i]));
    const portOrder = (ref: PortRef, side: "inputs" | "outputs"): number => {
      const n = this.#nodes[order.get(ref.node) ?? -1];
      return n?.[side].findIndex((p) => p.id === ref.port) ?? -1;
    };
    return [...this.#edges.values()].sort(
      (a, b) =>
        (order.get(a.to.node) ?? 0) - (order.get(b.to.node) ?? 0) ||
        portOrder(a.to, "inputs") - portOrder(b.to, "inputs") ||
        (order.get(a.from.node) ?? 0) - (order.get(b.from.node) ?? 0) ||
        portOrder(a.from, "outputs") - portOrder(b.from, "outputs"),
    );
  }
}

/** `record(k: v, …)` as a call's only argument: its entries; null for any other shape. */
function recordArguments(
  call: MethodCall,
): { key: string; value: Expression }[] | null {
  const only = call.args.length === 1 ? call.args[0] : undefined;
  const inner = only === undefined ? undefined : unwrap(only as Expression);
  if (
    inner?.kind !== "MethodCall" ||
    inner.receiver !== null ||
    methodName(inner) !== "record" ||
    inner.args.length === 0
  )
    return null;
  const entries: { key: string; value: Expression }[] = [];
  for (const a of inner.args) {
    if (a.kind !== "NamedArgument") return null;
    entries.push({
      key: a.name.kind === "Identifier" ? a.name.name : a.name.value,
      value: a.value,
    });
  }
  return entries;
}

const isChain = (e: Expression): boolean =>
  e.kind === "Variable" ||
  (e.kind === "Property" &&
    e.property.kind === "Identifier" &&
    e.navigation !== "*." &&
    isChain(e.object));

/** The types of a projection's emits that come straight from one value: its emit nodes' single direct feed. */
function inferredEmits(projection: Projection): ReadonlyMap<string, FlowType> {
  const types = new Map<string, FlowType>();
  for (const node of projection.nodes) {
    if (node.kind !== "emit") continue;
    const feeds = projection.edges.filter(
      (e) => e.to.node === node.id && e.to.port === "in",
    );
    const only = feeds.length === 1 ? feeds[0] : undefined;
    if (only?.direct) types.set(node.name, only.type);
  }
  return types;
}

export interface ProjectorOptions {
  /** The pack's legacy-only operators (F-107). */
  readonly legacyOperators?: readonly LegacyOperator[];
}

export function createProjector(
  model: ProjectModel,
  catalogue: ScriptCatalogue,
  options: ProjectorOptions = {},
): Projector {
  const library = dataflowLibrary(catalogue, options.legacyOperators);
  // a projector is a snapshot of the model (F-113 replaces it after a change)
  let all: Listed[] | undefined;
  const listed = (): Listed[] =>
    (all ??= model.paths().flatMap((path) => {
      const file = model.file(path);
      return file ? listWorkflows(file.source) : [];
    }));

  const memo = new Map<string, ReadonlyMap<string, FlowType>>();
  const active = new Set<string>();
  let cycles = 0;

  /** Projects one workflow; a workflow met again while it is being projected is a cycle (`emitTypes` gives unknown). */
  function build(path: string, workflow: string | null): Projection | null {
    const found = listed().find(
      (l) => l.ref.path === path && l.ref.name === workflow,
    );
    const file = model.file(path);
    if (found === undefined || found.node === null || file === undefined)
      return null;
    const key = `${path}#${workflow ?? ""}`;
    active.add(key);
    try {
      return new Projecting(
        model,
        library,
        file.source.text,
        found.ref,
        found.node,
        emitTypes,
      ).run();
    } finally {
      active.delete(key);
    }
  }

  const none: ReadonlyMap<string, FlowType> = new Map();
  const emitTypes: EmitTypes = (path, workflow) => {
    const key = `${path}#${workflow ?? ""}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (active.has(key)) {
      cycles += 1;
      return none;
    }
    const before = cycles;
    try {
      const projection = build(path, workflow);
      const types = projection === null ? none : inferredEmits(projection);
      // a result that met a cycle depends on where the walk started, so only cycle-free ones are kept
      if (cycles === before) memo.set(key, types);
      return types;
    } catch {
      return none;
    }
  };

  return {
    workflows: () => listed().map((l) => l.ref),
    project(path, workflow) {
      try {
        return build(path, workflow);
      } catch {
        return null;
      }
    },
  };
}
