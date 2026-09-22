// -----------------------------------------------------------
//  [*] Regression — routes /api/roles
//
//  Mounted exactly like index.js does — behind the mocked
//  verifySamlSession + attachRoles (as `pre`) — with the
//  real authorize(["Vadybininkas"]) guard in the router: a
//  signed-in non-manager gets a 403 on every route. Nothing
//  in the frontend calls these routes; the pins keep the
//  dormant behavior from drifting.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


let app;

before(async () => {
  // Imported DYNAMICALLY so these resolve to the MOCKS
  // authMock registered — passed as `pre` middleware to
  // mirror the index.js mount
  const { verifySamlSession } = await import("../src/auth/verifySamlSession.js");
  const { attachRoles } = await import("../src/auth/attachRoles.js");

  app = await startRouter(
    "/api/roles",
    new URL("../src/routes/roles.js", import.meta.url).href,
    [verifySamlSession, attachRoles]
  );
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});


// A signed-in manager — authorize() checks OWNED roles only
const manager = () => signInAs("u1", ["Vadybininkas"]);







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
// non-manager → 403
// -----------------------------------------------------------
//
// A signed-in employee trying to grant themselves
// Vadybininkas (their own oid comes from /api/me) is
// refused by authorize on both routes, before any query —
// the privilege escalation this router used to allow.
// -----------------------------------------------------------

test("a signed-in non-manager gets authorize's 403 on every route, no queries", async () => {
  signInAs("nobody-special", ["Darbuotojas"]);

  const grant = await api(app.base, "POST", "/api/roles/assign", {
    body: { user_oid: "nobody-special", role_name: "Vadybininkas" },
  });
  assert.equal(grant.status, 403);
  assert.deepEqual(grant.body, { error: "Forbidden: insufficient role" });

  const list = await api(app.base, "GET", "/api/roles");
  assert.equal(list.status, 403);
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// GET — catalog
// -----------------------------------------------------------
//
// One scripted SELECT ordered by name, passed straight
// through.
// -----------------------------------------------------------

test("GET /: returns the catalog alphabetically", async () => {
  manager();
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
  manager();
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
  manager();
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
  manager();
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







// -----------------------------------------------------------
// DB failure — both routes answer 500
// -----------------------------------------------------------
//
// A throwing query on the catalog read or on the role
// lookup of assign → a prompt 500 internal error, no
// hanging request.
// -----------------------------------------------------------

test("GET / and assign: DB failure → 500 internal error", async () => {
  manager();
  onQuery(/FROM roles/, () => {
    throw new Error("db down");
  });

  const list = await api(app.base, "GET", "/api/roles");
  assert.equal(list.status, 500);
  assert.deepEqual(list.body, { error: "internal error" });

  const assign = await api(app.base, "POST", "/api/roles/assign", {
    body: { user_oid: "target-oid", role_name: "Vadybininkas" },
  });
  assert.equal(assign.status, 500);
  assert.deepEqual(assign.body, { error: "internal error" });
});
