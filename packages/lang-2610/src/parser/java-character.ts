// Java SE 21 `java.lang.Character` predicates that the nf-lang lexer grammars call (ScriptLexer.g4 and ConfigLexer.g4),
// written from the Character javadoc definitions, in terms of Unicode general categories.
// The JavaScript runtime's Unicode tables may be newer than Java 21's (Unicode 15.0); code points assigned since then
// can differ. test/fixtures/java-character.json holds the reference values produced by running Java.

const START = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}]$/u;
const PART = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}]$/u;
const FORMAT = /^\p{Cf}$/u;
const UPPER = /^\p{Uppercase}$/u;

const isValid = (cp: number): boolean =>
  Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff;

/** `Character.isIdentifierIgnorable`: ISO control characters that are not whitespace, and format characters. */
export function isIdentifierIgnorable(cp: number): boolean {
  if (!isValid(cp)) return false;
  if (cp <= 0x08 || (cp >= 0x0e && cp <= 0x1b) || (cp >= 0x7f && cp <= 0x9f))
    return true;
  return FORMAT.test(String.fromCodePoint(cp));
}

/** `Character.isJavaIdentifierStart`: a letter, letter number, currency symbol or connecting punctuation. */
export function isJavaIdentifierStart(cp: number): boolean {
  return isValid(cp) && START.test(String.fromCodePoint(cp));
}

/** `Character.isJavaIdentifierPart`: an identifier start, a digit, a combining or non-spacing mark, or an ignorable. */
export function isJavaIdentifierPart(cp: number): boolean {
  if (!isValid(cp)) return false;
  return PART.test(String.fromCodePoint(cp)) || isIdentifierIgnorable(cp);
}

/** `Character.isUpperCase`: category Lu or the Other_Uppercase property. */
export function isUpperCase(cp: number): boolean {
  return isValid(cp) && UPPER.test(String.fromCodePoint(cp));
}

/** `Character.toCodePoint`: the code point of a UTF-16 surrogate pair. */
export function toCodePoint(high: number, low: number): number {
  return ((high - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
}

/** ScriptLexer.g4 `isJavaIdentifierStartAndNotIdentifierIgnorable` member. */
export function isJavaIdentifierStartAndNotIdentifierIgnorable(
  cp: number,
): boolean {
  return isJavaIdentifierStart(cp) && !isIdentifierIgnorable(cp);
}

/** ScriptLexer.g4 `isJavaIdentifierPartAndNotIdentifierIgnorable` member. */
export function isJavaIdentifierPartAndNotIdentifierIgnorable(
  cp: number,
): boolean {
  return isJavaIdentifierPart(cp) && !isIdentifierIgnorable(cp);
}
