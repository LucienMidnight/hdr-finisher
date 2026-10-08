// Finds frontend code by name instead of by file, so a unit test keeps
// working when a function moves from one frontend file to another.
//
// declarations("a", "b") returns the source text of the functions or
// constants named a and b, wherever in the frontend they live. frontendSource
// returns one script's text, or the text of every part of a script that has
// been divided (see PARTS).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND = path.join(__dirname, "../frontend");

// A script that has been divided lists its parts here, in load order. Tests
// that load or search the original name then get all of them.
const PARTS = {
  "webgpu-preview.js": ["gpu-render-plan.js", "gpu-params.js", "webgpu-preview.js"],
};

let scripts = null;

function scriptNames() {
  const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
  return [...html.matchAll(/<script src="\/static\/([^"?]+\.js)/g)].map((match) => match[1]);
}

function readScript(name) {
  // HDR_FINISHER_TEST_APP_JS runs the unit tests against a copy of app.js.
  const override = name === "app.js" && process.env.HDR_FINISHER_TEST_APP_JS;
  return fs.readFileSync(override || path.join(FRONTEND, name), "utf8");
}

function allScripts() {
  if (!scripts) scripts = scriptNames().map((name) => ({ name, text: readScript(name) }));
  return scripts;
}

function frontendSource(name) {
  return (PARTS[name] || [name]).map(readScript).join("\n");
}

const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "in", "of", "void", "delete", "throw", "new", "else", "do", "await", "yield",
]);

function regexMayStart(text, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(text[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  const previous = text[cursor];
  if (/[\w$]/.test(previous)) {
    let start = cursor;
    while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1;
    return REGEX_AFTER_WORD.has(text.slice(start, cursor + 1));
  }
  return previous !== ")" && previous !== "]" && previous !== "}";
}

// Returns the index just past the string, template, comment or regular
// expression starting at index, or index itself when none starts there.
function skipLiteral(text, index) {
  const char = text[index];
  if (char === "/" && text[index + 1] === "/") {
    const end = text.indexOf("\n", index);
    return end < 0 ? text.length : end;
  }
  if (char === "/" && text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    assert.ok(end >= 0, "Unterminated comment");
    return end + 2;
  }
  if (char === "'" || char === '"') {
    let cursor = index + 1;
    while (text[cursor] !== char) {
      assert.ok(cursor < text.length && text[cursor] !== "\n", "Unterminated string");
      cursor += text[cursor] === "\\" ? 2 : 1;
    }
    return cursor + 1;
  }
  if (char === "`") {
    let cursor = index + 1;
    while (text[cursor] !== "`") {
      assert.ok(cursor < text.length, "Unterminated template");
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor] === "$" && text[cursor + 1] === "{") cursor = skipBalanced(text, cursor + 1);
      else cursor += 1;
    }
    return cursor + 1;
  }
  if (char === "/" && regexMayStart(text, index)) {
    let cursor = index + 1;
    let inClass = false;
    while (inClass || text[cursor] !== "/") {
      assert.ok(cursor < text.length && text[cursor] !== "\n", "Unterminated regular expression");
      if (text[cursor] === "\\") cursor += 1;
      else if (text[cursor] === "[") inClass = true;
      else if (text[cursor] === "]") inClass = false;
      cursor += 1;
    }
    return cursor + 1;
  }
  return index;
}

// index is at an opening bracket; returns the index just past its partner.
function skipBalanced(text, index) {
  let depth = 0;
  let cursor = index;
  while (cursor < text.length) {
    const next = skipLiteral(text, cursor);
    if (next !== cursor) {
      cursor = next;
      continue;
    }
    const char = text[cursor];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  assert.fail("Unbalanced brackets");
}

function declarationEnd(text, start, isFunction) {
  let cursor = start;
  if (isFunction) {
    cursor = skipBalanced(text, text.indexOf("(", cursor));
    return skipBalanced(text, text.indexOf("{", cursor));
  }
  while (cursor < text.length) {
    const next = skipLiteral(text, cursor);
    if (next !== cursor) cursor = next;
    else if ("([{".includes(text[cursor])) cursor = skipBalanced(text, cursor);
    else if (text[cursor] === ";") return cursor + 1;
    else cursor += 1;
  }
  assert.fail("Unterminated declaration");
}

function escapeName(name) {
  return name.replace(/[$]/g, "\\$&");
}

function findDeclarations(name) {
  const pattern = new RegExp(
    `^([ \\t]*)(?:((?:async[ \\t]+)?function\\*?[ \\t]+${escapeName(name)}[ \\t]*\\()|(?:const|let|var)[ \\t]+${escapeName(name)}\\b)`,
    "gm",
  );
  const found = [];
  for (const script of allScripts()) {
    for (const match of script.text.matchAll(pattern)) {
      const start = match.index + match[1].length;
      found.push({
        file: script.name,
        indent: match[1].length,
        text: script.text.slice(start, declarationEnd(script.text, start, Boolean(match[2]))),
      });
    }
  }
  return found;
}

function declaration(name) {
  const found = findDeclarations(name);
  assert.ok(found.length > 0, `No frontend script declares ${name}`);
  // A name shared by several modules is taken from the page's shared scope.
  const shared = found.filter((entry) => entry.indent === 0);
  const chosen = shared.length ? shared : found;
  assert.equal(
    chosen.length, 1,
    `${name} is declared more than once: ${chosen.map((entry) => entry.file).join(", ")}`,
  );
  return chosen[0].text;
}

function declarations(...names) {
  return names.map(declaration).join("\n");
}

module.exports = { FRONTEND, declaration, declarations, frontendSource, scriptNames };
