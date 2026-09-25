// -----------------------------------------------------------
//  [*] Regression — the frontend's API contract itself
//
//  tests/contract/api.js is hand-kept, so its own consistency
//  is pinned here: every fetch in src/ (literal or template
//  URL, through fetch or the themes page's apiFetch) names an
//  endpoint the contract lists, and the contract lists no
//  endpoint the SPA never calls; every entry has a
//  well-formed response descriptor and, for POST/PATCH, a
//  request descriptor (or an explicit { empty: true }). The
//  page tests then enforce the contract on every request and
//  answer (helpers/contractGuard.js).
// -----------------------------------------------------------

import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { API } from "./api.js";


// vitest runs from the app root, so src/ is right there
const SRC = path.resolve(process.cwd(), "src");







// -----------------------------------------------------------
// walk
// -----------------------------------------------------------
//
// Every .js/.jsx file under a directory, sorted.
//
// Used by:
//   - spaEndpoints (below)
// -----------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}







// -----------------------------------------------------------
// callSpan
// -----------------------------------------------------------
//
// The text of one call from its opening "(" to the matching
// ")", counting brackets outside string literals and inside
// a template literal's ${…}.
//
// Used by:
//   - spaEndpoints (below)
// -----------------------------------------------------------

function callSpan(src, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === "\\") i++; i++; }
    } else if (ch === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          let d = 1; i += 2;
          while (i < src.length && d > 0) { if (src[i] === "{") d++; else if (src[i] === "}") d--; i++; }
          continue;
        }
        i++;
      }
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
    i++;
  }
  throw new Error("unbalanced call");
}







// -----------------------------------------------------------
// spaEndpoints
// -----------------------------------------------------------
//
// "METHOD /path" for every fetch(...) / apiFetch(...) in src/
// whose URL is a string or template literal (a ${…} segment
// becomes ":id", the query string is dropped); the method
// from `method: "…"` inside that call's own parentheses, GET
// otherwise. Commented lines and the apiFetch wrapper's own
// delegation are skipped; a variable URL is an error, so a
// new indirection must be added here deliberately.
//
// Used by:
//   - the endpoint-set test (below)
// -----------------------------------------------------------

function spaEndpoints() {
  const found = new Set();
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    const re = /\b(fetch|apiFetch)\(/g;
    let m;
    while ((m = re.exec(src))) {
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      if (src.slice(lineStart, m.index).trim().startsWith("//")) continue;
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
      const span = callSpan(src, m.index + m[0].length - 1);
      const rest = span.slice(1).replace(/^\s+/, "");
      const q = rest[0];
      let url;
      if (q === '"' || q === "'") url = rest.slice(1, rest.indexOf(q, 1));
      else if (q === "`") url = rest.slice(1, rest.indexOf("`", 1)).replace(/\$\{[^}]*\}/g, ":id");
      else if (m[1] === "fetch" && /^url\b/.test(rest) && /function\s+apiFetch\(url\b/.test(src)) continue;
      else throw new Error(`${path.relative(SRC, file)}: ${m[1]}() with a non-literal URL`);
      const method = (/method:\s*["'`](\w+)["'`]/.exec(span)?.[1] ?? "GET").toUpperCase();
      found.add(`${method} ${url.split("?")[0]}`);
    }
  }
  return found;
}

// One spelling for a parameter segment on both sides
const normalise = (key) => key.replace(/:[A-Za-z_]+/g, ":id");







// -----------------------------------------------------------
// the endpoint set
// -----------------------------------------------------------
//
// The contract's keys and the SPA's calls are the same set —
// a call nothing documents, or a documented endpoint nothing
// calls, fails here with the difference.
// -----------------------------------------------------------

test("the contract lists exactly the endpoints the SPA calls", () => {
  const called = [...spaEndpoints()].map(normalise).sort();
  const listed = Object.keys(API).map(normalise).sort();
  expect(listed).toEqual(called);
  expect(called.length).toBeGreaterThanOrEqual(25);
});







// -----------------------------------------------------------
// descriptor shapes
// -----------------------------------------------------------
//
// Every entry: a "METHOD /path" key; a response that is one
// of { list }, { object }, { none }, { blob }, with string
// field names (an optional one ends in "?") and nested
// descriptors of the same form; a request for POST/PATCH as
// { json: [...] }, { form: [...] } or { empty: true }, none
// for GET/DELETE except a documented { query: [...] }.
// -----------------------------------------------------------

function checkDescriptor(shape, where) {
  const kinds = ["list", "object", "none", "blob"].filter((k) => k in shape);
  expect(kinds, `${where}: one of list/object/none/blob`).toHaveLength(1);
  const fields = shape.list || shape.object || [];
  for (const f of fields) expect(f, `${where}: field names are strings`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*\??$/);
  expect(new Set(fields.map((f) => f.replace(/\?$/, ""))).size, `${where}: no duplicate fields`).toBe(fields.length);
  for (const [name, sub] of Object.entries(shape.nested || {})) {
    expect(fields.map((f) => f.replace(/\?$/, "")), `${where}: nested "${name}" is a listed field`).toContain(name);
    checkDescriptor(sub, `${where}.${name}`);
  }
}

test("every entry has a well-formed key, response and request descriptor", () => {
  for (const [key, entry] of Object.entries(API)) {
    expect(key).toMatch(/^(GET|POST|PATCH|PUT|DELETE) \/[a-z0-9/_:.-]+$/i);
    expect(entry.response, `${key}: response`).toBeTruthy();
    checkDescriptor(entry.response, `${key} response`);
    const method = key.split(" ")[0];
    const request = entry.request || {};
    if (method === "POST" || method === "PATCH") {
      expect(Boolean(request.json || request.form || request.empty), `${key}: a POST/PATCH needs a json, form or empty request descriptor`).toBe(true);
    }
    for (const list of [request.json, request.form, request.query]) {
      if (!list) continue;
      for (const f of list) expect(f).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(new Set(list).size).toBe(list.length);
    }
  }
});
