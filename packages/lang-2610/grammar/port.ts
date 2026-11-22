// The hand port of the Java in the vendored nf-lang grammars: every upstream snippet next to its TypeScript replacement.
// Data only: scripts/gen-grammar.ts applies it to a copy of each .g4 before running antlr-ng, and stops when an entry
// no longer matches or a Java action is left without an entry. `java` is the exact upstream text (whitespace-sensitive).
// Ported from nextflow-io/nextflow v26.10.7 modules/nf-lang (Apache-2.0; see NOTICE and LICENSE in this directory).
// antlr4ng streams hold code points where Java streams hold UTF-16 units; the code points 0x22, 0x27, 0x24 and 0x2a
// below are the double quote, single quote, dollar and asterisk.

export type GrammarName =
  | "ScriptLexer"
  | "ScriptParser"
  | "ConfigLexer"
  | "ConfigParser";
/** One upstream Java snippet and its TypeScript port. `java` is the exact upstream text (whitespace-sensitive). */
export type PortEntry = {
  java: string;
  ts: string;
  occurrences: number;
  note?: string;
};
export type GrammarPort = {
  header: PortEntry;
  members: PortEntry;
  actions: readonly PortEntry[];
};

export const PORT: Readonly<Record<GrammarName, GrammarPort>> = {
  ScriptLexer: {
    header: {
      java: `@header {
package nextflow.script.parser;

import java.util.*;
import java.util.regex.Pattern;
import org.antlr.v4.runtime.CharStream;
import org.apache.groovy.parser.antlr4.GroovySyntaxError;

import static nextflow.script.parser.SemanticPredicates.*;
}`,
      ts: `@header {
import { AbstractLexer } from "../parser/abstract-lexer.ts";
import {
    isJavaIdentifierPart,
    isJavaIdentifierPartAndNotIdentifierIgnorable,
    isJavaIdentifierStart,
    isJavaIdentifierStartAndNotIdentifierIgnorable,
    isUpperCase,
    toCodePoint,
} from "../parser/java-character.ts";
import { isFollowedBy, isFollowedByJavaLetterInGString } from "../parser/semantic-predicates.ts";
}`,
      occurrences: 1,
    },
    members: {
      java: `@members {
    private boolean errorIgnored;
    private long tokenIndex;
    private int  lastTokenType;
    private int  invalidDigitCount;

    /**
     * Record the index and token type of the current token while emitting tokens.
     */
    @Override
    public void emit(Token token) {
        this.tokenIndex++;

        int tokenType = token.getType();
        if (Token.DEFAULT_CHANNEL == token.getChannel()) {
            this.lastTokenType = tokenType;
        }

        super.emit(token);
    }

    private static final int[] REGEX_CHECK_ARRAY = {
        // DEC,
        // INC,
        // THIS,
        RBRACE,
        RBRACK,
        RPAREN,
        GStringEnd,
        TdqGStringEnd,
        NullLiteral,
        StringLiteral,
        BooleanLiteral,
        IntegerLiteral,
        FloatingPointLiteral,
        Identifier, CapitalizedIdentifier
    };
    static {
        Arrays.sort(REGEX_CHECK_ARRAY);
    }

    private boolean isRegexAllowed() {
        return (Arrays.binarySearch(REGEX_CHECK_ARRAY, this.lastTokenType) < 0);
    }

    @Override
    public int getSyntaxErrorSource() {
        return GroovySyntaxError.LEXER;
    }

    @Override
    public int getErrorLine() {
        return getLine();
    }

    @Override
    public int getErrorColumn() {
        return getCharPositionInLine() + 1;
    }

    private static boolean isJavaIdentifierStartAndNotIdentifierIgnorable(int codePoint) {
        return Character.isJavaIdentifierStart(codePoint) && !Character.isIdentifierIgnorable(codePoint);
    }

    private static boolean isJavaIdentifierPartAndNotIdentifierIgnorable(int codePoint) {
        return Character.isJavaIdentifierPart(codePoint) && !Character.isIdentifierIgnorable(codePoint);
    }

}`,
      ts: `@members {
    protected override readonly regexCheckTokenTypes: ReadonlySet<number> = new Set([
        ScriptLexer.RBRACE,
        ScriptLexer.RBRACK,
        ScriptLexer.RPAREN,
        ScriptLexer.GStringEnd,
        ScriptLexer.TdqGStringEnd,
        ScriptLexer.NullLiteral,
        ScriptLexer.StringLiteral,
        ScriptLexer.BooleanLiteral,
        ScriptLexer.IntegerLiteral,
        ScriptLexer.FloatingPointLiteral,
        ScriptLexer.Identifier,
        ScriptLexer.CapitalizedIdentifier,
    ]);
}`,
      occurrences: 1,
    },
    actions: [
      {
        java: `{ this.isRegexAllowed() && _input.LA(1) != '*' }?`,
        ts: `{ this.isRegexAllowed() && this.inputStream.LA(1) !== 0x2a }?`,
        occurrences: 1,
        note: "0x2a is *",
      },
      {
        java: String.raw`{ require(errorIgnored, "Unexpected character: '" + getText().replace("'", "\\'") + "'", -1, false); }`,
        ts: String.raw`{ this.require(this.errorIgnored, "Unexpected character: '" + this.text.replaceAll("'", "\\'") + "'", -1, false); }`,
        occurrences: 3,
        note: "Java String.replace(CharSequence, CharSequence) replaces every occurrence, so replaceAll",
      },
      {
        java: `{ _input.LA(1) != '"' || _input.LA(2) != '"' || _input.LA(3) == '"' && (_input.LA(4) != '"' || _input.LA(5) != '"') }?`,
        ts: `{ this.inputStream.LA(1) !== 0x22 || this.inputStream.LA(2) !== 0x22 || this.inputStream.LA(3) === 0x22 && (this.inputStream.LA(4) !== 0x22 || this.inputStream.LA(5) !== 0x22) }?`,
        occurrences: 1,
        note: "0x22 is the double quote",
      },
      {
        java: String.raw`{ _input.LA(1) != '\'' || _input.LA(2) != '\'' || _input.LA(3) == '\'' && (_input.LA(4) != '\'' || _input.LA(5) != '\'') }?`,
        ts: `{ this.inputStream.LA(1) !== 0x27 || this.inputStream.LA(2) !== 0x27 || this.inputStream.LA(3) === 0x27 && (this.inputStream.LA(4) !== 0x27 || this.inputStream.LA(5) !== 0x27) }?`,
        occurrences: 1,
        note: "0x27 is the single quote",
      },
      {
        java: `{ !isFollowedByJavaLetterInGString(_input) }?`,
        ts: `{ !isFollowedByJavaLetterInGString(this.inputStream) }?`,
        occurrences: 1,
      },
      {
        java: `{ require(errorIgnored, "Number ending with underscores is invalid", -1, true); }`,
        ts: `{ this.require(this.errorIgnored, "Number ending with underscores is invalid", -1, true); }`,
        occurrences: 2,
      },
      {
        java: `{ invalidDigitCount++; }`,
        ts: `{ this.invalidDigitCount++; }`,
        occurrences: 1,
      },
      {
        java: `{ require(errorIgnored, "Invalid octal number", -(invalidDigitCount + 1), true); }`,
        ts: `{ this.require(this.errorIgnored, "Invalid octal number", -(this.invalidDigitCount + 1), true); }`,
        occurrences: 1,
      },
      {
        java: String.raw`{ isFollowedBy(_input, ' ', '\t', '\r', '\n') }?`,
        ts: String.raw`{ isFollowedBy(this.inputStream, " ", "\t", "\r", "\n") }?`,
        occurrences: 1,
      },
      {
        java: String.raw`{ isFollowedBy(_input, ' ', '\t', '\r', '\n', '[', '(', '{') }?`,
        ts: String.raw`{ isFollowedBy(this.inputStream, " ", "\t", "\r", "\n", "[", "(", "{") }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isUpperCase(_input.LA(-1)) }?`,
        ts: `{ isUpperCase(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ isJavaIdentifierStartAndNotIdentifierIgnorable(_input.LA(-1)) }?`,
        ts: `{ isJavaIdentifierStartAndNotIdentifierIgnorable(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isJavaIdentifierStart(Character.toCodePoint((char) _input.LA(-2), (char) _input.LA(-1))) }?`,
        ts: `{ isJavaIdentifierStart(toCodePoint(this.inputStream.LA(-2), this.inputStream.LA(-1))) }?`,
        occurrences: 1,
        note: "antlr4ng streams hold code points, so a surrogate pair never reaches this alternative; kept so the port stays one to one",
      },
      {
        java: `{ _input.LA(-1) != '$' }?`,
        ts: `{ this.inputStream.LA(-1) !== 0x24 }?`,
        occurrences: 2,
        note: "0x24 is $",
      },
      {
        java: `{ isJavaIdentifierPartAndNotIdentifierIgnorable(_input.LA(-1)) }?`,
        ts: `{ isJavaIdentifierPartAndNotIdentifierIgnorable(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isJavaIdentifierPart(Character.toCodePoint((char) _input.LA(-2), (char) _input.LA(-1))) }?`,
        ts: `{ isJavaIdentifierPart(toCodePoint(this.inputStream.LA(-2), this.inputStream.LA(-1))) }?`,
        occurrences: 1,
        note: "see the isJavaIdentifierStart entry",
      },
      {
        java: `{ require(errorIgnored || 0 == this.tokenIndex, "Shebang comment should appear at the first line", -2, true); }`,
        ts: `{ this.require(this.errorIgnored || 0 === this.tokenIndex, "Shebang comment should appear at the first line", -2, true); }`,
        occurrences: 1,
        note: "ScriptLexer only; ConfigLexer has this rule commented out",
      },
    ],
  },
  ScriptParser: {
    header: {
      java: `@header {
package nextflow.script.parser;

import org.apache.groovy.parser.antlr4.GroovySyntaxError;

import static nextflow.script.parser.SemanticPredicates.*;
}`,
      ts: `@header {
import { AbstractParser } from "../parser/abstract-parser.ts";
}`,
      occurrences: 1,
    },
    members: {
      java: `@members {

    @Override
    public int getSyntaxErrorSource() {
        return GroovySyntaxError.PARSER;
    }

    @Override
    public int getErrorLine() {
        Token token = _input.LT(-1);

        if (null == token) {
            return -1;
        }

        return token.getLine();
    }

    @Override
    public int getErrorColumn() {
        Token token = _input.LT(-1);

        if (null == token) {
            return -1;
        }

        return token.getCharPositionInLine() + 1 + token.getText().length();
    }
}`,
      ts: `@members {
    public isValidDirective(context: ExpressionContext | null | undefined): boolean {
        if (!(context instanceof PathExprAltContext)) return false;
        const last = context.getChild(context.getChildCount() - 1);
        return last instanceof IdentifierPrmrAltContext || last instanceof PropertyPathExprAltContext;
    }
}`,
      occurrences: 1,
    },
    actions: [
      {
        java: `{ isValidDirective($expression.ctx) }?`,
        ts: `{ this.isValidDirective(($ctx as ExpressionStatementContext).expression()) }?`,
        occurrences: 1,
        note: "antlr-ng types $expression.ctx as possibly null in the predicate method, so the expression child is read from the cast $ctx (the _expression field exists only when an action names $expression)",
      },
    ],
  },
  ConfigLexer: {
    header: {
      java: `@header {
package nextflow.config.parser;

import java.util.*;
import java.util.regex.Pattern;
import nextflow.script.parser.AbstractLexer;
import org.antlr.v4.runtime.CharStream;
import org.apache.groovy.parser.antlr4.GroovySyntaxError;

import static nextflow.script.parser.SemanticPredicates.*;
}`,
      ts: `@header {
import { AbstractLexer } from "../parser/abstract-lexer.ts";
import {
    isJavaIdentifierPart,
    isJavaIdentifierPartAndNotIdentifierIgnorable,
    isJavaIdentifierStart,
    isJavaIdentifierStartAndNotIdentifierIgnorable,
    isUpperCase,
    toCodePoint,
} from "../parser/java-character.ts";
import { isFollowedBy, isFollowedByJavaLetterInGString } from "../parser/semantic-predicates.ts";
}`,
      occurrences: 1,
    },
    members: {
      java: `@members {
    private boolean errorIgnored;
    private int  lastTokenType;
    private int  invalidDigitCount;

    /**
     * Record the index and token type of the current token while emitting tokens.
     */
    @Override
    public void emit(Token token) {
        int tokenType = token.getType();
        if (Token.DEFAULT_CHANNEL == token.getChannel()) {
            this.lastTokenType = tokenType;
        }

        super.emit(token);
    }

    private static final int[] REGEX_CHECK_ARRAY = {
        // DEC,
        // INC,
        // THIS,
        RBRACE,
        RBRACK,
        RPAREN,
        GStringEnd,
        TdqGStringEnd,
        NullLiteral,
        StringLiteral,
        BooleanLiteral,
        IntegerLiteral,
        FloatingPointLiteral,
        Identifier, CapitalizedIdentifier
    };
    static {
        Arrays.sort(REGEX_CHECK_ARRAY);
    }

    private boolean isRegexAllowed() {
        return (Arrays.binarySearch(REGEX_CHECK_ARRAY, this.lastTokenType) < 0);
    }

    @Override
    public int getSyntaxErrorSource() {
        return GroovySyntaxError.LEXER;
    }

    @Override
    public int getErrorLine() {
        return getLine();
    }

    @Override
    public int getErrorColumn() {
        return getCharPositionInLine() + 1;
    }

    private static boolean isJavaIdentifierStartAndNotIdentifierIgnorable(int codePoint) {
        return Character.isJavaIdentifierStart(codePoint) && !Character.isIdentifierIgnorable(codePoint);
    }

    private static boolean isJavaIdentifierPartAndNotIdentifierIgnorable(int codePoint) {
        return Character.isJavaIdentifierPart(codePoint) && !Character.isIdentifierIgnorable(codePoint);
    }

}`,
      ts: `@members {
    protected override readonly regexCheckTokenTypes: ReadonlySet<number> = new Set([
        ConfigLexer.RBRACE,
        ConfigLexer.RBRACK,
        ConfigLexer.RPAREN,
        ConfigLexer.GStringEnd,
        ConfigLexer.TdqGStringEnd,
        ConfigLexer.NullLiteral,
        ConfigLexer.StringLiteral,
        ConfigLexer.BooleanLiteral,
        ConfigLexer.IntegerLiteral,
        ConfigLexer.FloatingPointLiteral,
        ConfigLexer.Identifier,
        ConfigLexer.CapitalizedIdentifier,
    ]);
}`,
      occurrences: 1,
    },
    actions: [
      {
        java: `{ this.isRegexAllowed() && _input.LA(1) != '*' }?`,
        ts: `{ this.isRegexAllowed() && this.inputStream.LA(1) !== 0x2a }?`,
        occurrences: 1,
        note: "0x2a is *",
      },
      {
        java: String.raw`{ require(errorIgnored, "Unexpected character: '" + getText().replace("'", "\\'") + "'", -1, false); }`,
        ts: String.raw`{ this.require(this.errorIgnored, "Unexpected character: '" + this.text.replaceAll("'", "\\'") + "'", -1, false); }`,
        occurrences: 3,
        note: "Java String.replace(CharSequence, CharSequence) replaces every occurrence, so replaceAll",
      },
      {
        java: `{ _input.LA(1) != '"' || _input.LA(2) != '"' || _input.LA(3) == '"' && (_input.LA(4) != '"' || _input.LA(5) != '"') }?`,
        ts: `{ this.inputStream.LA(1) !== 0x22 || this.inputStream.LA(2) !== 0x22 || this.inputStream.LA(3) === 0x22 && (this.inputStream.LA(4) !== 0x22 || this.inputStream.LA(5) !== 0x22) }?`,
        occurrences: 1,
        note: "0x22 is the double quote",
      },
      {
        java: String.raw`{ _input.LA(1) != '\'' || _input.LA(2) != '\'' || _input.LA(3) == '\'' && (_input.LA(4) != '\'' || _input.LA(5) != '\'') }?`,
        ts: `{ this.inputStream.LA(1) !== 0x27 || this.inputStream.LA(2) !== 0x27 || this.inputStream.LA(3) === 0x27 && (this.inputStream.LA(4) !== 0x27 || this.inputStream.LA(5) !== 0x27) }?`,
        occurrences: 1,
        note: "0x27 is the single quote",
      },
      {
        java: `{ !isFollowedByJavaLetterInGString(_input) }?`,
        ts: `{ !isFollowedByJavaLetterInGString(this.inputStream) }?`,
        occurrences: 1,
      },
      {
        java: `{ require(errorIgnored, "Number ending with underscores is invalid", -1, true); }`,
        ts: `{ this.require(this.errorIgnored, "Number ending with underscores is invalid", -1, true); }`,
        occurrences: 2,
      },
      {
        java: `{ invalidDigitCount++; }`,
        ts: `{ this.invalidDigitCount++; }`,
        occurrences: 1,
      },
      {
        java: `{ require(errorIgnored, "Invalid octal number", -(invalidDigitCount + 1), true); }`,
        ts: `{ this.require(this.errorIgnored, "Invalid octal number", -(this.invalidDigitCount + 1), true); }`,
        occurrences: 1,
      },
      {
        java: String.raw`{ isFollowedBy(_input, ' ', '\t', '\r', '\n') }?`,
        ts: String.raw`{ isFollowedBy(this.inputStream, " ", "\t", "\r", "\n") }?`,
        occurrences: 1,
      },
      {
        java: String.raw`{ isFollowedBy(_input, ' ', '\t', '\r', '\n', '[', '(', '{') }?`,
        ts: String.raw`{ isFollowedBy(this.inputStream, " ", "\t", "\r", "\n", "[", "(", "{") }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isUpperCase(_input.LA(-1)) }?`,
        ts: `{ isUpperCase(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ isJavaIdentifierStartAndNotIdentifierIgnorable(_input.LA(-1)) }?`,
        ts: `{ isJavaIdentifierStartAndNotIdentifierIgnorable(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isJavaIdentifierStart(Character.toCodePoint((char) _input.LA(-2), (char) _input.LA(-1))) }?`,
        ts: `{ isJavaIdentifierStart(toCodePoint(this.inputStream.LA(-2), this.inputStream.LA(-1))) }?`,
        occurrences: 1,
        note: "antlr4ng streams hold code points, so a surrogate pair never reaches this alternative; kept so the port stays one to one",
      },
      {
        java: `{ _input.LA(-1) != '$' }?`,
        ts: `{ this.inputStream.LA(-1) !== 0x24 }?`,
        occurrences: 2,
        note: "0x24 is $",
      },
      {
        java: `{ isJavaIdentifierPartAndNotIdentifierIgnorable(_input.LA(-1)) }?`,
        ts: `{ isJavaIdentifierPartAndNotIdentifierIgnorable(this.inputStream.LA(-1)) }?`,
        occurrences: 1,
      },
      {
        java: `{ Character.isJavaIdentifierPart(Character.toCodePoint((char) _input.LA(-2), (char) _input.LA(-1))) }?`,
        ts: `{ isJavaIdentifierPart(toCodePoint(this.inputStream.LA(-2), this.inputStream.LA(-1))) }?`,
        occurrences: 1,
        note: "see the isJavaIdentifierStart entry",
      },
    ],
  },
  ConfigParser: {
    header: {
      java: `@header {
package nextflow.config.parser;

import nextflow.script.parser.AbstractParser;
import org.apache.groovy.parser.antlr4.GroovySyntaxError;

import static nextflow.script.parser.SemanticPredicates.*;
}`,
      ts: `@header {
import { AbstractParser } from "../parser/abstract-parser.ts";
}`,
      occurrences: 1,
    },
    members: {
      java: `@members {

    @Override
    public int getSyntaxErrorSource() {
        return GroovySyntaxError.PARSER;
    }

    @Override
    public int getErrorLine() {
        Token token = _input.LT(-1);

        if (null == token) {
            return -1;
        }

        return token.getLine();
    }

    @Override
    public int getErrorColumn() {
        Token token = _input.LT(-1);

        if (null == token) {
            return -1;
        }

        return token.getCharPositionInLine() + 1 + token.getText().length();
    }
}`,
      ts: `@members {
    public isValidDirective(context: ExpressionContext | null | undefined): boolean {
        if (!(context instanceof PathExprAltContext)) return false;
        const last = context.getChild(context.getChildCount() - 1);
        return last instanceof IdentifierPrmrAltContext || last instanceof PropertyPathExprAltContext;
    }
}`,
      occurrences: 1,
    },
    actions: [
      {
        java: `{ isValidDirective($expression.ctx) }?`,
        ts: `{ this.isValidDirective(($ctx as ExpressionStatementContext).expression()) }?`,
        occurrences: 1,
        note: "antlr-ng types $expression.ctx as possibly null in the predicate method, so the expression child is read from the cast $ctx (the _expression field exists only when an action names $expression)",
      },
    ],
  },
};
