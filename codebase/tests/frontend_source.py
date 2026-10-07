"""Find frontend code by name instead of by file.

The contract tests pin numbers, limits and shader maths as text. They read
that text through here so a check keeps passing when the code it pins moves
from one frontend file to another. ``tests/frontend-source.js`` does the same
job for the Node unit tests.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import re


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

_REGEX_AFTER_WORD = {
    "return", "typeof", "case", "in", "of", "void", "delete", "throw", "new", "else", "do", "await", "yield",
}


@lru_cache(maxsize=None)
def _scripts() -> tuple[tuple[str, str], ...]:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    names = re.findall(r'<script src="/static/([^"?]+\.js)', html)
    return tuple((name, (FRONTEND / name).read_text(encoding="utf-8")) for name in names)


@lru_cache(maxsize=None)
def frontend_scripts() -> str:
    """Every script the page loads, in load order, as one text."""
    return "\n".join(text for _, text in _scripts())


def _regex_may_start(text: str, index: int) -> bool:
    cursor = index - 1
    while cursor >= 0 and text[cursor].isspace():
        cursor -= 1
    if cursor < 0:
        return True
    if re.match(r"[\w$]", text[cursor]):
        start = cursor
        while start > 0 and re.match(r"[\w$]", text[start - 1]):
            start -= 1
        return text[start:cursor + 1] in _REGEX_AFTER_WORD
    return text[cursor] not in ")]}"


def _skip_literal(text: str, index: int) -> int:
    """Index just past the string, template, comment or regular expression
    starting at ``index``, or ``index`` when none starts there."""
    char = text[index]
    if text.startswith("//", index):
        end = text.find("\n", index)
        return len(text) if end < 0 else end
    if text.startswith("/*", index):
        return text.index("*/", index + 2) + 2
    if char in "'\"":
        cursor = index + 1
        while text[cursor] != char:
            cursor += 2 if text[cursor] == "\\" else 1
        return cursor + 1
    if char == "`":
        cursor = index + 1
        while text[cursor] != "`":
            if text[cursor] == "\\":
                cursor += 2
            elif text.startswith("${", cursor):
                cursor = _skip_balanced(text, cursor + 1)
            else:
                cursor += 1
        return cursor + 1
    if char == "/" and _regex_may_start(text, index):
        cursor = index + 1
        in_class = False
        while in_class or text[cursor] != "/":
            if text[cursor] == "\\":
                cursor += 1
            elif text[cursor] == "[":
                in_class = True
            elif text[cursor] == "]":
                in_class = False
            cursor += 1
        return cursor + 1
    return index


def _skip_balanced(text: str, index: int) -> int:
    """``index`` is at an opening bracket; returns the index past its partner."""
    depth = 0
    cursor = index
    while cursor < len(text):
        following = _skip_literal(text, cursor)
        if following != cursor:
            cursor = following
            continue
        if text[cursor] in "([{":
            depth += 1
        elif text[cursor] in ")]}":
            depth -= 1
            if depth == 0:
                return cursor + 1
        cursor += 1
    raise AssertionError("Unbalanced brackets")


def _declaration_end(text: str, start: int, is_function: bool) -> int:
    if is_function:
        cursor = _skip_balanced(text, text.index("(", start))
        return _skip_balanced(text, text.index("{", cursor))
    cursor = start
    while cursor < len(text):
        following = _skip_literal(text, cursor)
        if following != cursor:
            cursor = following
        elif text[cursor] in "([{":
            cursor = _skip_balanced(text, cursor)
        elif text[cursor] == ";":
            return cursor + 1
        else:
            cursor += 1
    raise AssertionError("Unterminated declaration")


@lru_cache(maxsize=None)
def frontend_declaration(name: str) -> str:
    """Source text of the function or constant called ``name``, wherever in
    the frontend it lives."""
    escaped = re.escape(name)
    pattern = re.compile(
        rf"^([ \t]*)(?:((?:async[ \t]+)?function\*?[ \t]+{escaped}[ \t]*\()|(?:const|let|var)[ \t]+{escaped}\b)",
        re.MULTILINE,
    )
    found = []
    for script, text in _scripts():
        for match in pattern.finditer(text):
            start = match.start() + len(match.group(1))
            end = _declaration_end(text, start, bool(match.group(2)))
            found.append((script, len(match.group(1)), text[start:end]))
    assert found, f"No frontend script declares {name}"
    # A name shared by several modules is taken from the page's shared scope.
    chosen = [entry for entry in found if entry[1] == 0] or found
    assert len(chosen) == 1, f"{name} is declared more than once: {[entry[0] for entry in chosen]}"
    return chosen[0][2]


def frontend_declarations(*names: str) -> str:
    return "\n".join(frontend_declaration(name) for name in names)
