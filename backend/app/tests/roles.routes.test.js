// -----------------------------------------------------------
//  [*] Regression — routes /api/roles
//
//  Guarded per route by verifySamlSession alone (mocked
//  here): any
//  signed-in user passes, no role check. Nothing in the
//  frontend calls these routes; the pins keep the dormant
//  behavior from drifting.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


let app;

before(async () => {
  app = await startRouter("/api/roles", new URL("../src/routes/roles.js", import.meta.url).href);
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});







// -----------------------------------------------------------
// anonymous → 401
// -----------------------------------------------------------
//
// Neither route answers without a Bearer token (the
// mocked verifySamlSession with no identity set).
// -----------------------------------------------------------

test("both routes 401 without a token", async () => {
  assert.equal((await api(app.base, "GET", "/api/roles")).status, 401);
  assert.equal((await api(app.base, "POST", "/api/roles/assign", { body: {} })).status, 401);
});







// -----------------------------------------------------------
// assign without any role
// -----------------------------------------------------------
//
// A signed-in nobody grants a role successfully —
// pinned evidence that this router has no role guard.
// -----------------------------------------------------------

test("any signed-in user may assign roles — no role check (pinned as shipped)", async () => {
  signInAs("nobody-special", []);
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 7 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/roles/assign", {
    body: { user_oid: "u1", role_name: "Vadybininkas" },
  });
  assert.equal(res.status, 204);
});







// -----------------------------------------------------------
// GET — catalog
// -----------------------------------------------------------
//
// One scripted SELECT ordered by name, passed straight
// through.
// -----------------------------------------------------------

test("GET /: returns the catalog alphabetically", async () => {
  signInAs("u1", []);
  onQuery(/SELECT id, name, description FROM roles ORDER BY name/, [
    { id: 1, name: "Darbuotojas", description: null },
    { id: 2, name: "Vadybininkas", description: null },
  ]);

  const res = await api(app.base, "GET", "/api/roles");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.name), ["Darbuotojas", "Vadybininkas"]);
});







// -----------------------------------------------------------
// assign — validation
// -----------------------------------------------------------
//
// role omitted → 400 before any lookup.
// -----------------------------------------------------------

test("assign: missing fields → 400", async () => {
  signInAs("u1", []);
  const res = await api(app.base, "POST", "/api/roles/assign", { body: { user_oid: "u1" } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Vartotojo OID ir rolė yra privalomi" });
});







// -----------------------------------------------------------
// assign — unknown role
// -----------------------------------------------------------
//
// The role lookup returns no rows → 404 Rolė nerasta.
// -----------------------------------------------------------

test("assign: unknown role name → 404", async () => {
  signInAs("u1", []);
  onQuery(/SELECT id FROM roles WHERE name = \$1/, []);

  const res = await api(app.base, "POST", "/api/roles/assign", {
    body: { user_oid: "u1", role_name: "Nėra tokios" },
  });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: Rolė nerasta" });
});







// -----------------------------------------------------------
// assign — grant
// -----------------------------------------------------------
//
// The role resolves to id 7; the INSERT's ON CONFLICT
// clause and bound params are pinned; 204, no body.
// -----------------------------------------------------------

test("assign: grants by (oid, role id), re-grant is a DB-side no-op → 204 either way", async () => {
  signInAs("u1", []);
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 7 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 0 });

  const res = await api(app.base, "POST", "/api/roles/assign", {
    body: { user_oid: "target-oid", role_name: "Vadybininkas" },
  });
  assert.equal(res.status, 204);

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.ok(insert.sql.includes("ON CONFLICT DO NOTHING"));
  assert.deepEqual(insert.params, ["target-oid", 7]);
});
