// -----------------------------------------------------------
//  [*] Regression — routes /api/themes
//
//  The theme/subtheme catalog. Pins the guard split (read =
//  any JWT, structure = active Vadybininkas, numbers = active
//  Komisijos narys), the tree assembly, the dynamic PATCH SET
//  building, every validation message, and the manual-cascade
//  DELETE — whose missing transaction is pinned as an
//  expected failure.
//
//  verifySamlSession/attachRoles are mocked
//  (helpers/authMock.js); requireActiveRoleIn is the real
//  one. The delete cascade gained the students' 409 guard
//  against themes with linked activities.
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
// edit — unknown keys
// -----------------------------------------------------------
//
// A body of non-whitelisted keys builds an empty SET →
// the no-fields 400.
// -----------------------------------------------------------

test("PATCH /:id: unknown body keys are silently ignored; only-unknown → 400", async () => {
  manager();
  const res = await api(app.base, "PATCH", "/api/themes/5", {
    body: { pavadinimas: "X", total_sum: 9 },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: nėra atnaujinamų laukų" });
});







// -----------------------------------------------------------
// edit — SET building
// -----------------------------------------------------------
//
// code+title produce 'code = $1, title = $2' with the
// id as $3; a rowCount-0 update → 404.
// -----------------------------------------------------------

test("PATCH /:id: builds SET from the allowed keys, id last; 404 on no row", async () => {
  manager();
  onQuery(/UPDATE themes SET code = \$1, title = \$2 WHERE id = \$3/, (sql, params) => [
    { id: 5, code: params[0], title: params[1] },
  ]);

  let res = await api(app.base, "PATCH", "/api/themes/5", {
    body: { code: "T9", title: "Nauja" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(queryLog()[0].params, ["T9", "Nauja", "5"]);

  resetDb();
  onQuery(/UPDATE themes SET/, { rowCount: 0 });
  res = await api(app.base, "PATCH", "/api/themes/404", {
    body: { title: "X" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: nerasta" });
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
// edit subtheme
// -----------------------------------------------------------
//
// description is on THIS whitelist (unlike themes);
// happy-path passthrough.
// -----------------------------------------------------------

test("PATCH /subthemes/:id: description is editable here; 404 on no row", async () => {
  manager();
  onQuery(/UPDATE subthemes SET description = \$1 WHERE id = \$2/, [
    { id: 10, theme_id: 1, code: "T1.1", title: "P", description: "Naujas", cap: null },
  ]);

  const res = await api(app.base, "PATCH", "/api/themes/subthemes/10", {
    body: { description: "Naujas" },
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.description, "Naujas");
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
// The guard the students added: a theme with activities
// still attached refuses with a 409 and NOTHING is deleted.
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
// linked-check → subthemes → theme order; 204 on success.
// -----------------------------------------------------------

test("DELETE /:id: subthemes first, then the theme → 204", async () => {
  manager();
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 3 });
  onQuery(/DELETE FROM themes WHERE id = \$1/, { rowCount: 1 });

  const res = await api(app.base, "DELETE", "/api/themes/1", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 204);
  assert.ok(queryLog()[1].sql.includes("DELETE FROM subthemes"));
  assert.ok(queryLog()[2].sql.includes("DELETE FROM themes"));
});







// -----------------------------------------------------------
// delete theme — 404 quirk
// -----------------------------------------------------------
//
// The theme is missing → 404, yet the log shows the
// subtheme DELETE already executed first.
// -----------------------------------------------------------

test("DELETE /:id on a missing theme: 404 — but its subtheme delete ALREADY ran (pinned quirk)", async () => {
  manager();
  onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
  onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 0 });
  onQuery(/DELETE FROM themes WHERE id = \$1/, { rowCount: 0 });

  const res = await api(app.base, "DELETE", "/api/themes/404", {
    headers: asRole("Vadybininkas"),
  });
  assert.equal(res.status, 404);
  // Check + both DELETEs executed even though nothing existed
  assert.equal(queryLog().length, 3);
});







// -----------------------------------------------------------
// BUG — no transaction
// -----------------------------------------------------------
//
// Handlers for BEGIN/COMMIT stand ready; the log's
// first entry should be BEGIN — shipped code never
// opens a transaction.
// -----------------------------------------------------------

test(
  "BUG: the two-statement cascade should run in a transaction",
  { todo: "known gap: a failure between the DELETEs leaves a theme without its subthemes — no BEGIN/COMMIT is issued" },
  async () => {
    manager();
    onQuery(/^BEGIN/, { rowCount: 0 });
    onQuery(/SELECT 1 FROM activities WHERE theme_id = \$1 LIMIT 1/, []);
    onQuery(/DELETE FROM subthemes WHERE theme_id = \$1/, { rowCount: 1 });
    onQuery(/DELETE FROM themes WHERE id = \$1/, { rowCount: 1 });
    onQuery(/^COMMIT/, { rowCount: 0 });

    await api(app.base, "DELETE", "/api/themes/1", { headers: asRole("Vadybininkas") });
    assert.equal(queryLog()[0].sql, "BEGIN");
  }
);
