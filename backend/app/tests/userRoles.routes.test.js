// -----------------------------------------------------------
//  [*] Regression — routes /api/user-roles
//
//  The role admin API behind manager/roles.jsx. The old
//  no-auth hole is FIXED since the Keycloak/SAML migration:
//  index.js mounts the router behind verifySamlSession +
//  attachRoles, and every route adds authorize(
//  ["Vadybininkas"]) — role OWNERSHIP, no X-Active-Role
//  header involved. The tests mount it exactly like index.js
//  does (mocked session middlewares as `pre`), with the real
//  authorize in the router.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


let app;

before(async () => {
  // Imported DYNAMICALLY so these resolve to the MOCKS
  // authMock registered (a static import would link to the
  // real modules before the mocks exist) — passed as `pre`
  // middleware to mirror the index.js mount
  const { verifySamlSession } = await import("../src/auth/verifySamlSession.js");
  const { attachRoles } = await import("../src/auth/attachRoles.js");

  app = await startRouter(
    "/api/user-roles",
    new URL("../src/routes/userRoles.js", import.meta.url).href,
    [verifySamlSession, attachRoles]
  );
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});







// -----------------------------------------------------------
// stubUserLookup
// -----------------------------------------------------------
//
// The email→oid lookup every handler starts with.
//
// Used by:
//   - most tests in this file
// -----------------------------------------------------------

function stubUserLookup(row) {
  onQuery(/SELECT oid AS id.* FROM users WHERE LOWER\(email\) = LOWER\(\$1\)/, row ? [row] : []);
}


// A signed-in manager — authorize() checks OWNED roles only
const manager = () => signInAs("mgr-1", ["Vadybininkas"]);







// -----------------------------------------------------------
// gates — anonymous
// -----------------------------------------------------------
//
// Anonymous → 401 from the session middleware on all three
// routes. This is the students' fix for the hole the old
// suite pinned as an expected failure.
// -----------------------------------------------------------

test("anonymous callers are rejected on every route", async () => {
  for (const [method, path] of [
    ["GET", "/api/user-roles?email=a@x"],
    ["POST", "/api/user-roles/assign"],
    ["POST", "/api/user-roles/remove"],
  ]) {
    const res = await api(app.base, method, path, method === "POST" ? { body: {} } : {});
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: "Neprisijungta" });
  }
});







// -----------------------------------------------------------
// gates — non-manager
// -----------------------------------------------------------
//
// Signed in but without the Vadybininkas role → authorize's
// flat 403 on all three routes.
// -----------------------------------------------------------

test("a signed-in non-manager gets authorize's 403 on every route", async () => {
  signInAs("emp-1", ["Darbuotojas"]);

  for (const [method, path] of [
    ["GET", "/api/user-roles?email=a@x"],
    ["POST", "/api/user-roles/assign"],
    ["POST", "/api/user-roles/remove"],
  ]) {
    const res = await api(app.base, method, path, method === "POST" ? { body: {} } : {});
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: "Forbidden: insufficient role" });
  }
});







// -----------------------------------------------------------
// gates — owned role
// -----------------------------------------------------------
//
// authorize() checks role OWNERSHIP — a manager passes with
// no X-Active-Role header at all (unlike the other routers).
// -----------------------------------------------------------

test("OWNING Vadybininkas is enough — no X-Active-Role header needed (pinned)", async () => {
  manager();
  stubUserLookup({ id: "oid-1", email: "a@x", full_name: "A" });
  onQuery(/SELECT name FROM roles ORDER BY name ASC/, [{ name: "Darbuotojas" }]);
  onQuery(/SELECT r\.name FROM user_roles ur/, []);

  const res = await api(app.base, "GET", "/api/user-roles?email=a@x");
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// GET — validation
// -----------------------------------------------------------
//
// No ?email → 400 with the shared (mismatched) message.
// -----------------------------------------------------------

test("GET: missing email → 400", async () => {
  manager();
  const res = await api(app.base, "GET", "/api/user-roles");
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });
});







// -----------------------------------------------------------
// GET — unknown user
// -----------------------------------------------------------
//
// An empty lookup → the lowercase 'vartotojas nerastas' 404.
// -----------------------------------------------------------

test("GET: unknown user → 404", async () => {
  manager();
  stubUserLookup(null);
  const res = await api(app.base, "GET", "/api/user-roles?email=niekas@x");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: vartotojas nerastas" });
});







// -----------------------------------------------------------
// GET — the full shape
// -----------------------------------------------------------
//
// User row + catalog + owned roles combined into one body;
// the trim-in-JS / LOWER-in-SQL split pinned via the bound
// param.
// -----------------------------------------------------------

test("GET: returns { user, roles, allRoles }; lookup is case-insensitive in SQL", async () => {
  manager();
  stubUserLookup({ id: "oid-1", email: "a@x", full_name: "A" });
  onQuery(/SELECT name FROM roles ORDER BY name ASC/, [
    { name: "Darbuotojas" },
    { name: "Vadybininkas" },
  ]);
  onQuery(/SELECT r\.name FROM user_roles ur/, [{ name: "Darbuotojas" }]);

  const res = await api(app.base, "GET", "/api/user-roles?email=%20A@X%20");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    user: { id: "oid-1", email: "a@x", full_name: "A" },
    roles: ["Darbuotojas"],
    allRoles: ["Darbuotojas", "Vadybininkas"],
  });

  const lookup = queryLog()[0];
  assert.ok(lookup.sql.includes("LOWER(email) = LOWER($1)"));
  assert.deepEqual(lookup.params, ["A@X"]);
});







// -----------------------------------------------------------
// assign — validation
// -----------------------------------------------------------
//
// role omitted → 400 before any lookup.
// -----------------------------------------------------------

test("assign: missing fields → 400", async () => {
  manager();
  const res = await api(app.base, "POST", "/api/user-roles/assign", { body: { email: "a@x" } });
  assert.equal(res.status, 400);
});







// -----------------------------------------------------------
// assign — unknown user / role
// -----------------------------------------------------------
//
// A user miss → 404 but a role miss → 400 — two different
// statuses for the two lookups, pinned.
// -----------------------------------------------------------

test("assign: unknown user → 404, unknown role → 400", async () => {
  manager();
  stubUserLookup(null);
  let res = await api(app.base, "POST", "/api/user-roles/assign", {
    body: { email: "niekas@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: Vartotojas nerastas" });

  resetDb();
  stubUserLookup({ id: "oid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, []);
  res = await api(app.base, "POST", "/api/user-roles/assign", {
    body: { email: "a@x", role: "Nėra tokios" },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: nežinoma rolė" });
});







// -----------------------------------------------------------
// assign — grant
// -----------------------------------------------------------
//
// ON CONFLICT insert by (oid, role id) with the params
// pinned; 204.
// -----------------------------------------------------------

test("assign: grants by (oid, role id) with ON CONFLICT → 204", async () => {
  manager();
  stubUserLookup({ id: "oid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 2 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/user-roles/assign", {
    body: { email: "a@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 204);

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.ok(insert.sql.includes("ON CONFLICT DO NOTHING"));
  assert.deepEqual(insert.params, ["oid-1", 2]);
});







// -----------------------------------------------------------
// remove — unknown role
// -----------------------------------------------------------
//
// A role miss short-circuits to 204, and the query log proves
// NO DELETE was ever sent.
// -----------------------------------------------------------

test("remove: unknown role name is treated as already removed — 204, NO delete", async () => {
  manager();
  stubUserLookup({ id: "oid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, []);

  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "a@x", role: "Nėra tokios" },
  });
  assert.equal(res.status, 204);
  assert.equal(queryLog().some((q) => q.sql.includes("DELETE")), false);
});







// -----------------------------------------------------------
// remove — revoke
// -----------------------------------------------------------
//
// DELETE by (oid, role id) with the params pinned; 204.
// -----------------------------------------------------------

test("remove: revokes by (oid, role id) → 204", async () => {
  manager();
  stubUserLookup({ id: "oid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 2 }]);
  onQuery(/DELETE FROM user_roles WHERE user_oid = \$1 AND role_id = \$2/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "a@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 204);

  const del = queryLog().find((q) => q.sql.includes("DELETE FROM user_roles"));
  assert.deepEqual(del.params, ["oid-1", 2]);
});







// -----------------------------------------------------------
// remove — unknown user
// -----------------------------------------------------------
//
// A user miss → 404 before the role is even looked up.
// -----------------------------------------------------------

test("remove: unknown user → 404", async () => {
  manager();
  stubUserLookup(null);
  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "niekas@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 404);
});
