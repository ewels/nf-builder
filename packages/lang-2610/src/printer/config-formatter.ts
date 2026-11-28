// Ported from nextflow-io/nextflow v26.10.7, modules/nf-lang/src/main/java/nextflow/config/formatter/
// ConfigFormattingVisitor.java (Apache-2.0; see ../../grammar/NOTICE and ../../grammar/LICENSE). The line numbers in
// the comments are upstream's. Left out: Harshil alignment, which is not a default of `nextflow lint -format`.
import {
  type ConfigApply,
  type ConfigAst,
  type ConfigStatement,
  type MethodCall,
  PrintError,
} from "@nf-builder/lang-core";
import type { Formatter } from "./formatter.ts";

/** L111 */
const IDENTIFIER = /^[a-zA-Z_]+[a-zA-Z0-9_]*$/;

export class ConfigFormatter {
  private readonly fmt: Formatter;

  constructor(fmt: Formatter) {
    this.fmt = fmt;
  }

  /** L72 (`visit`): every top-level item, then the comments left dangling in the file. */
  config(ast: ConfigAst): void {
    for (const item of ast.statements) this.statement(item);
    this.fmt.appendDanglingComments(ast);
  }

  /** The visitor's `visitConfigApplyBlock`, `visitConfigApply`, `visitConfigAssign`, `visitConfigBlock` and `visitConfigInclude`. */
  statement(
    node: ConfigStatement | ConfigApply | { readonly kind: "Unparsed" },
  ): void {
    const fmt = this.fmt;
    switch (node.kind) {
      case "ConfigApplyBlock": {
        // L88
        fmt.appendLeadingComments(node);
        fmt.appendIndent();
        fmt.append(node.name.name);
        fmt.append(" {");
        fmt.appendNewLine();
        fmt.incIndent();
        for (const stmt of node.statements) this.statement(stmt);
        fmt.appendDanglingComments(node);
        fmt.decIndent();
        fmt.appendIndent();
        fmt.append("}");
        fmt.appendTrailingComment(node);
        fmt.appendNewLine();
        return;
      }
      case "ConfigApply": {
        // L106: a directive, `id 'nf-schema@2.5.1'`
        fmt.appendLeadingComments(node);
        const call: MethodCall = {
          kind: "MethodCall",
          range: node.range,
          receiver: null,
          navigation: null,
          method: node.name,
          args: node.args,
          parens: false,
          trailingComma: false,
          closures: [],
        };
        fmt.directive(node, call);
        return;
      }
      case "ConfigAssign": {
        // L112
        fmt.appendLeadingComments(node);
        fmt.appendIndent();
        fmt.append(node.path.map((n) => n.name).join("."));
        fmt.append(" = ");
        fmt.expression(node.value);
        fmt.appendTrailingComment(node);
        fmt.appendNewLine();
        return;
      }
      case "ConfigBlock":
      case "ConfigSelector": {
        // L138
        fmt.appendLeadingComments(node);
        fmt.appendIndent();
        const name = node.kind === "ConfigBlock" ? node.name : node.target;
        if (node.kind === "ConfigSelector") {
          fmt.append(node.selector.name);
          fmt.append(": ");
        }
        if (IDENTIFIER.test(name.name)) fmt.append(name.name);
        else fmt.append(`'${name.name}'`);
        fmt.append(" {");
        fmt.appendNewLine();
        fmt.incIndent();
        for (const stmt of node.statements) this.statement(stmt);
        fmt.appendDanglingComments(node);
        fmt.decIndent();
        fmt.appendIndent();
        fmt.append("}");
        fmt.appendTrailingComment(node);
        fmt.appendNewLine();
        return;
      }
      case "ConfigInclude": {
        // L177
        fmt.appendLeadingComments(node);
        fmt.appendIndent();
        fmt.append("includeConfig ");
        fmt.expression(node.source);
        fmt.appendTrailingComment(node);
        fmt.appendNewLine();
        return;
      }
      default:
        throw new PrintError(
          `A ${node.kind} node can't be printed: it only exists for a file with errors`,
          node,
        );
    }
  }
}
