// -----------------------------------------------------------
//  [*] Regression — the API's JSON shapes, the backend's copy
//
//  The backend's own, hand-kept copy of its JSON contract:
//  for every route, the request fields the handler reads and
//  the exact fields its answer holds. Nothing is taken on
//  trust — each entry is checked against the backend's own
//  source: the body / query / params / file reads are
//  extracted from the handler (and the helpers it names), the
//  output names of every SELECT and RETURNING it runs are
//  parsed from the SQL, the statement that sends the answer
//  is located, and the answer's fields are derived from those
//  parts and compared with the table. A renamed alias, a
//  dropped column, a new body field or a changed send fails
//  here until the table is changed on purpose. The frontend
//  keeps its own copy in its own suite; the two never share a
//  file.
//
//  SHAPES entries:
//    file, at      — the route file and the registration text
//    reads         — { body, query, params, file, via }: what
//                    the handler reads; `via` names helper
//                    spans whose reads count too; `bodyFrom:
//                    "allowed"` means the keys come from a
//                    `const allowed = [...]` list
//    sql           — [{ n, out }]: the n-th `.query(` in the
//                    handler span and its output names (null
//                    = no rows come back); { helper, n, out }
//                    for a query inside a named helper
//    sends         — rows | row | row201 | object | none |
//                    file | tree: how the 2xx answer is sent
//    response      — the answer's fields and where they come
//                    from: { query: n } (a pass-through of
//                    that query's rows), { keys: [...] } (a
//                    handler-built object), { tree } (the
//                    themes nesting)
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


const SRC = new URL("../src/", import.meta.url).pathname;

// Row field lists several activity routes share — pinned once
const ACT_MY = ["id", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACT_OWN = ["id", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACT_FULL = ["id", "employee_eid", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "committee_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACT_EVALUATED = ["id", "theme_id", "subtheme_id", "title", "description", "status", "created_at", "updated_at", "rejection_comment", "manager_comments", "committee_comments", "score", "attachment_path", "attachment_original_name", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACT_PENDING = ["id", "theme_id", "subtheme_id", "title", "description", "status", "created_at", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACT_CREATED = ["id", "employee_eid", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at"];
const ACT_FORM = ["theme_id", "subtheme_id", "title", "description"];
const SUBTHEME = ["id", "theme_id", "code", "title", "description", "cap"];
const OWNER_STATUS = ["employee_eid", "status"];







// -----------------------------------------------------------
// SHAPES
// -----------------------------------------------------------
//
// One entry per route, keyed "METHOD /mounted/path".
//
// Used by:
//   - every test below
// -----------------------------------------------------------

const SHAPES = {
  // ---- index.js
  "GET /api/health": { file: "index.js", at: "app.get('/api/health'", reads: {}, sql: [], sends: "object", response: { keys: ["ok"] } },
  "GET /api/me": { file: "index.js", at: 'app.get("/api/me"', reads: {}, sql: [], sends: "object", response: { keys: ["name", "email", "eid", "roles"] } },

  // ---- routes/saml.js (the JSON one; the rest are browser flows)
  "POST /auth/saml/logout": { file: "routes/saml.js", at: 'samlRouter.post("/logout"', reads: {}, sql: [], sends: "object", response: { keys: ["redirect"] } },

  // ---- routes/session.js
  "GET /api/session/check": {
    file: "routes/session.js", at: 'router.get("/check"', reads: {},
    sql: [{ n: 0, out: ["eid", "email", "full_name", "created_at", "last_login_at"] }],
    sends: "object", response: { keys: ["user", "roles"], nested: { user: { query: 0 } } },
  },

  // ---- routes/users.js, roles.js
  "GET /api/users": { file: "routes/users.js", at: "router.get('/'", reads: {}, sql: [{ n: 0, out: ["eid", "email", "full_name", "created_at"] }], sends: "rows", response: { query: 0 } },
  "GET /api/roles": { file: "routes/roles.js", at: 'router.get("/"', reads: {}, sql: [{ n: 0, out: ["id", "name", "description"] }], sends: "rows", response: { query: 0 } },
  "POST /api/roles/assign": { file: "routes/roles.js", at: 'router.post("/assign"', reads: { body: ["user_eid", "role_name"] }, sql: [{ n: 0, out: ["id"] }, { n: 1, out: null }], sends: "none", response: { none: true } },

  // ---- routes/userRoles.js
  "GET /api/user-roles": {
    file: "routes/userRoles.js", at: 'router.get("/"', reads: { query: ["email"] },
    sql: [{ helper: "findUserByEmail", n: 0, out: ["id", "email", "full_name"] }, { n: 0, out: ["name", "owned"] }],
    sends: "object", response: { keys: ["user", "roles", "allRoles"], nested: { user: { helper: "findUserByEmail", n: 0 } } },
  },
  "POST /api/user-roles/assign": { file: "routes/userRoles.js", at: 'router.post("/assign"', reads: { body: ["email", "role"], via: ["readEmailAndRole"] }, sql: [{ helper: "findRoleId", n: 0, out: ["id"] }, { n: 0, out: null }], sends: "none", response: { none: true } },
  "POST /api/user-roles/remove": { file: "routes/userRoles.js", at: 'router.post("/remove"', reads: { body: ["email", "role"], via: ["readEmailAndRole"] }, sql: [{ n: 0, out: null }], sends: "none", response: { none: true } },

  // ---- routes/themes.js
  "GET /api/themes": {
    file: "routes/themes.js", at: 'router.get("/"', reads: {},
    sql: [{ n: 0, out: ["id", "code", "title", "total_sum", "pointvalue"] }, { n: 1, out: SUBTHEME }],
    sends: "tree", response: { tree: { themes: 0, subthemes: 1 } },
  },
  "POST /api/themes": { file: "routes/themes.js", at: 'router.post("/"', reads: { body: ["code", "title"] }, sql: [{ n: 0, out: ["id", "code", "title"] }], sends: "row201", response: { query: 0 } },
  "PATCH /api/themes/:id": { file: "routes/themes.js", at: 'router.patch("/:id"', reads: { body: ["code", "title"], bodyFrom: "allowed", params: ["id"] }, sql: [{ n: 0, out: ["id", "code", "title"] }], sends: "row", response: { query: 0 } },
  "POST /api/themes/:themeId/subthemes": { file: "routes/themes.js", at: 'router.post("/:themeId/subthemes"', reads: { body: ["code", "title", "description"], params: ["themeId"] }, sql: [{ n: 0, out: SUBTHEME }], sends: "row201", response: { query: 0 } },
  "PATCH /api/themes/subthemes/:id": { file: "routes/themes.js", at: 'router.patch("/subthemes/:id"', reads: { body: ["code", "title", "description"], bodyFrom: "allowed", params: ["id"] }, sql: [{ n: 0, out: SUBTHEME }], sends: "row", response: { query: 0 } },
  "PATCH /api/themes/subthemes/:id/cap": { file: "routes/themes.js", at: 'router.patch("/subthemes/:id/cap"', reads: { body: ["cap"], params: ["id"] }, sql: [{ n: 0, out: SUBTHEME }], sends: "row", response: { query: 0 } },
  "PATCH /api/themes/:id/total-sum": { file: "routes/themes.js", at: 'router.patch("/:id/total-sum"', reads: { body: ["total_sum"], params: ["id"] }, sql: [{ n: 0, out: ["id", "code", "title", "total_sum"] }], sends: "row", response: { query: 0 } },
  "PATCH /api/themes/:id/pointvalue": { file: "routes/themes.js", at: 'router.patch("/:id/pointvalue"', reads: { body: ["pointvalue"], params: ["id"] }, sql: [{ n: 0, out: ["id", "code", "title", "total_sum", "pointvalue"] }], sends: "row", response: { query: 0 } },
  "DELETE /api/themes/:id": {
    file: "routes/themes.js", at: 'router.delete("/:id"', reads: { params: ["id"] },
    // the linked-activities probe, then the transaction: BEGIN, the two DELETEs, ROLLBACK on a missing theme, COMMIT, ROLLBACK on failure
    sql: [{ n: 0, out: ["?column?"] }, { n: 1, out: null }, { n: 2, out: null }, { n: 3, out: null }, { n: 4, out: null }, { n: 5, out: null }, { n: 6, out: null }],
    sends: "none", response: { none: true },
  },
  "DELETE /api/themes/subthemes/:id": { file: "routes/themes.js", at: 'router.delete("/subthemes/:id"', reads: { params: ["id"] }, sql: [{ n: 0, out: null }], sends: "none", response: { none: true } },

  // ---- routes/activities.js
  "POST /api/activities": { file: "routes/activities.js", at: 'router.post("/"', reads: { body: ACT_FORM, via: ["storage"], viaBody: ["theme_code", "subtheme_code"], file: "attachment" }, sql: [{ n: 0, out: ACT_CREATED }], sends: "row201", response: { query: 0 } },
  "GET /api/activities/my": { file: "routes/activities.js", at: 'router.get("/my"', reads: {}, sql: [{ n: 0, out: ACT_MY }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/all": { file: "routes/activities.js", at: 'router.get("/all"', reads: {}, sql: [{ n: 0, out: ACT_FULL }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/committee": { file: "routes/activities.js", at: 'router.get("/committee"', reads: {}, sql: [{ n: 0, out: ACT_FULL }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/evaluated": { file: "routes/activities.js", at: 'router.get("/evaluated"', reads: {}, sql: [{ n: 0, out: ACT_EVALUATED }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/evaluated/theme-totals": { file: "routes/activities.js", at: 'router.get("/evaluated/theme-totals"', reads: {}, sql: [{ n: 0, out: ["theme_id", "theme_code", "theme_title", "theme_total_sum", "theme_pointvalue", "total_score"] }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/evaluated/employees": { file: "routes/activities.js", at: 'router.get("/evaluated/employees"', reads: {}, sql: [{ n: 0, out: ["eid", "full_name", "email"] }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/evaluated/employee/:eid/subthemes": { file: "routes/activities.js", at: 'router.get("/evaluated/employee/:eid/subthemes"', reads: { params: ["eid"] }, sql: [{ n: 0, out: ["theme_id", "theme_code", "theme_title", "subtheme_id", "subtheme_code", "subtheme_title", "total_score", "subtheme_cap", "theme_pointvalue"] }], sends: "rows", response: { query: 0 } },
  "GET /api/activities/pending": { file: "routes/activities.js", at: 'router.get("/pending"', reads: {}, sql: [{ n: 0, out: ACT_PENDING }], sends: "rows", response: { query: 0 } },
  "PATCH /api/activities/:id/manager": {
    file: "routes/activities.js", at: 'router.patch("/:id/manager"', reads: { body: ["action", "manager_comments", "rejection_comment", "theme_id", "subtheme_id"], params: ["id"] },
    sql: [{ n: 0, out: ["status"] }, { n: 1, out: null }, { n: 2, out: ACT_FULL }],
    sends: "row", response: { query: 2 },
  },
  "PATCH /api/activities/:id/committee": {
    file: "routes/activities.js", at: 'router.patch("/:id/committee"', reads: { body: ["action", "score", "committee_comments", "theme_id", "subtheme_id"], params: ["id"] },
    sql: [{ n: 0, out: ["status"] }, { n: 1, out: null }, { n: 2, out: ACT_FULL }],
    sends: "row", response: { query: 2 },
  },
  "GET /api/activities/:id/attachment": { file: "routes/activities.js", at: 'router.get("/:id/attachment"', reads: { params: ["id"] }, sql: [{ n: 0, out: ["attachment_path", "attachment_original_name", "employee_eid"] }], sends: "file", response: { blob: true } },
  "PATCH /api/activities/:id": {
    file: "routes/activities.js", at: 'router.patch("/:id"', reads: { body: ACT_FORM, via: ["storage"], viaBody: ["theme_code", "subtheme_code"], file: "attachment", params: ["id"] },
    sql: [{ n: 0, out: ["employee_eid", "status", "attachment_path"] }, { n: 1, out: null }, { n: 2, out: ACT_OWN }],
    sends: "row", response: { query: 2 },
  },
  "DELETE /api/activities/:id": { file: "routes/activities.js", at: 'router.delete("/:id"', reads: { params: ["id"] }, sql: [{ n: 0, out: OWNER_STATUS }, { n: 1, out: ["attachment_path"] }], sends: "none", response: { none: true } },
  "POST /api/activities/:id/resubmit": { file: "routes/activities.js", at: 'router.post("/:id/resubmit"', reads: { params: ["id"] }, sql: [{ n: 0, out: OWNER_STATUS }, { n: 1, out: null }, { n: 2, out: ACT_OWN }], sends: "row", response: { query: 2 } },
};

// Browser-flow routes with no JSON answer of their own
const NOT_JSON = ["GET /auth/saml/metadata", "GET /auth/saml/login", "POST /auth/saml/assert", "GET /auth/saml/logout/callback"];

// The multipart field multer reads the file from
const FILE_FIELD = "attachment";







// -----------------------------------------------------------
// spanOf
// -----------------------------------------------------------
//
// The source of one item: from `marker` to the next banner
// rule line or the next route registration, whichever comes
// first (house style puts a banner before every top-level
// item; the SAML router keeps its routes inside one factory
// with plain comments between them), or the end of the file.
//
// Used by:
//   - handlerSpan, helperSpan (below)
// -----------------------------------------------------------

const RULE = "\n// -----------------------------------------------------------";

const REGISTRATION = /\n\s*(?:router|samlRouter|app)\.(?:get|post|patch|put|delete|use)\(/g;

function spanOf(src, marker, label) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `${label}: "${marker}" not found`);
  assert.equal(src.indexOf(marker, start + 1), -1, `${label}: "${marker}" appears twice`);
  const ends = [src.indexOf(RULE, start)];
  REGISTRATION.lastIndex = start + marker.length;
  const next = REGISTRATION.exec(src);
  if (next) ends.push(next.index);
  const end = Math.min(...ends.filter((e) => e !== -1));
  return src.slice(start, Number.isFinite(end) ? end : src.length);
}

const sources = new Map();
const read = (file) => {
  if (!sources.has(file)) sources.set(file, fs.readFileSync(path.join(SRC, file), "utf8"));
  return sources.get(file);
};
const handlerSpan = (entry, key) => spanOf(read(entry.file), entry.at, key);
const helperSpan = (file, name, key) => {
  const src = read(file);
  const marker = src.includes(`function ${name}(`) ? `function ${name}(` : `const ${name} = `;
  return spanOf(src, marker, `${key} helper ${name}`);
};







// -----------------------------------------------------------
// readsOf
// -----------------------------------------------------------
//
// What a span reads from the request: req.body.x and
// destructured `{ a, b } = req.body` (plus `body.x` in a
// helper handed the body), the strings of `const allowed =
// [...]` when a route filters keys that way, req.query.x,
// req.params.x (also destructured), and whether req.file is
// used.
//
// Used by:
//   - the request-fields test (below)
// -----------------------------------------------------------

function readsOf(span, { allowed = false, helperBody = false } = {}) {
  const body = new Set();
  for (const m of span.matchAll(/req\.body\??\.(\w+)/g)) body.add(m[1]);
  for (const m of span.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\.body/g)) {
    for (const part of m[1].split(",")) { const name = part.trim().split(/[\s=:]/)[0]; if (name) body.add(name); }
  }
  if (helperBody) for (const m of span.matchAll(/\bbody\??\.(\w+)/g)) body.add(m[1]);
  if (allowed) {
    const m = /const allowed = \[([^\]]*)\]/.exec(span);
    assert.ok(m, "a `const allowed = [...]` list");
    for (const s of m[1].matchAll(/"(\w+)"/g)) body.add(s[1]);
  }
  const query = new Set([...span.matchAll(/req\.query\??\.(\w+)/g)].map((m) => m[1]));
  const params = new Set([...span.matchAll(/req\.params\??\.(\w+)/g)].map((m) => m[1]));
  for (const m of span.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\.params/g)) {
    for (const part of m[1].split(",")) { const name = part.trim().split(/[\s=:]/)[0]; if (name) params.add(name); }
  }
  return { body: [...body].sort(), query: [...query].sort(), params: [...params].sort(), file: /req\.file\b/.test(span) };
}







// -----------------------------------------------------------
// queriesOf / sqlOutputs
// -----------------------------------------------------------
//
// queriesOf(span): every SQL string literal handed to
// `.query(` in the span, in order. sqlOutputs(sql): the
// output names of a statement — a RETURNING list, or a
// SELECT list (an alias after AS, else the last dotted
// segment; a bare literal like SELECT 1 is "?column?") — or
// null for a statement that returns no rows.
//
// Used by:
//   - the SQL test and the response test (below)
// -----------------------------------------------------------

function queriesOf(span) {
  return [...span.matchAll(/\.query\(\s*(?:`([\s\S]*?)`|'([^']*)'|"([^"]*)")/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function splitTop(list) {
  const parts = [];
  let depth = 0, current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim());
}

function outputName(expr) {
  const as = /\s+AS\s+"?(\w+)"?$/i.exec(expr);
  if (as) return as[1];
  if (/^\d+$/.test(expr) || /\)$/.test(expr)) return "?column?";
  const m = /(?:^|\.)(\w+)$/.exec(expr);
  return m ? m[1] : "?column?";
}

export function sqlOutputs(sql) {
  const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  const ret = /\bRETURNING\s+(.+?)\s*$/i.exec(flat);
  if (ret) return splitTop(ret[1]).map(outputName);
  const sel = /^SELECT\s+(?:DISTINCT\s+)?(.+?)\s+FROM\s/i.exec(flat);
  if (sel) return splitTop(sel[1]).map(outputName);
  return null;
}







// -----------------------------------------------------------
// sentKeys
// -----------------------------------------------------------
//
// The keys of every `res.json({ … })` object literal in a
// span (the success answers — errors go through
// res.status(...).json). All occurrences must agree.
//
// Used by:
//   - the response test (below)
// -----------------------------------------------------------

function sentKeys(span, key) {
  const literals = [...span.matchAll(/res\.json\(\{([^}]*)\}\)/g)].map((m) =>
    m[1].split(",").map((p) => p.trim().split(":")[0].trim()).filter(Boolean).sort()
  );
  assert.ok(literals.length, `${key}: no res.json({ … }) in the handler`);
  for (const l of literals) assert.deepEqual(l, literals[0], `${key}: every res.json({ … }) sends the same keys`);
  return literals[0];
}

const SEND_PATTERNS = {
  rows: /res\.json\((?:\w+\.rows|rows)\)/,
  row: /res\.json\(\w+\.rows\[0\]\)/,
  row201: /res\.status\(201\)\.json\(\w+\.rows\[0\]\)/,
  object: /res\.json\(\{/,
  none: /sendStatus\(204\)|status\(204\)\.end\(\)/,
  file: /res\.download\(/,
  tree: /res\.json\(Array\.from\(map\.values\(\)\)\)/,
};

const stripOptional = (fields) => fields.map((f) => f.replace(/\?$/, ""));
const outOf = (entry, spec, key) => {
  const n = spec.query ?? spec.n;
  const item = entry.sql.find((q) => (spec.helper ? q.helper === spec.helper : !q.helper) && q.n === n);
  assert.ok(item, `${key}: response refers to a query the entry does not list`);
  return item.out;
};







// -----------------------------------------------------------
// the route table is covered
// -----------------------------------------------------------
//
// Every registration in the route files and index.js has an
// entry (or is a listed browser flow), and every entry names
// a real registration — read from the code, so a new route
// cannot go unpinned.
// -----------------------------------------------------------

test("every route has a SHAPES entry, every entry a route", () => {
  const index = read("index.js");
  const prefixes = { "saml.js": "/auth/saml" };
  const imports = Object.fromEntries([...index.matchAll(/import\s+(\w+)\s+from\s+["']\.\/routes\/(\w+)\.js["']/g)].map((m) => [m[1], `${m[2]}.js`]));
  for (const m of index.matchAll(/app\.use\(\s*["']([^"']+)["'][^;]*?\b(\w+Router)\s*\)/g)) prefixes[imports[m[2]]] = m[1];

  const registered = new Set([...index.matchAll(/app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`));
  for (const [file, prefix] of Object.entries(prefixes)) {
    for (const m of read(`routes/${file}`).matchAll(/\b(?:router|samlRouter)\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g)) {
      registered.add(`${m[1].toUpperCase()} ${prefix}${m[2] === "/" ? "" : m[2]}`);
    }
  }
  const covered = new Set([...Object.keys(SHAPES), ...NOT_JSON]);
  assert.deepEqual([...registered].filter((r) => !covered.has(r)), [], "routes without a SHAPES entry");
  assert.deepEqual([...covered].filter((r) => !registered.has(r)), [], "SHAPES entries without a route");
});







// -----------------------------------------------------------
// request fields
// -----------------------------------------------------------
//
// The body, query and params each handler reads — in its own
// span and in the helper spans the entry names — equal the
// table, and a route that reads req.file reads the one
// multipart field multer is configured for.
// -----------------------------------------------------------

test("every handler reads exactly the request fields its entry lists", () => {
  for (const [key, entry] of Object.entries(SHAPES)) {
    const own = readsOf(handlerSpan(entry, key), { allowed: entry.reads.bodyFrom === "allowed" });
    const body = new Set(own.body);
    for (const name of entry.reads.via || []) {
      const extra = readsOf(helperSpan(entry.file, name, key), { helperBody: true });
      for (const f of extra.body) body.add(f);
    }
    const expectedBody = [...(entry.reads.body || []), ...(entry.reads.viaBody || [])].sort();
    assert.deepEqual([...body].sort(), expectedBody, `${key}: body fields`);
    assert.deepEqual(own.query, [...(entry.reads.query || [])].sort(), `${key}: query fields`);
    assert.deepEqual(own.params, [...(entry.reads.params || [])].sort(), `${key}: params`);
    assert.equal(own.file, Boolean(entry.reads.file), `${key}: req.file`);
    if (entry.reads.file) assert.equal(entry.reads.file, FILE_FIELD);
  }
  assert.match(read("routes/activities.js"), new RegExp(`upload\\.single\\("${FILE_FIELD}"\\)`));
});







// -----------------------------------------------------------
// SQL output names
// -----------------------------------------------------------
//
// Every query the entry lists exists at that position and
// produces exactly the output names in the table; the entry
// lists every query the span runs.
// -----------------------------------------------------------

test("every SELECT and RETURNING produces exactly the output names its entry lists", () => {
  for (const [key, entry] of Object.entries(SHAPES)) {
    const inHandler = queriesOf(handlerSpan(entry, key));
    const listed = entry.sql.filter((q) => !q.helper).map((q) => q.n).sort();
    assert.deepEqual(listed, inHandler.map((_, i) => i), `${key}: the entry lists every query in the handler (${inHandler.length} found)`);
    for (const q of entry.sql) {
      const span = q.helper ? helperSpan(entry.file, q.helper, key) : null;
      const all = span ? queriesOf(span) : inHandler;
      assert.ok(all[q.n] !== undefined, `${key}: query ${q.helper ? q.helper + "#" : "#"}${q.n} exists`);
      assert.deepEqual(sqlOutputs(all[q.n]), q.out, `${key}: output names of query ${q.helper ? q.helper + "#" : "#"}${q.n}`);
    }
  }
});







// -----------------------------------------------------------
// the answer
// -----------------------------------------------------------
//
// How the 2xx answer is sent matches `sends`, and its fields
// follow from the parts: a pass-through's fields are that
// query's output names, a built object's keys are the ones in
// res.json({ … }) with nested rows from their query, the
// themes tree is theme rows plus "subthemes" holding subtheme
// rows.
// -----------------------------------------------------------

test("every answer is sent the way its entry says and holds exactly the fields that follow", () => {
  for (const [key, entry] of Object.entries(SHAPES)) {
    const span = handlerSpan(entry, key);
    assert.match(span, SEND_PATTERNS[entry.sends], `${key}: sends ${entry.sends}`);
    const r = entry.response;
    if ("query" in r) {
      assert.ok(Array.isArray(outOf(entry, { n: r.query }, key)), `${key}: the pass-through query returns rows`);
    } else if (r.keys) {
      assert.deepEqual(sentKeys(span, key), stripOptional(r.keys).sort(), `${key}: answer keys`);
      for (const [name, from] of Object.entries(r.nested || {})) {
        assert.ok(Array.isArray(outOf(entry, from, key)), `${key}: nested ${name} comes from a query with rows`);
      }
    } else if (r.tree) {
      assert.ok(outOf(entry, { n: r.tree.themes }, key).length && outOf(entry, { n: r.tree.subthemes }, key).length);
      assert.match(span, /subthemes: \[\]/, `${key}: every theme gets a subthemes list`);
    } else {
      assert.ok(r.none || r.blob, `${key}: a response form`);
    }
  }
});







// -----------------------------------------------------------
// the parsers
// -----------------------------------------------------------
//
// sqlOutputs on the shapes of SQL this codebase writes:
// dotted columns, AS aliases, DISTINCT, aggregates, a bare
// literal, RETURNING, and statements that return nothing.
// -----------------------------------------------------------

test("sqlOutputs: select lists, aliases, aggregates, returning, no-row statements", () => {
  assert.deepEqual(sqlOutputs("SELECT a.id, a.theme_id, t.code AS theme_code, t.title  AS theme_title FROM activities a JOIN themes t ON t.id = a.theme_id WHERE a.id = $1"), ["id", "theme_id", "theme_code", "theme_title"]);
  assert.deepEqual(sqlOutputs("SELECT DISTINCT u.eid, u.full_name FROM activities a JOIN users u ON u.eid = a.employee_eid"), ["eid", "full_name"]);
  assert.deepEqual(sqlOutputs("SELECT t.id AS theme_id, COALESCE(SUM(a.score), 0) AS total_score FROM themes t LEFT JOIN activities a ON a.theme_id = t.id GROUP BY t.id"), ["theme_id", "total_score"]);
  assert.deepEqual(sqlOutputs("SELECT r.name, ur.user_eid IS NOT NULL AS owned FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id"), ["name", "owned"]);
  assert.deepEqual(sqlOutputs("SELECT 1 FROM subthemes WHERE id = $1 AND theme_id = $2"), ["?column?"]);
  assert.deepEqual(sqlOutputs("SELECT eid AS id, email, full_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1"), ["id", "email", "full_name"]);
  assert.deepEqual(sqlOutputs("INSERT INTO themes (code, title) VALUES ($1, $2) RETURNING id, code, title"), ["id", "code", "title"]);
  assert.deepEqual(sqlOutputs("UPDATE themes SET ${sets.join(\", \")} WHERE id = $3 RETURNING id, code, title"), ["id", "code", "title"]);
  assert.deepEqual(sqlOutputs("DELETE FROM activities WHERE id = $1 RETURNING attachment_path"), ["attachment_path"]);
  assert.equal(sqlOutputs("UPDATE activities SET status = 'PATEIKTA' WHERE id = $1"), null);
  assert.equal(sqlOutputs("INSERT INTO user_roles (user_eid, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"), null);
  assert.equal(sqlOutputs("BEGIN"), null);
});
