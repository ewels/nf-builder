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
import { inlineType } from "./inline";
import { KeyAllocator } from "./keys";
import {
  type DataflowLibrary,
  dataflowLibrary,
  type OperatorArguments,
} from "./library";
import { variablesRead } from "./reads";
import { type Value, WorkflowScope } from "./scope";
import {
  callDataflow,
  fallbackSignature,
  type PortSpec,
  processSignature,
  type Signature,
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
  /** The type of an inline argument (it reads no graph value). */
  readonly argumentType: FlowType | null;
}
interface FeedEdge {
  readonly from: PortRef;
  readonly type: FlowType;
  readonly variable: string | null;
  readonly direct: boolean;
}

const OUT = "out";
const unwrap = (expression: Expression): Expression =>
  expression.kind === "Parenthesized"
    ? unwrap(expression.expression)
    : expression;
const argumentValue = (argument: MethodCall["args"][number]): Expression =>
  argument.kind === "NamedArgument" ? argument.value : argument;
const methodName = (call: MethodCall): string | null =>
  call.method.kind === "Identifier" ? call.method.name : null;

function spec(id: string, type: FlowType | null): PortSpec {
  return { id, label: id, type };
}
function port(
  s: PortSpec,
  argument: Range | null = null,
  argumentType: FlowType | null = null,
): Port {
  return { id: s.id, label: s.label, type: s.type, argument, argumentType };
}

class Projecting {
  readonly #nodes: GraphNode[] = [];
  readonly #edges = new Map<string, GraphEdge>();
  readonly #scope = new WorkflowScope();
  readonly #keys: KeyAllocator;

  constructor(
    private readonly model: ProjectModel,
    private readonly library: DataflowLibrary,
    private readonly path: string,
    private readonly text: string,
    private readonly ref: WorkflowRef,
    private readonly node: WorkflowNode,
  ) {
    this.#keys = new KeyAllocator(path, ref.name);
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
      this.#push({
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
    return {
      workflow: this.ref,
      nodes: this.#nodes,
      edges: this.#sortedEdges(),
    };
  }

  #push(node: GraphNode): void {
    this.#nodes.push(node);
  }

  // ---- params ----

  #addParams(node: WorkflowNode): void {
    const source = this.model.file(this.path)?.source;
    const ast = source?.language === "nextflow" ? source.ast : null;
    const block = ast?.body.find((i) => i.kind === "ParamsBlock") ?? null;
    const read = new Set<string>();
    const sections =
      node.kind === "Workflow"
        ? [node.main, node.emits, node.publishers].filter((s) => s !== null)
        : scriptStatements(node);
    for (const section of sections)
      for (const r of variablesRead(section, { closures: false }))
        if (r.name === "params" && r.property !== null) read.add(r.property);
    const entry = this.ref.name === null;
    if (!(entry && block !== null) && read.size === 0) return;
    const specs: PortSpec[] = [];
    for (const p of block?.params ?? [])
      specs.push(spec(p.name.name, flowFromDeclared(p.type)));
    for (const name of read)
      if (!specs.some((s) => s.id === name)) specs.push(spec(name, null));
    const id = this.#keys.params();
    this.#push({
      id,
      kind: "params",
      label: "params",
      inputs: [],
      outputs: specs.map((s) => port(s)),
      range: block?.range ?? node.range,
    });
    this.#scope.bind("params", [{ node: id, ports: specs }]);
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
    const id =
      variable === null ? this.#keys.code() : this.#keys.assigned(variable);
    const outputs =
      variable === null
        ? []
        : [
            spec(
              variable,
              expression === null ? null : inlineType(expression, this.library),
            ),
          ];
    const first = this.text
      .slice(statement.range.start, statement.range.end)
      .split("\n")[0]
      ?.trim();
    const label =
      (first ?? "").length > 60 ? `${first?.slice(0, 59)}…` : (first ?? "");
    this.#push({
      id,
      kind: "code",
      label,
      inputs: [],
      outputs: outputs.map((s) => port(s)),
      range: statement.range,
    });
    if (variable !== null)
      this.#scope.bind(variable, [{ node: id, ports: outputs }]);
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

  /** The dataflow of what a receiver stands for, when it is a reference whose source type is known. */
  #receiverDataflow(receiver: Expression): FlowType["dataflow"] {
    const sources = this.#reference(receiver)?.resolved.sources ?? [];
    return sources.length === 1 ? (sources[0]?.type?.dataflow ?? null) : null;
  }

  #isOperatorCall(call: MethodCall): boolean {
    const name = methodName(call);
    if (name === null || call.receiver === null) return false;
    const receiver = unwrap(call.receiver);
    const isDe = this.#isDataflow(receiver);
    if (!isDe && this.#reference(receiver) === null) return false;
    const kind = isDe ? null : this.#receiverDataflow(receiver);
    if (kind === "plain") return false;
    return this.library.isOperator(name, kind);
  }

  #callable(call: MethodCall): Callable | null {
    const name = methodName(call);
    if (name === null || call.receiver !== null) return null;
    const binding = this.model.lookup(this.path, name);
    return binding === undefined ? null : this.#resolveBinding(name, binding);
  }

  #resolveBinding(name: string, binding: Binding): Callable | null {
    let declaration: IncludableDeclaration | null;
    let path: string | null = this.path;
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
      if (declaration === null)
        return {
          callee: unresolved(name, null, "unresolved", path, module),
          signature: (n) => fallbackSignature(null, n),
        };
    }
    const base = { path, module };
    if (declaration.kind === "Unparsed") {
      const keyword = declaration.head?.keyword;
      if (
        keyword !== "process" &&
        keyword !== "workflow" &&
        keyword !== "agent"
      )
        return null;
      const kind = pipeline ? "pipeline" : keyword;
      return {
        callee: { name, kind, status: "unparsed", typed: null, ...base },
        signature: (n) => fallbackSignature(kind, n),
      };
    }
    if (
      pipeline &&
      (declaration.kind === "Workflow" ||
        declaration.kind === "Script" ||
        declaration.kind === "ParamsBlock")
    )
      return {
        callee: {
          name,
          kind: "pipeline",
          status: "modelled",
          typed: declaration.kind === "Workflow" ? declaration.typed : null,
          ...base,
        },
        signature: (n) => fallbackSignature("pipeline", n),
      };
    switch (declaration.kind) {
      case "Process":
        return declaration.typed
          ? this.#modelled(
              name,
              base,
              processSignature(declaration, this.library),
            )
          : {
              callee: {
                name,
                kind: "process",
                status: "modelled",
                typed: false,
                ...base,
              },
              signature: (n) => ({
                ...fallbackSignature("process", n),
                typed: false,
              }),
            };
      case "Agent":
        return this.#modelled(
          name,
          base,
          processSignature(declaration, this.library),
        );
      case "Workflow":
        return this.#modelled(
          name,
          base,
          workflowSignature(declaration, () => null),
        );
      default:
        return null;
    }
  }

  #modelled(
    name: string,
    base: { path: string | null; module: string | null },
    signature: Signature,
  ): Callable {
    return {
      callee: {
        name,
        kind: signature.kind,
        status: "modelled",
        typed: signature.typed,
        ...base,
      },
      signature: () => signature,
    };
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

  #feed(expression: Expression): Feed {
    const range = expression.range;
    if (this.#isDataflow(expression)) {
      const value = this.#build(expression, null);
      const direct = value.ports.length === 1;
      return {
        range,
        edges: value.ports.map((p) => ({
          from: { node: value.node, port: p.id },
          type: p.type ?? UNKNOWN,
          variable: null,
          direct,
        })),
        type: direct ? (value.ports[0]?.type ?? null) : null,
        argumentType: null,
      };
    }
    const ref = this.#reference(expression);
    if (ref !== null) {
      const { read, resolved } = ref;
      const direct =
        resolved.sources.length === 1 &&
        resolved.consumed === read.properties.length;
      return {
        range,
        edges: resolved.sources.map((s) => ({
          from: s.port,
          type: s.type ?? UNKNOWN,
          variable: resolved.variable,
          direct,
        })),
        type: direct ? (resolved.sources[0]?.type ?? null) : null,
        argumentType: null,
      };
    }
    const edges: FeedEdge[] = [];
    for (const read of variablesRead(expression, { closures: false })) {
      const resolved = this.#scope.resolveRead(read);
      if (resolved === null) continue;
      for (const s of resolved.sources)
        edges.push({
          from: s.port,
          type: s.type ?? UNKNOWN,
          variable: resolved.variable,
          direct: false,
        });
    }
    const inline = inlineType(expression, this.library);
    return {
      range,
      edges,
      type: inline,
      argumentType: edges.length === 0 ? inline : null,
    };
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
    const args = call.args.map(argumentValue);
    const feeds = args.map((a) => this.#feed(a));
    const signature = callable.signature(args.length);
    const count = Math.max(signature.inputs.length, args.length);
    const inputSpecs = Array.from(
      { length: count },
      (_, i) => signature.inputs[i] ?? spec(`$${i + 1}`, null),
    );
    const kind = callDataflow(feeds.map((f) => f.type));
    const processLike =
      signature.kind === "process" || signature.kind === "agent";
    const outputs = signature.outputs.map((o): PortSpec => {
      if (!processLike || !callable.callee.typed) return o;
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
    const name = callable.callee.name;
    const id =
      assigned === null
        ? this.#keys.unassigned(name)
        : this.#keys.assigned(assigned);
    this.#push({
      id,
      kind: "call",
      label: name,
      inputs: inputSpecs.map((s, i) =>
        port(
          s,
          feeds[i] ? feeds[i].range : null,
          feeds[i]?.argumentType ?? null,
        ),
      ),
      outputs: outputs.map((s) => port(s)),
      range: call.range,
      callee: callable.callee,
    });
    feeds.forEach((feed, i) => {
      const input = inputSpecs[i];
      if (input) this.#connect(feed, { node: id, port: input.id });
    });
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
    this.#push({
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
          port: {
            id: `${stepNumber}:${argIndex + 1}`,
            label: `${operator}(${parameter ?? argIndex + 1})`,
            type: null,
            argument: feed.range,
            argumentType: null,
          },
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
    this.#push({
      id,
      kind: "chain",
      label: steps.map((s) => `.${s.operator}`).join(""),
      inputs: [
        port(spec("in", null), base.range),
        ...pending.map((p) => p.port),
      ],
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

function unresolved(
  name: string,
  kind: Callee["kind"],
  status: Callee["status"],
  path: string | null,
  module: string | null,
): Callee {
  return { name, kind, status, typed: null, path, module };
}

const isChain = (e: Expression): boolean =>
  e.kind === "Variable" ||
  (e.kind === "Property" &&
    e.property.kind === "Identifier" &&
    isChain(e.object));

export function createProjector(
  model: ProjectModel,
  catalogue: ScriptCatalogue,
): Projector {
  const library = dataflowLibrary(catalogue);
  const listed = (): Listed[] =>
    model.paths().flatMap((path) => {
      const file = model.file(path);
      return file ? listWorkflows(file.source) : [];
    });
  return {
    workflows: () => listed().map((l) => l.ref),
    project(path, workflow) {
      try {
        const found = listed().find(
          (l) => l.ref.path === path && l.ref.name === workflow,
        );
        const file = model.file(path);
        if (found === undefined || found.node === null || file === undefined)
          return null;
        return new Projecting(
          model,
          library,
          path,
          file.source.text,
          found.ref,
          found.node,
        ).run();
      } catch {
        return null;
      }
    },
  };
}
