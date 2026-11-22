import {
  BailErrorStrategy,
  CharStream,
  CommonTokenStream,
  PredictionMode,
  Trees,
} from "antlr4ng";
import { describe, expect, it } from "vitest";
import { ScriptLexer } from "../src/generated/ScriptLexer.ts";
import { ScriptParser } from "../src/generated/ScriptParser.ts";
import { parseConfig, parseScript } from "../src/parser/parse.ts";

const TYPED_AND_LEGACY = `nextflow.enable.types = true

params {
    input: String
    outdir: String = 'results'
}

process FASTQC {
    input:
    sample: String
    reads: Path

    output:
    report: Path = file('*.html')

    script:
    """
    fastqc -o . \${reads}
    """
}

workflow {
    main:
    ch = channel.of('a', 'b')
    ch.view()
}
`;

const LEGACY = `params.greeting = 'Hello'

process SAY {
    cpus 2
    publishDir "results", mode: 'copy'

    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '\${greeting}'
    """
}

def twice(x) {
    return x * 2
}

workflow {
    SAY(channel.of(params.greeting))
}
`;

const BAD_DECLARATION = `// Malformed on purpose: process SECOND has a syntax error in its script section; FIRST and the entry workflow are valid.
process FIRST {
    input:
    val greeting

    output:
    stdout

    script:
    """
    echo '\${greeting}'
    """
}

process SECOND {
    input:
    val greeting

    output:
    stdout

    script:
    def prefix = = 'Hello'
    """
    echo '\${prefix} \${greeting}'
    """
}

workflow {
    FIRST(channel.of('Hello', 'Hola'))
    SECOND(channel.of('Bonjour'))
}
`;

const CONFIG = `params {
    input = null
    outdir = 'results'
}

process {
    executor = 'local'
    cpus = 2
    withName: 'FASTQC' {
        memory = 4.GB
    }
    withLabel: big {
        cpus = 8
    }
}

profiles {
    test {
        params.input = 'samples.csv'
    }
    docker {
        docker.enabled = true
    }
}

includeConfig 'conf/base.config'
`;

describe("parseScript", () => {
  it("ADR-0005: parseScript accepts typed and legacy processes, workflows, functions and feature flags", () => {
    for (const [name, text] of [
      ["typed", TYPED_AND_LEGACY],
      ["legacy", LEGACY],
    ] as const) {
      const outcome = parseScript(text);
      expect(outcome.ok, name).toBe(true);
      if (outcome.ok) expect(outcome.mode, name).toBe("SLL");
    }
  });

  it("ADR-0005: a directive without parentheses parses only after an identifier or property path", () => {
    expect(parseScript("cpus 4\n").ok).toBe(true);
    expect(parseScript("a.b.cpus 4\n").ok).toBe(true);
    const outcome = parseScript("foo() 4\n");
    expect(outcome.ok).toBe(false);
  });

  it("ADR-0005: parseScript stops at the first syntax error with line and column, like nf-lang", () => {
    const outcome = parseScript(BAD_DECLARATION);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.source).toBe("parser");
    expect(outcome.error.line).toBe(23);
    expect(outcome.error.column).toBeGreaterThan(0);
    expect(outcome.error.message.length).toBeGreaterThan(0);
  });

  it("ADR-0005: a lexer error is reported without an LL retry", () => {
    const outcome = parseScript("x = 09\n");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.mode).toBe("SLL");
    expect(outcome.error.source).toBe("lexer");
    expect(outcome.error.message).toContain("Invalid octal number");
    expect(outcome.error.line).toBe(1);
  });
});

describe("parseConfig", () => {
  it("ADR-0005: parseConfig accepts scopes, assignments, selectors, profiles and includeConfig", () => {
    const outcome = parseConfig(CONFIG);
    expect(outcome.ok).toBe(true);
  });

  it("ADR-0005: parseConfig reports the first syntax error", () => {
    const outcome = parseConfig("process {\n  cpus = \n}}\n");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.source).toBe("parser");
  });
});

const BLANK_BEFORE_EMIT = `workflow {
    take:
    x

    main:
    y = x

    emit:
    out = y
}
`;

const INSTANCEOF_TERNARY = `workflow {
    main:
    v = x instanceof List ? a : b
}
`;

function pureLlTree(text: string): string {
  const lexer = new ScriptLexer(CharStream.fromString(text));
  lexer.removeErrorListeners();
  const parser = new ScriptParser(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  parser.errorHandler = new BailErrorStrategy();
  parser.interpreter.predictionMode = PredictionMode.LL;
  return Trees.toStringTree(parser.compilationUnit(), ScriptParser.ruleNames);
}

describe("stage 1 prediction", () => {
  it("F-006 QA-03: a workflow with a blank line before emit: parses in stage 1 without falling back to full LL", () => {
    expect(parseScript(BLANK_BEFORE_EMIT)).toMatchObject({
      ok: true,
      mode: "SLL",
    });
  });

  it("F-006 QA-03: a ternary on an instanceof test parses in stage 1", () => {
    expect(parseScript(INSTANCEOF_TERNARY)).toMatchObject({
      ok: true,
      mode: "SLL",
    });
  });

  it("F-006 QA-03: the stage 1 tree equals the pure LL tree", () => {
    for (const text of [BLANK_BEFORE_EMIT, INSTANCEOF_TERNARY]) {
      const outcome = parseScript(text);
      if (!outcome.ok) throw new Error(outcome.error.message);
      expect(Trees.toStringTree(outcome.tree, ScriptParser.ruleNames)).toBe(
        pureLlTree(text),
      );
    }
  });
});
