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
//  verifySamlSession/attachRoles are mocked
//  (helpers/authMock.js); requireActiveRoleIn is the real
//  one.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


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
