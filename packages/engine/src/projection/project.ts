// The projection (AR-10, F-106): one graph per workflow, computed from the project model. Nodes are calls, chains,
// factories, takes, params and code shells; edges are def-use links. Plain data, deterministic, never throws (IO-14).
// Node keys: ./keys.ts. Types: ./types.ts, with nf-lang's call-typing rules in ./signature.ts (Apache-2.0).

import type {
  Callee,
  Expression,
  FlowType,
  GraphEdge,
  GraphNode,
  IncludableDeclaration,
  MethodCall,
  Port,
  PortRef,
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
import { inlineType } from "./inline";
import { KeyAllocator } from "./keys";
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

interface Callable {
  readonly callee: Callee;
  readonly signature: (argumentCount: number) => Signature;
}

/** What a feeding expression contributes to an input port. */
interface Feed {
  readonly range: Range;
  readonly edges: readonly FeedEdge[];
  /** The type of the argument when known: its source for a direct feed, else its inline type. */
  readonly type: FlowType | null;
}
type FeedEdge = Omit<GraphEdge, "id" | "to">;

const OUT = "out";
const unwrap = (expression: Expression): Expression =>
  expression.kind === "Parenthesized"
    ? unwrap(expression.expression)
    : expression;
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

class Projecting {
  readonly #nodes: GraphNode[] = [];
  readonly #edges = new Map<string, GraphEdge>();
  readonly #scope = new WorkflowScope();
  readonly #keys: KeyAllocator;

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
      this.#nodes.push({
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
    if (!(entry && block !== null) && read.size === 0) return;
    const specs: PortSpec[] = [];
    for (const p of block?.params ?? [])
      specs.push(spec(p.name.name, flowFromDeclared(p.type)));
    for (const name of read)
      if (!specs.some((s) => s.id === name)) specs.push(spec(name, null));
    const id = this.#keys.params();
    this.#nodes.push({
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
      this.#nodes.push({
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
    this.#nodes.push({
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

  #statement(statement: Statement): void {
    if (statement.kind === "EmptyStatement") return;
    let variable: string | null = null;
    let expression: Expression | null = null;
    let declared: TypeRef | null = null;
    if (statement.kind === "ExpressionStatement")
      expression = statement.expression;
    else if (
      statement.kind === "VariableDeclaration" &&
      !statement.multiple &&
      statement.targets.length === 1 &&
      statement.initializer !== null
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
    if (expression !== null && this.#isDataflow(expression)) {
      const value = this.#build(
        expression,
        variable,
        flowFromDeclared(declared),
      );
      if (variable !== null) this.#scope.bind(variable, [value]);
      return;
    }
    this.#code(statement, variable, expression);
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
      isCode: (id) => this.#nodes.some((n) => n.id === id && n.kind === "code"),
      // a copy of a graph value (`w2 = w`) has that value's type; anything else an inline one
      assignedType: () =>
        variable === null || expression === null
          ? null
          : this.#feed(expression).type,
    });
    this.#nodes.push(node);
    for (const edge of edges) this.#edges.set(edge.id, edge);
    // each assigned name now stands for this node's port of that name, replacing an earlier binding
    for (const output of node.outputs)
      this.#scope.bind(output.id, [{ node: node.id, ports: [output] }]);
  }

  // ---- dataflow expressions ----

  /** A variable, or a chain of simple properties on one, that the scope resolves to graph values. */
  #reference(expression: Expression) {
    const e = unwrap(expression);
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
      this.library.isFactory(receiver.name, name)
    );
  }

  /** A catalogue operator on a dataflow expression, or on a reference whose single source isn't plain. */
  #isOperatorCall(call: MethodCall): boolean {
    const name = methodName(call);
    if (name === null || call.receiver === null) return false;
    const receiver = unwrap(call.receiver);
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
    return (
      e.kind === "Property" &&
      e.property.kind === "Identifier" &&
      this.#isDataflow(e.object)
    );
  }

  #callable(call: MethodCall): Callable | null {
    const name = methodName(call);
    if (name === null || call.receiver !== null) return null;
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
        if (declaration.kind === "Process" && !declaration.typed)
          return callable("process", "modelled", false);
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
    if (!this.#isOutputOfCall(e) || e.kind !== "Property") return null;
    const value = this.#build(e.object, null);
    const name = e.property.kind === "Identifier" ? e.property.name : "";
    const named = value.ports.filter((p) => p.id === name);
    return named.length > 0
      ? { value: { node: value.node, ports: named }, direct: true }
      : { value, direct: false };
  }

  #feed(expression: Expression): Feed {
    const range = expression.range;
    const nested = this.#nested(expression);
    if (nested !== null) {
      const { value, direct } = nested;
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
    const pipeline =
      callable.callee.kind === "pipeline" &&
      callable.callee.status === "modelled";
    const record = pipeline ? recordArguments(call) : null;
    const args =
      record === null
        ? call.args.map(argumentValue)
        : record.map((r) => r.value);
    const feeds = args.map((a) => this.#feed(a));
    const signature = callable.signature(args.length);
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
        ? args.length
        : Math.max(signature.inputs.length, args.length);
      for (let i = 0; i < count; i++) {
        const input =
          (pipeline ? undefined : signature.inputs[i]) ??
          spec(`$${i + 1}`, null);
        inputSpecs.push(input);
        if (feeds[i]) fed.set(input.id, feeds[i] as Feed);
      }
    }
    const { callee } = callable;
    const kind = callDataflow(feeds.map((f) => f.type));
    const processLike = callee.kind === "process" || callee.kind === "agent";
    const outputs = signature.outputs.map((o): PortSpec => {
      if (!processLike || !callee.typed) return o;
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
    this.#nodes.push({
      id,
      kind: "call",
      label: name,
      inputs: inputSpecs.map((s) => port(s, fed.get(s.id))),
      outputs: outputs.map((s) => port(s)),
      range: call.range,
      callee,
    });
    for (const [input, feed] of fed)
      this.#connect(feed, { node: id, port: input });
    return { node: id, ports: outputs };
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
    this.#nodes.push({
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
      if (
        at.kind === "MethodCall" &&
        !this.#isFactoryCall(at) &&
        this.#isOperatorCall(at)
      ) {
        calls.unshift(at);
        at = at.receiver as Expression;
      } else break;
    }
    const base = this.#feed(at);
    let current: FlowType = base.type ?? UNKNOWN;
    let voidEnd = false;
    const pending: { port: Port; feed: Feed }[] = [];
    const steps = calls.map((call, index) => {
      const operator = methodName(call) as string;
      const stepNumber = index + 1;
      const named = call.args.some((a) => a.kind === "NamedArgument");
      const closures =
        call.closures.length +
        call.args.filter((a) => a.kind === "Closure").length;
      const feeds = call.args.map((argument) => ({
        argument,
        feed:
          argument.kind === "Closure"
            ? null
            : this.#feed(argumentValue(argument)),
      }));
      const operatorArguments: OperatorArguments = {
        positional: feeds
          .filter((f) => f.argument.kind !== "NamedArgument" && f.feed !== null)
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
        const isNamed = argument.kind === "NamedArgument";
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
      const result = this.library.operatorType(
        operator,
        current,
        operatorArguments,
      );
      voidEnd = result === "void" && index === calls.length - 1;
      current = result === "void" ? UNKNOWN : result;
      return { operator, range: call.range, known: true };
    });
    const first = steps[0]?.operator ?? "";
    const id =
      assigned === null
        ? this.#keys.unassigned(`.${first}`)
        : this.#keys.assigned(assigned);
    const outputs = voidEnd ? [] : [spec(OUT, declared ?? current)];
    this.#nodes.push({
      id,
      kind: "chain",
      label: steps.map((s) => `.${s.operator}`).join(""),
      inputs: [port(spec("in", null), base), ...pending.map((p) => p.port)],
      outputs: outputs.map((s) => port(s)),
      range: outer.range,
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

export function createProjector(
  model: ProjectModel,
  catalogue: ScriptCatalogue,
): Projector {
  const library = dataflowLibrary(catalogue);
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
