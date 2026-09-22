// -----------------------------------------------------------
//  [*] Regression — SQL vs postgres/init.sql
//
//  Every table and column the backend's SQL touches must
//  exist in the schema a fresh database is created from.
//  This is the class of bug routes/users.js shipped with for
//  months: it selected an `id` column the users table never
//  had, so the route could not work against the real
//  database and no unit test noticed (the fake pool answers
//  any SQL). The checker below is deliberately simple —
//  aliases, qualified columns, INSERT column lists, SET
//  lists, WHERE/ORDER BY columns and the select list of
//  single-table statements — and is validated against a
//  planted phantom column so it cannot silently go blind.
//
//  init.sql lives outside the app tree; runTests.sh mounts
//  the repo's postgres/ dir at /app/postgres for it.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";


// Where init.sql may be: inside the container (mounted by
// runTests.sh) or two levels up in the repo
const INIT_SQL_CANDIDATES = [
  new URL("../postgres/init.sql", import.meta.url).pathname,
  new URL("../../../postgres/init.sql", import.meta.url).pathname,
];

// The backend's table-name constants (db/tables.js), as they
// appear inside the SQL template literals
const TABLE_CONSTANTS = { TBL_USERS: "users", TBL_ROLES: "roles", TBL_USER_ROLES: "user_roles" };

// Words that can sit where a column name would but are not
// columns
const NOT_COLUMNS = new Set([
  "select", "distinct", "from", "where", "and", "or", "not", "in", "is", "null",
  "as", "on", "join", "left", "right", "inner", "group", "by", "order", "asc",
  "desc", "limit", "returning", "values", "set", "conflict", "do", "nothing",
  "update", "insert", "into", "delete", "count", "sum", "coalesce", "lower",
  "now", "excluded", "true", "false", "case", "when", "then", "else", "end",
]);







// -----------------------------------------------------------
// loadSchema
// -----------------------------------------------------------
//
// init.sql → { table: Set(columns) } from its CREATE TABLE
// blocks; constraint lines (PRIMARY KEY (...)) are skipped.
//
// Used by:
//   - the tests (below)
// -----------------------------------------------------------

function loadSchema() {
  const file = INIT_SQL_CANDIDATES.find((p) => fs.existsSync(p));
  assert.ok(file, "postgres/init.sql not found — runTests.sh mounts it at /app/postgres");
  const sql = fs.readFileSync(file, "utf8");

  const schema = {};
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\);/g)) {
    const cols = new Set();
    for (const line of m[2].split("\n")) {
      const word = line.trim().split(/\s+/)[0];
      if (!word || /^(primary|unique|constraint|foreign|check)$/i.test(word)) continue;
      cols.add(word.toLowerCase());
    }
    schema[m[1].toLowerCase()] = cols;
  }
  return schema;
}







// -----------------------------------------------------------
// collectSql
// -----------------------------------------------------------
//
// Every string literal passed to pool.query / client.query
// under src/, with the TBL_* constants substituted and any
// other ${...} interpolation (dynamic SET lists) blanked.
//
// Used by:
//   - the tests (below)
// -----------------------------------------------------------

function collectSql(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".js")) {
        const src = fs.readFileSync(p, "utf8");
        for (const m of src.matchAll(/\.query\(\s*(`([^`]*)`|'([^']*)'|"([^"]*)")/g)) {
          let sql = m[2] ?? m[3] ?? m[4];
          sql = sql.replace(/\$\{(TBL_\w+)\}/g, (_, k) => TABLE_CONSTANTS[k] ?? k);
          sql = sql.replace(/\$\{[^}]*\}/g, " ");
          out.push({ file: path.relative(dir, p), sql: sql.replace(/\s+/g, " ").trim() });
        }
      }
    }
  };
  walk(dir);
  return out;
}







// -----------------------------------------------------------
// checkStatement
// -----------------------------------------------------------
//
// One SQL statement against the schema → a list of problems
// ("table x", "users.id"), empty when everything resolves.
//
// Used by:
//   - the tests (below)
// -----------------------------------------------------------

function checkStatement(sql, schema) {
  const problems = [];
  const s = sql.toLowerCase();

  // Tables and their aliases: FROM t [a], JOIN t [a],
  // INSERT INTO t, UPDATE t, DELETE FROM t
  const aliases = {};
  const tables = new Set();
  for (const m of s.matchAll(/\b(?:from|join|into|update)\s+(\w+)(?:\s+(?!on\b|where\b|set\b|values\b|left\b|join\b|order\b|group\b|limit\b|returning\b|\()(\w+))?/g)) {
    const table = m[1];
    if (NOT_COLUMNS.has(table)) continue;
    tables.add(table);
    aliases[table] = table;
    if (m[2]) aliases[m[2]] = table;
    if (/insert into/.test(s)) aliases.excluded = table;
  }
  for (const t of tables) if (!schema[t]) problems.push(`table ${t}`);

  const known = (table, col) => schema[table] && schema[table].has(col);
  const flag = (table, col) => {
    if (!schema[table]) return;
    if (!known(table, col)) problems.push(`${table}.${col}`);
  };

  // Qualified references: alias.column
  for (const m of s.matchAll(/\b(\w+)\.(\w+)\b/g)) {
    if (aliases[m[1]]) flag(aliases[m[1]], m[2]);
  }

  // INSERT column lists: INSERT INTO t (a, b, c)
  for (const m of s.matchAll(/insert into (\w+)\s*\(([^)]*)\)/g)) {
    for (const c of m[2].split(",")) flag(m[1], c.trim());
  }
  // ON CONFLICT (col)
  for (const m of s.matchAll(/on conflict \((\w+)\)/g)) {
    const t = [...tables][0]; flag(t, m[1]);
  }

  // Unqualified columns only make sense for single-table
  // statements (the join queries qualify everything)
  if (tables.size === 1) {
    const t = [...tables][0];
    const items = [];
    const sel = s.match(/^select (.*?) from /); if (sel) items.push(...sel[1].split(","));
    const ret = s.match(/returning (.*)$/); if (ret) items.push(...ret[1].split(","));
    for (const item of items) {
      const first = item.trim().split(/\s+/)[0];
      if (/^\w+$/.test(first) && !NOT_COLUMNS.has(first) && !/^\d+$/.test(first)) flag(t, first);
    }
    const set = s.match(/\bset (.*?)(?: where |$)/);
    if (set) for (const a of set[1].split(",")) { const c = a.trim().split(/\s*=/)[0]; if (/^\w+$/.test(c)) flag(t, c); }
    for (const m of s.matchAll(/\b(\w+)\s*(?:=|<>|!=|is\b|<|>)/g)) {
      if (/^\w+$/.test(m[1]) && !NOT_COLUMNS.has(m[1]) && !/^\d+$/.test(m[1])) flag(t, m[1]);
    }
    for (const m of s.matchAll(/lower\((\w+)\)/g)) flag(t, m[1]);
    for (const m of s.matchAll(/order by (\w+)/g)) flag(t, m[1]);
  }

  return problems;
}







// -----------------------------------------------------------
// every statement resolves
// -----------------------------------------------------------
//
// The whole src/ tree against init.sql: no unknown table, no
// unknown column, reported per file with the offending SQL.
// -----------------------------------------------------------

test("every table and column the backend's SQL touches exists in postgres/init.sql", () => {
  const schema = loadSchema();
  assert.ok(Object.keys(schema).length >= 6, "init.sql parsed: " + Object.keys(schema).join(", "));

  const statements = collectSql(new URL("../src", import.meta.url).pathname);
  assert.ok(statements.length >= 40, `expected the routes' SQL, found ${statements.length} statements`);

  const failures = [];
  for (const { file, sql } of statements) {
    const problems = checkStatement(sql, schema);
    if (problems.length) failures.push(`${file}: ${problems.join(", ")}\n    ${sql}`);
  }
  assert.deepEqual(failures, []);
});







// -----------------------------------------------------------
// the checker is not blind
// -----------------------------------------------------------
//
// The exact shapes that shipped broken — a phantom column
// in a select list, in an ORDER BY, in an INSERT column list
// and behind an alias — must each be reported.
// -----------------------------------------------------------

test("the checker reports phantom columns and tables", () => {
  const schema = loadSchema();
  const cases = [
    ["SELECT id, email FROM users ORDER BY id DESC", ["users.id", "users.id"]],
    ["INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id", ["users.id"]],
    ["SELECT u.nickname FROM activities a JOIN users u ON u.oid = a.employee_oid", ["users.nickname"]],
    ["DELETE FROM sessions WHERE id = $1", ["table sessions"]],
    ["SELECT oid, email, full_name, created_at FROM users ORDER BY created_at DESC", []],
  ];
  for (const [sql, expected] of cases) {
    assert.deepEqual(checkStatement(sql, schema), expected, sql);
  }
});
