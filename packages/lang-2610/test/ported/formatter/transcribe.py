#!/usr/bin/env python3
"""Transcribe the format cases of nf-lang's ScriptFormatterTest.groovy (F-110, ADR 0005, LA-45).

Usage: python3 transcribe.py <ScriptFormatterTest.groovy> <out dir>

Reads the Groovy test file, takes every `checkFormat(...)` call and the three direct `format(...)` checks, applies what
Groovy does to their string literals (unescape the ''' and " literals, then `stripIndent()` where the test calls it) and
writes `cases/<id>.in.nf`, `cases/<id>.out.nf` and `cases.json` under <out dir>. The inputs are kept as nf-lang wrote
them (AGENTS.md: ported tests are kept, not re-run), so some are not lint-clean.

The ids are `ScriptFormatterTest-L<line>`, the line of the call (or of the `def input`/`def source` literal). Files are
written as bytes (the CRLF input of the crlf case keeps its CRLF; .gitattributes marks the directory -text).
"""
import json
import os
import re
import sys

REPO = "nextflow-io/nextflow"
TAG = "v26.10.7"
COMMIT = "0ad848ef3c3a22824cd9eb2ca14568385867702d"
UPSTREAM_FILE = "modules/nf-lang/src/test/groovy/nextflow/script/formatter/ScriptFormatterTest.groovy"

HARSHIL_REASON = (
    "Harshil alignment (-harshil-alignment) is not a default of nextflow lint -format; the printer implements the "
    "defaults only (plan F-110 open point 5)"
)


def groovy_unescape(body, triple):
    """The value of a Groovy single-quoted or double-quoted string body (no interpolation: the file has none)."""
    out = []
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        i += 1
        d = body[i]
        if d == "\n":  # line continuation
            i += 1
        elif d == "\r" and body[i + 1 : i + 2] == "\n":
            i += 2
        elif d == "n":
            out.append("\n")
            i += 1
        elif d == "t":
            out.append("\t")
            i += 1
        elif d == "r":
            out.append("\r")
            i += 1
        elif d == "b":
            out.append("\b")
            i += 1
        elif d == "f":
            out.append("\f")
            i += 1
        elif d == "u":
            out.append(chr(int(body[i + 1 : i + 5], 16)))
            i += 5
        elif d in "\\'\"$":
            out.append(d)
            i += 1
        else:
            raise ValueError("unsupported escape \\" + d)
    return "".join(out)


def lines_of(text):
    """Groovy `readLines`: split at \\n, \\r\\n and \\r."""
    return re.split(r"\r\n|\r|\n", text)


def is_blank(line):
    return line.strip() == ""


def strip_indent(text):
    """Groovy `String.stripIndent()`: strip the smallest indent of the non-blank lines; blank lines become empty."""
    if text == "":
        return text
    lines = text.splitlines()
    if text.endswith("\n") or text.endswith("\r"):
        pass
    count = -1
    for line in lines:
        if is_blank(line):
            continue
        spaces = len(line) - len(line.lstrip(" \t"))
        count = spaces if count == -1 else min(count, spaces)
        if count == 0:
            break
    if count <= 0:
        return text
    out = []
    for line in lines:
        out.append("" if is_blank(line) else line[count:])
    result = "\n".join(out) + "\n"
    if not text.endswith("\n"):
        result = result[:-1]
    return result


class Source:
    def __init__(self, text):
        self.text = text
        self.pos = 0

    def line_of(self, pos):
        return self.text.count("\n", 0, pos) + 1

    def skip_ws(self):
        while self.pos < len(self.text) and self.text[self.pos] in " \t\r\n":
            self.pos += 1

    def literal(self):
        """Read a Groovy string literal at the cursor and return its raw body and its flavour."""
        t = self.text
        if t.startswith("'''", self.pos):
            quote = "'''"
        elif t.startswith('"""', self.pos):
            quote = '"""'
        elif t[self.pos] in "'\"":
            quote = t[self.pos]
        else:
            raise ValueError("no string literal at line %d" % self.line_of(self.pos))
        start = self.pos + len(quote)
        i = start
        while True:
            if t[i] == "\\":
                i += 2
                continue
            if t.startswith(quote, i):
                break
            i += 1
        self.pos = i + len(quote)
        return t[start:i], quote


def value_of(source):
    """A literal plus an optional `.stripIndent()`; returns the string value."""
    source.skip_ws()
    body, quote = source.literal()
    value = groovy_unescape(body, len(quote) == 3)
    if source.text.startswith(".stripIndent()", source.pos):
        source.pos += len(".stripIndent()")
        value = strip_indent(value)
    return value


def sections(text):
    marks = [(m.start(), m.group(1).strip()) for m in re.finditer(r"^    /// (.+)$", text, re.M)]

    def section_at(pos):
        name = ""
        for at, title in marks:
            if at < pos:
                name = title
        return name

    return section_at


def main(argv):
    groovy, out = argv[1], argv[2]
    text = open(groovy, encoding="utf-8").read()
    section_at = sections(text)
    tests = [(m.start(), m.group(1)) for m in re.finditer(r"^    def '([^']+)' \(\) \{", text, re.M)]

    def test_at(pos):
        name = ""
        for at, title in tests:
            if at < pos:
                name = title
        return name

    cases = []
    src = Source(text)

    def record(call_pos, kind, input_text, output_text, extra=None):
        line = src.line_of(call_pos)
        case = {
            "id": "ScriptFormatterTest-L%03d" % line,
            "upstream": "script/formatter/ScriptFormatterTest.groovy#L%d" % line,
            "line": line,
            "test": test_at(call_pos),
            "section": section_at(call_pos) or "CODE SNIPPET",
            "kind": kind,
            "in": "cases/ScriptFormatterTest-L%03d.in.nf" % line,
        }
        if output_text is not None:
            case["out"] = "cases/ScriptFormatterTest-L%03d.out.nf" % line
        if extra:
            case.update(extra)
        cases.append(case)
        base = os.path.join(out, "cases", "ScriptFormatterTest-L%03d" % line)
        with open(base + ".in.nf", "wb") as f:
            f.write(input_text.encode("utf-8"))
        if output_text is not None:
            with open(base + ".out.nf", "wb") as f:
                f.write(output_text.encode("utf-8"))

    os.makedirs(os.path.join(out, "cases"), exist_ok=True)
    for m in re.finditer(r"^        checkFormat\(", text, re.M):
        src.pos = m.end()
        first = value_of(src)
        src.skip_ws()
        harshil = False
        if src.text[src.pos] == ",":
            src.pos += 1
            second = value_of(src)
            src.skip_ws()
            if src.text[src.pos] == ",":
                src.pos += 1
                src.skip_ws()
                if not src.text.startswith("HARSHIL", src.pos):
                    raise ValueError("unknown option at line %d" % src.line_of(src.pos))
                harshil = True
                src.pos += len("HARSHIL")
                src.skip_ws()
        else:
            second = first
        if src.text[src.pos] != ")":
            raise ValueError("unterminated checkFormat at line %d" % src.line_of(m.start()))
        extra = {"excluded": HARSHIL_REASON, "options": "harshil"} if harshil else None
        # checkFormat applies stripIndent() to both strings
        record(m.start(), "check-format", strip_indent(first), strip_indent(second), extra)

    # the three direct format() checks
    for name, kind in (
        ("should not copy the output type into a publish target", "format-contains"),
        ("should not sort script declarations by default", "format-equals-input"),
        ("should preserve comments in a crlf source", "format-equals"),
    ):
        at = text.index("def '%s'" % name)
        m = re.compile(r"def (?:input|source) =\s*").search(text, at)
        src.pos = m.end()
        value = value_of(src)
        call_pos = m.start()
        if kind == "format-contains":
            call_pos = text.index("def result = format(", at)
            needles = []
            for n in re.finditer(r"result\.contains\(", text[at:]):
                src.pos = at + n.end()
                body, quote = src.literal()
                needles.append(groovy_unescape(body, False))
                if len(needles) == 2:
                    break
            record(call_pos, kind, value, None, {"contains": needles, "typeCheck": True})
        elif kind == "format-equals-input":
            call_pos = text.index("format(source) == source", at)
            record(call_pos, kind, value, value)
        else:
            e = re.compile(r"format\(source\) == ").search(text, at)
            call_pos = e.start()
            src.pos = e.end()
            expected = value_of(src)
            record(call_pos, kind, value, expected)

    cases.sort(key=lambda c: c["line"])
    manifest = {
        "about": (
            "Format cases ported from nf-lang's ScriptFormatterTest for F-110 (ADR 0005, LA-45). Each file is the upstream "
            "test string after Groovy unescaping and stripIndent. kind: check-format (format(in) == out and "
            "format(out) == out; a single-argument call has out equal to in), format-equals (format(in) == out), "
            "format-equals-input, format-contains (the output holds every string of `contains`). The cases marked "
            "excluded use options the printer does not implement. Regenerate with transcribe.py; never edit."
        ),
        "upstream": {"repo": REPO, "tag": TAG, "commit": COMMIT, "file": UPSTREAM_FILE},
        "cases": cases,
    }
    with open(os.path.join(out, "cases.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("%d cases (%d excluded)" % (len(cases), sum(1 for c in cases if "excluded" in c)))


if __name__ == "__main__":
    main(sys.argv)
