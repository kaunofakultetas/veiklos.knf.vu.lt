// -----------------------------------------------------------
//  [*] Regression — routes /api/themes
//
//  The theme/subtheme catalog. Pins the guard split (read =
//  any signed-in session, structure = active Vadybininkas,
//  numbers = active Komisijos narys), the tree assembly, the
//  dynamic PATCH SET building, every validation message, the
//  transactional cascade DELETE, and the refusals that keep
//  bad input out of the database: a subtheme still in use,
//  ids Postgres cannot take, blank or non-text codes and
//  titles, a theme that is gone, and numbers that are not
//  numbers.
//
//  Pinned as expected failures until they are fixed, the
//  known bugs: codes too long for their unique index, NUL
//  characters in a code, title or description, subtheme
//  descriptions that are not text, a theme delete whose
//  dropped connection ends the process, and committee numbers
//  too large to be finite.
//
//  verifySamlSession/attachRoles are mocked
//  (helpers/authMock.js); requireActiveRoleIn is the real
//  one.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";
import { pool } from "../src/db/pool.js";


let app;

before(async () => {
  app = await startRouter("/api/themes", new URL("../src/routes/themes.js", import.meta.url).href);
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});







// -----------------------------------------------------------
// asRole
// -----------------------------------------------------------
//
// The X-Active-Role header the real requireActiveRoleIn guard
// reads.
//
// Used by:
//   - nearly every test in this file
// -----------------------------------------------------------

const asRole = (role) => ({ "X-Active-Role": role });







// -----------------------------------------------------------
// manager
// -----------------------------------------------------------
//
// Signs the mocked identity in as a role-owning manager.
//
// Used by:
//   - the structure-CRUD tests (below)
// -----------------------------------------------------------

const manager = () => signInAs("mgr-1", ["Vadybininkas"]);







// -----------------------------------------------------------
// committee
// -----------------------------------------------------------
//
// Signs in as a committee member — the numbers routes.
//
// Used by:
//   - the cap / total-sum / pointvalue tests (below)
// -----------------------------------------------------------

const committee = () => signInAs("com-1", ["Komisijos narys"]);







// -----------------------------------------------------------
// employee
// -----------------------------------------------------------
//
// Signs in as a plain employee — enough for the read guard,
// rejected by every write guard.
//
// Used by:
//   - the guard and GET / tests (below)
// -----------------------------------------------------------

const employee = () => signInAs("emp-1", ["Darbuotojas"]);







// -----------------------------------------------------------
// read guard
// -----------------------------------------------------------
//
// An employee with NO X-Active-Role header reads the
// tree — readGuard is JWT-only.
// -----------------------------------------------------------

test("GET / needs only a JWT — no X-Active-Role header required", async () => {
  employee();
  onQuery(/SELECT id, code, title, total_sum, pointvalue FROM themes/, []);
  onQuery(/SELECT id, theme_id, code, title, description, cap FROM subthemes/, []);

  const res = await api(app.base, "GET", "/api/themes");
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// write guard sweep
// -----------------------------------------------------------
//
// One POST probed through all four rejections:
// anonymous, missing header, wrong active role, unowned
// role — each body pinned.
// -----------------------------------------------------------

test("manage routes: 401 anonymous, 400 no header, 403 wrong/unowned role", async () => {
  let res = await api(app.base, "POST", "/api/themes", { body: { code: "T1", title: "X" } });
  assert.equal(res.status, 401);

  manager();
  res = await api(app.base, "POST", "/api/themes", { body: { code: "T1", title: "X" } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Active role header (X-Active-Role) is required" });

  employee();
  res = await api(app.base, "POST", "/api/themes", {
    body: { code: "T1", title: "X" },
    headers: asRole("Darbuotojas"),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Forbidden: selected role not allowed for this endpoint" });

  employee();
  res = await api(app.base, "POST", "/api/themes", {
    body: { code: "T1", title: "X" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: "Forbidden: you don't have the selected role" });
});







// -----------------------------------------------------------
// committee-only guard
// -----------------------------------------------------------
//
// An ACTIVE manager may not touch the committee's
// numbers.
// -----------------------------------------------------------

test("committee-only routes reject an active manager", async () => {
  manager();
  const res = await api(app.base, "PATCH", "/api/themes/1/total-sum", {
    body: { total_sum: 100 },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 403);
});







// -----------------------------------------------------------
// tree assembly
// -----------------------------------------------------------
//
// Two flat scripted queries; the nesting and the silent
// orphan drop are both pinned.
// -----------------------------------------------------------

test("GET /: subthemes nest under their theme; orphans are dropped silently", async () => {
  employee();
  onQuery(/FROM themes ORDER BY code ASC/, [
    { id: 1, code: "T1", title: "Tema 1", total_sum: 100, pointvalue: 2 },
    { id: 2, code: "T2", title: "Tema 2", total_sum: null, pointvalue: null },
  ]);
  onQuery(/FROM subthemes ORDER BY code ASC/, [
    { id: 10, theme_id: 1, code: "T1.1", title: "P1", description: null, cap: 5 },
    { id: 11, theme_id: 999, code: "X", title: "orphan", description: null, cap: null },
  ]);

  const res = await api(app.base, "GET", "/api/themes");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.deepEqual(res.body[0].subthemes.map((s) => s.id), [10]);
  assert.deepEqual(res.body[1].subthemes, []);
  // The orphan (theme_id 999) is nowhere in the response
  assert.ok(!JSON.stringify(res.body).includes("orphan"));
});







// -----------------------------------------------------------
// tree order
// -----------------------------------------------------------
//
// Postgres orders codes as text ("6.10." before "6.2."); the
// tree every dropdown is built from comes in code order
// instead — the themes, and each theme's subthemes. The live
// theme codes are a family name and a section number, and
// two families number their sections alike: the text decides
// first, so one family's themes stay together, and subthemes
// sharing a code stay under their own theme.
// -----------------------------------------------------------

test("GET /: themes and their subthemes come in numeric code order", async () => {
  employee();
  onQuery(/FROM themes ORDER BY code ASC/, [
    { id: 1, code: "6.1.", title: "A", total_sum: 0, pointvalue: null },
    { id: 10, code: "6.10.", title: "J", total_sum: 0, pointvalue: null },
    { id: 2, code: "6.2.", title: "B", total_sum: 0, pointvalue: null },
  ]);
  onQuery(/FROM subthemes ORDER BY code ASC/, [
    { id: 210, theme_id: 2, code: "6.2.10.", title: "P10", description: null, cap: null },
    { id: 22, theme_id: 2, code: "6.2.2.", title: "P2", description: null, cap: null },
  ]);

  const res = await api(app.base, "GET", "/api/themes");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((t) => t.code), ["6.1.", "6.2.", "6.10."]);
  assert.deepEqual(res.body[1].subthemes.map((st) => st.code), ["6.2.2.", "6.2.10."]);
});

test("GET /: the live codes — a family's themes stay together, each with its own subthemes", async () => {
  employee();
  onQuery(/FROM themes ORDER BY code ASC/, [
    { id: 1, code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.", title: "A", total_sum: 0, pointvalue: null },
    { id: 2, code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.", title: "B", total_sum: 0, pointvalue: null },
    { id: 3, code: "STUDIJŲ KOKYBĖ 6.1.", title: "C", total_sum: 0, pointvalue: null },
    { id: 5, code: "STUDIJŲ KOKYBĖ 6.10.", title: "E", total_sum: 0, pointvalue: null },
    { id: 4, code: "STUDIJŲ KOKYBĖ 6.2.", title: "D", total_sum: 0, pointvalue: null },
  ]);
  onQuery(/FROM subthemes ORDER BY code ASC/, [
    { id: 11, theme_id: 1, code: "6.1.1.", title: "E1", description: null, cap: null },
    { id: 31, theme_id: 3, code: "6.1.1.", title: "S1", description: null, cap: null },
    { id: 110, theme_id: 1, code: "6.1.10.", title: "E10", description: null, cap: null },
    { id: 12, theme_id: 1, code: "6.1.2.", title: "E2", description: null, cap: null },
    { id: 32, theme_id: 3, code: "6.1.2.", title: "S2", description: null, cap: null },
  ]);

  const res = await api(app.base, "GET", "/api/themes");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((t) => t.code), [
    "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.",
    "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.",
    "STUDIJŲ KOKYBĖ 6.1.",
    "STUDIJŲ KOKYBĖ 6.2.",
    "STUDIJŲ KOKYBĖ 6.10.",
  ]);
  assert.deepEqual(res.body[0].subthemes.map((st) => st.id), [11, 12, 110]);
  assert.deepEqual(res.body[2].subthemes.map((st) => st.id), [31, 32]);
});







// -----------------------------------------------------------
// create theme
// -----------------------------------------------------------
//
// The 400 message, then a 201 whose INSERT params prove
// the trimming.
// -----------------------------------------------------------

test("POST /: missing fields → 400; code+title are trimmed; 201 with the row", async () => {
  manager();
  let res = await api(app.base, "POST", "/api/themes", {
    body: { code: "T1" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Temos kodas ir pavadinimas yra privalomi" });

  onQuery(/INSERT INTO themes \(code, title\)/, (sql, params) => [
    { id: 5, code: params[0], title: params[1] },
  ]);
  res = await api(app.base, "POST", "/api/themes", {
    body: { code: "  T1  ", title: "  Tema  " },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: 5, code: "T1", title: "Tema" });
});







// -----------------------------------------------------------
// duplicate theme code
// -----------------------------------------------------------
//
// 23505 from the stub → 409 with the shipped message.
// -----------------------------------------------------------

test("POST /: duplicate code (23505) → 409", async () => {
  manager();
  onQuery(/INSERT INTO themes/, () => {
    const e = new Error("dup");
    e.code = "23505";
    throw e;
  });

  const res = await api(app.base, "POST", "/api/themes", {
    body: { code: "T1", title: "X" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "Klaida: Tema su tokiu kodu jau egzistuoja" });
});







// -----------------------------------------------------------
// no edit routes for codes and titles
// -----------------------------------------------------------
//
// Themes and subtheme structure is created and deleted,
// never edited in place: no page ever edited it, and the two
// edit routes stored whatever they were sent. Both are gone
// — a PATCH on a theme or on a subtheme itself finds no
// route, and nothing touches the database.
// -----------------------------------------------------------

test("PATCH /:id and PATCH /subthemes/:id no longer exist: 404, no query", async () => {
  manager();
  for (const url of ["/api/themes/5", "/api/themes/subthemes/10"]) {
    const res = await api(app.base, "PATCH", url, { body: { code: "6.9.", title: "X" }, headers: asRole("Vadybininkas") });
    assert.equal(res.status, 404, url);
  }
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// create subtheme
// -----------------------------------------------------------
//
// The 400 message; INSERT params pin trimming and the
// null description default.
// -----------------------------------------------------------

test("POST /:themeId/subthemes: 400 missing; 201 with description defaulting to null", async () => {
  manager();
  let res = await api(app.base, "POST", "/api/themes/1/subthemes", {
    body: { code: "T1.1" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Potemės kodas ir pavadinimas yra privalomi" });

  onQuery(/INSERT INTO subthemes \(theme_id, code, title, description\)/, (sql, params) => [
    { id: 10, theme_id: 1, code: params[1], title: params[2], description: params[3], cap: null },
  ]);
  res = await api(app.base, "POST", "/api/themes/1/subthemes", {
    body: { code: " T1.1 ", title: " Potemė " },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(queryLog()[0].params, ["1", "T1.1", "Potemė", null]);
});







// -----------------------------------------------------------
// delete subtheme
// -----------------------------------------------------------
//
// 204 on a hit, 404 when nothing matched.
// -----------------------------------------------------------

test("DELETE /subthemes/:id: 204 / 404", async () => {
  manager();
  onQuery(/DELETE FROM subthemes WHERE id = \$1/, { rowCount: 1 });
  let res = await api(app.base, "DELETE", "/api/themes/subthemes/10", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 204);

  resetDb();
  onQuery(/DELETE FROM subthemes WHERE id = \$1/, { rowCount: 0 });
  res = await api(app.base, "DELETE", "/api/themes/subthemes/10", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);
});







// -----------------------------------------------------------
// delete subtheme — linked activities refuse
// -----------------------------------------------------------
//
// A subtheme that activities still use cannot go: like the
// theme delete, the manager gets a 409 that says why, not a
// bare 500. The fake database knows both ways the route might
// find out — a pre-check over activities answers that a row
// exists, and the DELETE itself fails on the foreign key the
// way Postgres would.
// -----------------------------------------------------------

test("DELETE /subthemes/:id: linked activities → 409 with a reason, not 500", async () => {
  manager();
  onQuery(/FROM activities/, [{ "?column?": 1 }]);
  onQuery(/DELETE FROM subthemes WHERE id = \$1/, () => {
    throw Object.assign(
      new Error('update or delete on table "subthemes" violates foreign key constraint "activities_subtheme_id_fkey" on table "activities"'),
      { code: "23503" }
    );
  });

  const res = await api(app.base, "DELETE", "/api/themes/subthemes/10", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 409);
  assert.equal(typeof res.body?.error, "string");
  assert.notEqual(res.body.error, "internal error");
});







// -----------------------------------------------------------
// cap validation
// -----------------------------------------------------------
//
// Loops the three 'missing' shapes and both 'not a
// number' shapes; then 0 saves — a legal cap.
// -----------------------------------------------------------

test("PATCH cap: empty, negative and non-numeric all → 400; zero is allowed", async () => {
  committee();

  for (const cap of [undefined, null, ""]) {
    const res = await api(app.base, "PATCH", "/api/themes/subthemes/10/cap", {
      body: { cap },
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "Klaida: Limito reikšmė privaloma." });
  }

  for (const cap of [-1, "abc"]) {
    const res = await api(app.base, "PATCH", "/api/themes/subthemes/10/cap", {
      body: { cap },
      headers: asRole("Komisijos narys"),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "Klaida: Limitas turi būti teigiamas skaičius." });
  }

  onQuery(/UPDATE subthemes SET cap = \$1 WHERE id = \$2/, (sql, params) => [
    { id: 10, theme_id: 1, code: "T1.1", title: "P", description: null, cap: params[0] },
  ]);
  const res = await api(app.base, "PATCH", "/api/themes/subthemes/10/cap", {
    body: { cap: 0 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.cap, 0);
});







// -----------------------------------------------------------
// total-sum validation
// -----------------------------------------------------------
//
// A negative sum rejected with its own message; the 404
// body is the bare lowercase 'not found'.
// -----------------------------------------------------------

test("PATCH total-sum: validates like cap; 404 says lowercase 'not found'", async () => {
  committee();
  let res = await api(app.base, "PATCH", "/api/themes/1/total-sum", {
    body: { total_sum: -5 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Bendra suma turi būti teigiamas skaičius." });

  onQuery(/UPDATE themes SET total_sum = \$1 WHERE id = \$2/, { rowCount: 0 });
  res = await api(app.base, "PATCH", "/api/themes/404/total-sum", {
    body: { total_sum: 100 },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "not found" });
});







// -----------------------------------------------------------
// pointvalue coercion
// -----------------------------------------------------------
//
// '2.50' passes Number() and is bound as 2.5 — string
// input from the frontend pinned.
// -----------------------------------------------------------

test("PATCH pointvalue: numeric strings pass (Number coercion); stored as a number", async () => {
  committee();
  onQuery(/UPDATE themes SET pointvalue = \$1 WHERE id = \$2/, (sql, params) => [
    { id: 1, code: "T1", title: "Tema", total_sum: 100, pointvalue: params[0] },
  ]);

  const res = await api(app.base, "PATCH", "/api/themes/1/pointvalue", {
    body: { pointvalue: "2.50" },
    headers: asRole("Komisijos narys"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(queryLog()[0].params, [2.5, "1"]);
});







// -----------------------------------------------------------
// delete theme — linked activities refuse
// -----------------------------------------------------------
//
// A theme with activities still attached refuses with a 409
// and NOTHING is deleted.
// -----------------------------------------------------------

test("DELETE /:id: linked activities → 409, no deletes at all", async () => {
  manager();
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, [{ "?column?": 1 }]);

  const res = await api(app.base, "DELETE", "/api/themes/1", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, {
    error: "Klaida: negalima ištrinti temos, nes yra su ja susietų veiklų.",
  });
  assert.equal(queryLog().some((q) => q.sql.includes("DELETE")), false);
});







// -----------------------------------------------------------
// delete theme — cascade order
// -----------------------------------------------------------
//
// With no linked activities: the query log pins the
// linked-check, then BEGIN → subthemes → theme → COMMIT in
// one transaction; 204 on success.
// -----------------------------------------------------------

test("DELETE /:id: subthemes first, then the theme, in a transaction → 204", async () => {
  manager();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 3 });
  onQuery(/DELETE FROM themes WHERE id = \$1/, { rowCount: 1 });

  const res = await api(app.base, "DELETE", "/api/themes/1", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 204);
  assert.deepEqual(
    queryLog().map((q) => q.sql.split(" ").slice(0, 3).join(" ")),
    ["SELECT 1 FROM", "BEGIN", "DELETE FROM subthemes", "DELETE FROM themes", "COMMIT"]
  );
});







// -----------------------------------------------------------
// delete theme — missing theme rolls back
// -----------------------------------------------------------
//
// The theme is missing → 404; the subtheme DELETE that ran
// first inside the transaction is rolled back, so nothing
// sticks.
// -----------------------------------------------------------

test("DELETE /:id on a missing theme: 404 and ROLLBACK, no COMMIT", async () => {
  manager();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 0 });
  onQuery(/DELETE FROM themes WHERE id = \$1/, { rowCount: 0 });

  const res = await api(app.base, "DELETE", "/api/themes/404", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);
  const sqls = queryLog().map((q) => q.sql);
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.ok(!sqls.includes("COMMIT"));
});







// -----------------------------------------------------------
// delete theme — failure mid-cascade rolls back
// -----------------------------------------------------------
//
// The theme DELETE throws after the subtheme DELETE ran:
// the transaction is rolled back (the subthemes survive) and
// the catch-all answers 500.
// -----------------------------------------------------------

test("DELETE /:id: a failure between the two DELETEs → ROLLBACK and 500", async () => {
  manager();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 2 });
  onQuery(/DELETE FROM themes WHERE id = \$1/, () => {
    throw new Error("db down");
  });

  const res = await api(app.base, "DELETE", "/api/themes/1", { headers: asRole("Vadybininkas") });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "internal error" });
  const sqls = queryLog().map((q) => q.sql);
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.ok(!sqls.includes("COMMIT"));
});







// -----------------------------------------------------------
// delete theme — an activity added after the check
// -----------------------------------------------------------
//
// The linked-activities check runs before the transaction,
// so an activity created in between makes a DELETE meet the
// foreign key instead. That is the check's own refusal: the
// same 409 with its reason and a rollback, not a 500.
// -----------------------------------------------------------

test("DELETE /:id: an activity added after the check → 409 and ROLLBACK, not 500", async () => {
  manager();
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, () => {
    throw Object.assign(new Error('update or delete on table "subthemes" violates foreign key constraint'), { code: "23503" });
  });

  const res = await api(app.base, "DELETE", "/api/themes/1", { headers: asRole("Vadybininkas") });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "Klaida: negalima ištrinti temos, nes yra su ja susietų veiklų." });
  const sqls = queryLog().map((q) => q.sql);
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.ok(!sqls.includes("COMMIT"));
});







// -----------------------------------------------------------
// droppingClient
// -----------------------------------------------------------
//
// A pool client whose connection dies at the first statement
// matching failAt, reported the way pg reports it: the
// statement fails, and before the failure reaches the caller
// the client emits the same error as an 'error' event — on a
// client nobody listens to, Node's EventEmitter throws it.
// From then on every statement fails, as on a pg client that
// is no longer queryable. Statements before the drop go to
// the fake database, scripted and logged as usual.
//
// Used by:
//   - the BUG pin on the theme delete losing its connection
//     (below)
// -----------------------------------------------------------

function droppingClient(failAt) {
  const client = new EventEmitter();
  let dropped = false;

  client.query = (sql, params) => {
    if (dropped) return Promise.reject(new Error("Client has encountered a connection error and is not queryable"));
    if (!failAt.test(String(sql).replace(/\s+/g, " ").trim())) return pool.query(sql, params);

    // The rejection reaches the caller only after this
    // callback returns, so the 'error' event comes first —
    // the order pg uses
    dropped = true;
    const err = new Error("Connection terminated unexpectedly");
    return new Promise((_resolve, reject) => {
      setImmediate(() => {
        reject(err);
        client.emit("error", err);
      });
    });
  };
  client.release = () => {};
  return client;
}







// -----------------------------------------------------------
// BUG — the connection drops during a theme delete
// -----------------------------------------------------------
//
// The theme delete runs its transaction on a client of its
// own, taken from the pool. While a client is checked out the
// pool stops listening for its errors, and the route adds no
// listener of its own, so when the database goes away
// mid-transaction pg's 'error' event on that client has
// nobody to hear it: Node's EventEmitter throws it outside
// the request, and the whole backend process ends. The delete
// must fail like any other database error — a 500, and
// nothing thrown. The fake client drops its connection at the
// theme DELETE, and a plain query of that statement fails the
// same way; the test holds the process's uncaughtException
// listeners while the request runs, so an escaping error is
// caught and asserted on here instead of reaching the test
// runner.
// -----------------------------------------------------------

test(
  "BUG: DELETE /:id: the connection drops mid-transaction → 500, nothing thrown outside the request",
  {
    todo: "known bug: DELETE /api/themes/:id runs its transaction on a pool.connect() client with no 'error' listener — when the connection drops, pg emits 'error' on that client, the EventEmitter throws it as an uncaught exception and the process ends",
    timeout: 10_000,
  },
  async () => {
    manager();
    onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
    onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
    onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 2 });
    onQuery(/DELETE FROM themes WHERE id = \$1/, () => {
      throw new Error("Connection terminated unexpectedly");
    });

    const realConnect = pool.connect;
    pool.connect = async () => droppingClient(/^DELETE FROM themes/);

    const runnerListeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    const escaped = [];
    process.on("uncaughtException", (err) => escaped.push(String(err)));

    let res;
    try {
      res = await fetch(`${app.base}/api/themes/1`, {
        method: "DELETE",
        headers: asRole("Vadybininkas"),
        signal: AbortSignal.timeout(3000),
      }).catch((err) => err);
    } finally {
      process.removeAllListeners("uncaughtException");
      for (const listener of runnerListeners) process.on("uncaughtException", listener);
      pool.connect = realConnect;
    }

    assert.deepEqual(escaped, [], "nothing may be thrown outside the request");
    assert.equal(res.status, 500);
  }
);







// -----------------------------------------------------------
// ids Postgres cannot take
// -----------------------------------------------------------
//
// Postgres refuses an :id or :themeId of "abc" or "1.5" as
// invalid integer syntax and 2147483648 as out of range for
// int4, which would surface as a 500 with a stack trace in
// the log. Such an id names nothing: a 404 or a 400, without
// a query, is the answer. The fake database fails exactly
// where Postgres would.
// -----------------------------------------------------------

test("a theme or subtheme id that is not an int4 → 404 or 400, never 500", async () => {
  const int4 = (value) => {
    const text = String(value);
    if (!/^-?\d+$/.test(text)) {
      throw Object.assign(new Error(`invalid input syntax for type integer: "${text}"`), { code: "22P02" });
    }
    if (Math.abs(Number(text)) > 2147483647) {
      throw Object.assign(new Error(`value "${text}" is out of range for type integer`), { code: "22003" });
    }
  };
  const idAt = (index) => (sql, params) => {
    int4(params[index]);
    return [];
  };

  for (const c of [
    { who: committee, role: "Komisijos narys", method: "PATCH", url: "/api/themes/abc/total-sum", body: { total_sum: 100 }, sql: /^UPDATE themes SET total_sum/, at: 1 },
    { who: committee, role: "Komisijos narys", method: "PATCH", url: "/api/themes/subthemes/1.5/cap", body: { cap: 1 }, sql: /^UPDATE subthemes SET cap/, at: 1 },
    { who: manager, role: "Vadybininkas", method: "DELETE", url: "/api/themes/2147483648", sql: /^SELECT 1 FROM activities WHERE theme_id = \$1/, at: 0 },
    { who: manager, role: "Vadybininkas", method: "DELETE", url: "/api/themes/subthemes/abc", sql: /^DELETE FROM subthemes WHERE id = \$1/, at: 0 },
    { who: manager, role: "Vadybininkas", method: "POST", url: "/api/themes/abc/subthemes", body: { code: "9.1.", title: "Potemė" }, sql: /^INSERT INTO subthemes/, at: 0 },
  ]) {
    resetDb();
    c.who();
    onQuery(c.sql, idAt(c.at));
    const res = await api(app.base, c.method, c.url, { body: c.body, headers: asRole(c.role) });
    assert.ok(res.status === 404 || res.status === 400, `${c.method} ${c.url} answered ${res.status}`);
  }
});







// -----------------------------------------------------------
// create — codes and titles that are not text
// -----------------------------------------------------------
//
// Code and title are judged after trimming, so a code of
// spaces is refused rather than stored as an empty one — the
// themes page enables its button on the untrimmed input, so
// that is one stray space away. A number, an array or an
// object is refused too instead of reaching .trim(). Either
// way it is the usual 400, with nothing inserted.
// -----------------------------------------------------------

test("create theme/subtheme: a blank or non-string code or title → 400, nothing inserted", async () => {
  for (const url of ["/api/themes", "/api/themes/1/subthemes"]) {
    for (const body of [
      { code: "   ", title: "Tema" },
      { code: "9.", title: " \t " },
      { code: 5, title: "Tema" },
      { code: ["9."], title: "Tema" },
      { code: "9.", title: { lt: "Tema" } },
    ]) {
      resetDb();
      manager();
      onQuery(/^INSERT INTO (themes|subthemes)/, (sql, params) => [{ id: 9, code: "?", title: "?" }]);
      const res = await api(app.base, "POST", url, { body, headers: asRole("Vadybininkas") });
      assert.equal(res.status, 400, `${url} ${JSON.stringify(body)} answered ${res.status}`);
      assert.equal(queryLog().some((q) => q.sql.startsWith("INSERT")), false, `${url} ${JSON.stringify(body)} inserted`);
    }
  }
});







// -----------------------------------------------------------
// create subtheme — the theme is gone
// -----------------------------------------------------------
//
// A theme deleted in another tab leaves its "Pridėti potemę"
// form behind; the INSERT then fails on the themes foreign
// key. A theme that does not exist is a 404, not a 500. The
// fake database answers both ways the route might find out:
// a lookup finds no theme, and the INSERT fails like Postgres
// would.
// -----------------------------------------------------------

test("POST /:themeId/subthemes for a theme that is gone → 404, not 500", async () => {
  manager();
  onQuery(/FROM themes WHERE id = \$1/, []);
  onQuery(/^INSERT INTO subthemes/, () => {
    throw Object.assign(
      new Error('insert or update on table "subthemes" violates foreign key constraint "subthemes_theme_id_fkey"'),
      { code: "23503" }
    );
  });

  const res = await api(app.base, "POST", "/api/themes/99/subthemes", {
    body: { code: "9.1.", title: "Potemė" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);
});







// -----------------------------------------------------------
// refusedLikePostgres
// -----------------------------------------------------------
//
// Wraps a fake INSERT handler so the statement fails where
// Postgres would fail on the text it is given: a NUL
// character in any text parameter is refused as an invalid
// byte sequence (SQLSTATE 22021), and a code whose entry in
// its unique index would pass the btree limit of 2704 bytes
// fails as a program limit exceeded (54000) — the fake counts
// the code's bytes, as for text that does not compress.
// Anything else gets the handler's own answer.
//
// Used by:
//   - the BUG pins on creating themes and subthemes (below)
// -----------------------------------------------------------

function refusedLikePostgres(codeAt, indexName, answer) {
  return (sql, params) => {
    if (params.some((p) => typeof p === "string" && p.includes("\u0000"))) {
      throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
    }
    const size = Buffer.byteLength(String(params[codeAt]));
    if (size > 2704) {
      throw Object.assign(
        new Error(`index row size ${size} exceeds btree version 4 maximum 2704 for index "${indexName}"`),
        { code: "54000" }
      );
    }
    return answer(sql, params);
  };
}







// -----------------------------------------------------------
// BUG — a theme code too long for its unique index
// -----------------------------------------------------------
//
// Theme codes are unique, so every code is also an entry in a
// btree index, and an entry cannot pass the btree limit of
// 2704 bytes. A longer code fails the INSERT with Postgres's
// program-limit error; the route checks only that the code is
// not blank and maps only the duplicate-code error, so the
// manager gets a 500. A code that long is bad input — the
// usual 400 that says so.
// -----------------------------------------------------------

test(
  "BUG: POST /: a code too long for the unique index → 400, not 500",
  { todo: "known bug: POST /api/themes checks the code only for blankness — a code past the btree entry limit fails the INSERT with SQLSTATE 54000 (index row size exceeds btree version 4 maximum 2704), which is not mapped and answers 500" },
  async () => {
    manager();
    onQuery(/^INSERT INTO themes/, refusedLikePostgres(0, "themes_code_key", (sql, params) => [
      { id: 9, code: params[0], title: params[1] },
    ]));

    // Random hex characters barely compress, so the index
    // entry is as long as the code
    const res = await api(app.base, "POST", "/api/themes", {
      body: { code: randomBytes(3000).toString("hex"), title: "Tema" },
      headers: asRole("Vadybininkas"),
    });
    assert.equal(res.status, 400);
  }
);







// -----------------------------------------------------------
// BUG — a subtheme code too long for its unique index
// -----------------------------------------------------------
//
// A subtheme code is unique within its theme, so it is an
// entry in a btree index too and meets the same limit: a code
// past it fails the INSERT with the program-limit error, and
// the route, which maps only a duplicate code and a missing
// theme, answers 500. It must be the usual 400.
// -----------------------------------------------------------

test(
  "BUG: POST /:themeId/subthemes: a code too long for the unique index → 400, not 500",
  { todo: "known bug: POST /api/themes/:themeId/subthemes checks the code only for blankness — a code past the btree entry limit fails the INSERT with SQLSTATE 54000, which is not mapped (only 23505 and 23503 are) and answers 500" },
  async () => {
    manager();
    onQuery(/^INSERT INTO subthemes/, refusedLikePostgres(1, "subthemes_theme_id_code_key", (sql, params) => [
      { id: 10, theme_id: 1, code: params[1], title: params[2], description: params[3], cap: null },
    ]));

    const res = await api(app.base, "POST", "/api/themes/1/subthemes", {
      body: { code: randomBytes(3000).toString("hex"), title: "Potemė" },
      headers: asRole("Vadybininkas"),
    });
    assert.equal(res.status, 400);
  }
);







// -----------------------------------------------------------
// BUG — a NUL character in a theme's code or title
// -----------------------------------------------------------
//
// Postgres refuses text that holds a NUL character, and the
// code and title reach the INSERT as sent once trimmed, so
// either one with a NUL in it fails the statement and the
// manager gets a 500. Such text is bad input — the usual
// 400.
// -----------------------------------------------------------

test(
  "BUG: POST /: a NUL character in the code or the title → 400, not 500",
  { todo: "known bug: POST /api/themes binds code and title as sent — Postgres refuses U+0000 in text with SQLSTATE 22021 (invalid byte sequence for encoding \"UTF8\": 0x00), which is not mapped and answers 500" },
  async () => {
    for (const body of [
      { code: "9.\u0000", title: "Tema" },
      { code: "9.", title: "Te\u0000ma" },
    ]) {
      resetDb();
      manager();
      onQuery(/^INSERT INTO themes/, refusedLikePostgres(0, "themes_code_key", (sql, params) => [
        { id: 9, code: params[0], title: params[1] },
      ]));
      const res = await api(app.base, "POST", "/api/themes", { body, headers: asRole("Vadybininkas") });
      assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
    }
  }
);







// -----------------------------------------------------------
// BUG — a NUL character in a subtheme's text
// -----------------------------------------------------------
//
// The same refusal on the subtheme create, which sends the
// code, the title and the description to Postgres as they
// came: a NUL character in any of the three fails the INSERT
// and answers 500 instead of the usual 400.
// -----------------------------------------------------------

test(
  "BUG: POST /:themeId/subthemes: a NUL character in the code, title or description → 400, not 500",
  { todo: "known bug: POST /api/themes/:themeId/subthemes binds code, title and description as sent — Postgres refuses U+0000 in text with SQLSTATE 22021, which is not mapped and answers 500" },
  async () => {
    for (const body of [
      { code: "9.1.\u0000", title: "Potemė" },
      { code: "9.1.", title: "Pote\u0000mė" },
      { code: "9.1.", title: "Potemė", description: "Apra\u0000šymas" },
    ]) {
      resetDb();
      manager();
      onQuery(/^INSERT INTO subthemes/, refusedLikePostgres(1, "subthemes_theme_id_code_key", (sql, params) => [
        { id: 10, theme_id: 1, code: params[1], title: params[2], description: params[3], cap: null },
      ]));
      const res = await api(app.base, "POST", "/api/themes/1/subthemes", { body, headers: asRole("Vadybininkas") });
      assert.equal(res.status, 400, `${JSON.stringify(body)} answered ${res.status}`);
    }
  }
);







// -----------------------------------------------------------
// BUG — a subtheme description that is not text
// -----------------------------------------------------------
//
// The description is optional, and whatever arrives in it is
// inserted as it is: a number, a boolean, an array or an
// object is turned into text by the driver and stored with a
// 201. Like an activity's description it must be text or
// absent — anything else is the usual 400 with nothing
// inserted, while a missing or null description and a string
// keep their 201.
// -----------------------------------------------------------

test(
  "BUG: POST /:themeId/subthemes: a description that is not a string → 400, nothing inserted",
  { todo: "known bug: POST /api/themes/:themeId/subthemes binds description ?? null unchecked — 5, true, [\"a\"] and {lt:\"x\"} are stored as text and answered 201" },
  async () => {
    const inserted = (sql, params) => [
      { id: 10, theme_id: 1, code: params[1], title: params[2], description: params[3], cap: null },
    ];

    for (const description of [5, true, ["a"], { lt: "x" }]) {
      resetDb();
      manager();
      onQuery(/^INSERT INTO subthemes/, inserted);
      const res = await api(app.base, "POST", "/api/themes/1/subthemes", {
        body: { code: "9.1.", title: "Potemė", description },
        headers: asRole("Vadybininkas"),
      });
      assert.equal(res.status, 400, `${JSON.stringify(description)} answered ${res.status}`);
      assert.equal(queryLog().some((q) => q.sql.startsWith("INSERT")), false, `${JSON.stringify(description)} was inserted`);
    }

    for (const description of [undefined, null, "Aprašymas"]) {
      resetDb();
      manager();
      onQuery(/^INSERT INTO subthemes/, inserted);
      const res = await api(app.base, "POST", "/api/themes/1/subthemes", {
        body: { code: "9.1.", title: "Potemė", description },
        headers: asRole("Vadybininkas"),
      });
      assert.equal(res.status, 201, `${JSON.stringify(description)} answered ${res.status}`);
    }
  }
);







// -----------------------------------------------------------
// committee numbers — values that are not numbers
// -----------------------------------------------------------
//
// Number() would turn a blank string, a boolean, an array
// and a hex string into a valid-looking amount: " " saved as
// 0, true as 1, [7] as 7 and "0x1F4" as 500. Only a number,
// or a string spelling a decimal number, passes for cap,
// total sum and point value; anything else is a 400 with
// nothing written.
// -----------------------------------------------------------

test("cap, total sum and point value: blank strings, booleans, arrays and hex strings → 400, no UPDATE", async () => {
  for (const [url, field] of [
    ["/api/themes/subthemes/10/cap", "cap"],
    ["/api/themes/1/total-sum", "total_sum"],
    ["/api/themes/1/pointvalue", "pointvalue"],
  ]) {
    for (const value of [" ", true, [], [7], "0x1F4"]) {
      resetDb();
      committee();
      onQuery(/^UPDATE (subthemes|themes) SET/, (sql, params) => [{ id: 1, [field]: params[0] }]);
      const res = await api(app.base, "PATCH", url, { body: { [field]: value }, headers: asRole("Komisijos narys") });
      assert.equal(res.status, 400, `${field} ${JSON.stringify(value)} answered ${res.status}`);
      assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE")), false, `${field} ${JSON.stringify(value)} was saved`);
    }
  }
});







// -----------------------------------------------------------
// BUG — committee numbers too large to be finite
// -----------------------------------------------------------
//
// A decimal written out in a string passes numberOf, but a
// string of hundreds of digits converts to Infinity, which is
// not negative — so cap, total sum and point value all store
// it, the NUMERIC columns accepting Infinity, and every sum
// and point value computed from it is wrecked. It must be the
// usual 400, with nothing written.
// -----------------------------------------------------------

test(
  "BUG: cap, total sum and point value: a decimal string too large to be finite → 400, no UPDATE",
  { todo: "known bug: numberOf turns a decimal string of 400 nines into Infinity, which passes the routes' only check (num < 0), so the UPDATE stores NUMERIC 'Infinity' and answers 200" },
  async () => {
    for (const [url, field] of [
      ["/api/themes/subthemes/10/cap", "cap"],
      ["/api/themes/1/total-sum", "total_sum"],
      ["/api/themes/1/pointvalue", "pointvalue"],
    ]) {
      resetDb();
      committee();
      onQuery(/^UPDATE (subthemes|themes) SET/, (sql, params) => [{ id: 1, [field]: params[0] }]);
      const res = await api(app.base, "PATCH", url, { body: { [field]: "9".repeat(400) }, headers: asRole("Komisijos narys") });
      assert.equal(res.status, 400, `${field} answered ${res.status}`);
      assert.equal(queryLog().some((q) => q.sql.startsWith("UPDATE")), false, `${field} was saved`);
    }
  }
);
