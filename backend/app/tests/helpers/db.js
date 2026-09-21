// -----------------------------------------------------------
//  [*] Test helpers — fake database
//
//  The app funnels every query through the single exported
//  pool object (src/db/pool.js), so the tests stub the DB by
//  replacing pool.query with a dispatcher — no module mocking
//  and no running Postgres needed.
//
//  A test registers [regex, result] handlers with onQuery();
//  the dispatcher collapses the SQL's whitespace, takes the
//  FIRST matching handler and returns its result. A query no
//  handler matches throws, so an unexpected query fails the
//  test loudly instead of silently returning rows. Every
//  query is also recorded for order/params assertions.
// -----------------------------------------------------------

import { pool } from "../../src/db/pool.js";


let handlers = [];
let log = [];







// -----------------------------------------------------------
// resetDb
// -----------------------------------------------------------
//
// Clears handlers and the query log and (re)installs the
// dispatcher over pool.query — call it in beforeEach.
//
// Used by:
//   - every *.routes.test.js file, and auth.test.js
// -----------------------------------------------------------

export function resetDb() {
  handlers = [];
  log = [];
  pool.query = dispatch;
}







// -----------------------------------------------------------
// onQuery
// -----------------------------------------------------------
//
// onQuery(/FROM users/, [{...}])          — rows shorthand
// onQuery(/INSERT/, { rows, rowCount })   — full result
// onQuery(/UPDATE/, (sql, params) => ...) — computed / stateful
//
// A handler function may throw to simulate a DB error (set
// err.code = "23505" for unique violations).
//
// Used by:
//   - every *.routes.test.js file, and auth.test.js
// -----------------------------------------------------------

export function onQuery(re, result) {
  handlers.push([re, result]);
}







// -----------------------------------------------------------
// queryLog
// -----------------------------------------------------------
//
// The queries executed so far, as { sql, params } with the
// SQL whitespace collapsed — for asserting order ("was BEGIN
// issued?", "was the DELETE skipped?") and bound params.
//
// Used by:
//   - userRoles.routes.test.js, themes.routes.test.js,
//     activities.routes.test.js, session.routes.test.js
// -----------------------------------------------------------

export function queryLog() {
  return log;
}







// -----------------------------------------------------------
// dispatch
// -----------------------------------------------------------
//
// The pool.query replacement: log, match, normalize. Results
// normalize like pg's: a plain array becomes { rows,
// rowCount: rows.length }.
//
// Used by:
//   - resetDb (above) — installed as pool.query
// -----------------------------------------------------------

async function dispatch(sql, params) {
  const flat = String(sql).replace(/\s+/g, " ").trim();
  log.push({ sql: flat, params });

  for (const [re, result] of handlers) {
    if (re.test(flat)) {
      const r = typeof result === "function" ? result(flat, params) : result;
      if (Array.isArray(r)) return { rows: r, rowCount: r.length };
      if (r && typeof r === "object") {
        return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows ? r.rows.length : 0) };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  throw new Error("test fake DB: no handler for query: " + flat);
}
