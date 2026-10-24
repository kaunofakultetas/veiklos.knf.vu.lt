// -----------------------------------------------------------
//  [*] Regression — routes /api/user-roles
//
//  The role admin API behind manager/roles.jsx:
//  index.js mounts the router behind verifySamlSession +
//  attachRoles, and the router adds authorize(
//  ["Vadybininkas"]) once for every route — role OWNERSHIP,
//  no X-Active-Role header involved. The tests mount it
//  exactly like index.js does (mocked session middlewares as
//  `pre`), with the real authorize in the router.
//
//  The Vadybininkas role never loses its last holder.
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
// The email→eid lookup every handler starts with.
//
// Used by:
//   - most tests in this file
// -----------------------------------------------------------

function stubUserLookup(row) {
  onQuery(/SELECT eid AS id.* FROM users WHERE email = \$1/, row ? [row] : []);
}


// The one catalog + ownership query GET / runs after the
// user lookup: rows of { name, owned }
function stubCatalog(rows) {
  onQuery(/SELECT r\.name, ur\.user_eid IS NOT NULL AS owned FROM roles r LEFT JOIN user_roles ur/, rows);
}


// A signed-in manager — authorize() checks OWNED roles only
const manager = () => signInAs("mgr-1", ["Vadybininkas"]);







// -----------------------------------------------------------
// gates — anonymous
// -----------------------------------------------------------
//
// Anonymous → 401 from the session middleware on all three
// routes.
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
  stubUserLookup({ id: "eid-1", email: "a@x", full_name: "A" });
  stubCatalog([{ name: "Darbuotojas", owned: false }]);

  const res = await api(app.base, "GET", "/api/user-roles?email=a@x");
  assert.equal(res.status, 200);
});







// -----------------------------------------------------------
// GET — validation
// -----------------------------------------------------------
//
// No ?email (or a blank one) → 400 naming just the email.
// -----------------------------------------------------------

test("GET: missing email → 400", async () => {
  manager();
  for (const path of ["/api/user-roles", "/api/user-roles?email=%20%20"]) {
    const res = await api(app.base, "GET", path);
    assert.equal(res.status, 400, path);
    assert.deepEqual(res.body, { error: "Klaida: Vartotojo el. paštas yra privalomas" });
  }
});







// -----------------------------------------------------------
// GET — unknown user
// -----------------------------------------------------------
//
// An empty lookup → the same 'Vartotojas nerastas' 404 every
// route uses.
// -----------------------------------------------------------

test("GET: unknown user → 404", async () => {
  manager();
  stubUserLookup(null);
  const res = await api(app.base, "GET", "/api/user-roles?email=niekas@x");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "Klaida: Vartotojas nerastas" });
});







// -----------------------------------------------------------
// GET — the full shape
// -----------------------------------------------------------
//
// User row + catalog + owned roles combined into one body,
// from two queries: the user lookup (the typed address
// trimmed and lowercased in JS, then compared plainly — the
// spelling sign-in stores — pinned via the bound param) and
// one LEFT JOIN keyed by the user's eid that yields catalog
// and ownership together.
// -----------------------------------------------------------

test("GET: returns { user, roles, allRoles } from the lookup + one catalog query", async () => {
  manager();
  stubUserLookup({ id: "eid-1", email: "a@x", full_name: "A" });
  stubCatalog([
    { name: "Darbuotojas", owned: true },
    { name: "Komisijos narys", owned: false },
    { name: "Vadybininkas", owned: false },
  ]);

  const res = await api(app.base, "GET", "/api/user-roles?email=%20A@X%20");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    user: { id: "eid-1", email: "a@x", full_name: "A" },
    roles: ["Darbuotojas"],
    allRoles: ["Darbuotojas", "Komisijos narys", "Vadybininkas"],
  });

  assert.equal(queryLog().length, 2);
  const [lookup, catalog] = queryLog();
  assert.ok(lookup.sql.includes("WHERE email = $1"));
  assert.deepEqual(lookup.params, ["a@x"]);
  assert.deepEqual(catalog.params, ["eid-1"]);
});







// -----------------------------------------------------------
// assign — validation
// -----------------------------------------------------------
//
// role omitted, or blank after trimming → 400 before any
// lookup.
// -----------------------------------------------------------

test("assign: missing or blank fields → 400, no lookup", async () => {
  manager();
  for (const body of [{ email: "a@x" }, { email: "  ", role: "Vadybininkas" }, { email: "a@x", role: " " }]) {
    const res = await api(app.base, "POST", "/api/user-roles/assign", { body });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });
  }
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// GET /, assign and remove — a NUL in the email
// -----------------------------------------------------------
//
// An email holding the NUL character makes Postgres refuse
// the lookup; each route answers 400 as bad input.
// -----------------------------------------------------------

test(
  "GET /, assign and remove: an email with a NUL character → 400, not 500",
  async () => {
    // Postgres refuses NUL in text as an invalid byte
    // sequence, SQLSTATE 22021
    const refusingNul = (answer) => (sql, params = []) => {
      if (params.some((p) => typeof p === "string" && p.includes("\u0000"))) {
        throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: "22021" });
      }
      return answer;
    };

    manager();
    onQuery(/SELECT eid AS id.* FROM users WHERE email = \$1/, refusingNul([{ id: "eid-1", email: "a@x", full_name: "A" }]));
    onQuery(/SELECT r\.name, ur\.user_eid IS NOT NULL AS owned FROM roles r LEFT JOIN user_roles ur/, refusingNul([{ name: "Darbuotojas", owned: true }]));
    onQuery(/SELECT id FROM roles WHERE name = \$1/, refusingNul([{ id: 2 }]));
    onQuery(/^(INSERT INTO|DELETE FROM) user_roles/, refusingNul({ rowCount: 1 }));

    let res = await api(app.base, "GET", "/api/user-roles?email=a%00%40x");
    assert.equal(res.status, 400, `GET answered ${res.status}`);

    for (const path of ["/api/user-roles/assign", "/api/user-roles/remove"]) {
      res = await api(app.base, "POST", path, { body: { email: "a\u0000@x", role: "Vadybininkas" } });
      assert.equal(res.status, 400, `${path} answered ${res.status}`);
    }
  }
);







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
  stubUserLookup({ id: "eid-1" });
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
// ON CONFLICT insert by (eid, role id) with the params
// pinned; 204. Email and role arrive trimmed at the lookups,
// the email lowercased too.
// -----------------------------------------------------------

test("assign: grants by (eid, role id) with ON CONFLICT → 204; inputs trimmed, the email lowercased", async () => {
  manager();
  stubUserLookup({ id: "eid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 2 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/user-roles/assign", {
    body: { email: " A@X ", role: " Vadybininkas " },
  });
  assert.equal(res.status, 204);

  const [lookup, role, insert] = queryLog();
  assert.deepEqual(lookup.params, ["a@x"]);
  assert.deepEqual(role.params, ["Vadybininkas"]);
  assert.ok(insert.sql.includes("ON CONFLICT DO NOTHING"));
  assert.deepEqual(insert.params, ["eid-1", 2]);
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
  stubUserLookup({ id: "eid-1" });
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
// DELETE by (eid, role id) with the params pinned; 204.
// -----------------------------------------------------------

test("remove: revokes by (eid, role id) → 204", async () => {
  manager();
  stubUserLookup({ id: "eid-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 2 }]);
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT user_eid FROM user_roles WHERE role_id = \$1 FOR UPDATE/, [{ user_eid: "eid-1" }, { user_eid: "mgr-1" }]);
  onQuery(/DELETE FROM user_roles WHERE user_eid = \$1 AND role_id = \$2/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "a@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 204);

  const del = queryLog().find((q) => q.sql.includes("DELETE FROM user_roles"));
  assert.deepEqual(del.params, ["eid-1", 2]);
  assert.equal(queryLog().at(-1).sql, "COMMIT");
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
  assert.deepEqual(res.body, { error: "Klaida: Vartotojas nerastas" });
});







// -----------------------------------------------------------
// remove — the base role
// -----------------------------------------------------------
//
// "Darbuotojas" is refused with a 400 before any lookup —
// attachRoles would re-grant it on the next request anyway.
// -----------------------------------------------------------

test("remove: Darbuotojas is refused → 400, no queries at all", async () => {
  manager();
  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "a@x", role: "Darbuotojas" },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "Klaida: rolė Darbuotojas yra bazinė ir nešalinama" });
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// remove — own manager role
// -----------------------------------------------------------
//
// A manager may revoke their OWN Vadybininkas role — the
// page confirms it first — as long as another manager holds
// it too (the last holder is refused, below).
// -----------------------------------------------------------

test("remove: a manager may revoke their own Vadybininkas role → 204", async () => {
  manager();
  stubUserLookup({ id: "mgr-1" });
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 2 }]);
  onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
  onQuery(/SELECT user_eid FROM user_roles WHERE role_id = \$1 FOR UPDATE/, [{ user_eid: "mgr-1" }, { user_eid: "mgr-2" }]);
  onQuery(/DELETE FROM user_roles WHERE user_eid = \$1 AND role_id = \$2/, { rowCount: 1 });

  const res = await api(app.base, "POST", "/api/user-roles/remove", {
    body: { email: "mgr@x", role: "Vadybininkas" },
  });
  assert.equal(res.status, 204);
  assert.deepEqual(queryLog().find((q) => q.sql.includes("DELETE FROM user_roles")).params, ["mgr-1", 2]);
});







// -----------------------------------------------------------
// remove — the last manager
// -----------------------------------------------------------
//
// Only a Vadybininkas administers roles, themes and reviews,
// so the role must never lose its last holder: revoking it
// from its only holder is refused with a 409 and the row
// kept. The holder rows are read FOR UPDATE inside the
// revoke's transaction, so the only two managers revoking
// each other at the same moment run one after the other and
// the second one finds a single holder left. The fake
// user_roles table keeps its rows, and the target is the
// role's only holder.
// -----------------------------------------------------------

test(
  "remove: revoking Vadybininkas from its only holder → 409, the role row kept",
  async () => {
    manager();

    // Darbuotojas is role 1 and Vadybininkas role 2; mgr-1
    // is the only holder of role 2
    const userRoles = [
      { user_eid: "mgr-1", role_id: 1 },
      { user_eid: "mgr-1", role_id: 2 },
      { user_eid: "emp-1", role_id: 1 },
    ];
    stubUserLookup({ id: "mgr-1", email: "mgr@x", full_name: "M" });
    onQuery(/SELECT id FROM roles WHERE name = \$1/, (sql, [name]) => (name === "Vadybininkas" ? [{ id: 2 }] : []));
    onQuery(/^(BEGIN|COMMIT|ROLLBACK)$/, { rowCount: 0 });
    onQuery(/^SELECT user_eid FROM user_roles WHERE role_id = \$1 FOR UPDATE$/, (sql, [roleId]) =>
      userRoles.filter((r) => r.role_id === roleId).map((r) => ({ user_eid: r.user_eid })));
    onQuery(/^DELETE FROM user_roles WHERE user_eid = \$1 AND role_id = \$2$/, (sql, [eid, roleId]) => {
      const kept = userRoles.filter((r) => !(r.user_eid === eid && r.role_id === roleId));
      const rowCount = userRoles.length - kept.length;
      userRoles.splice(0, userRoles.length, ...kept);
      return { rowCount };
    });

    const res = await api(app.base, "POST", "/api/user-roles/remove", {
      body: { email: "mgr@x", role: "Vadybininkas" },
    });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "Klaida: Paskutinio vadybininko pašalinti negalima" });
    assert.ok(userRoles.some((r) => r.user_eid === "mgr-1" && r.role_id === 2), "the only Vadybininkas row was deleted");
    const sqls = queryLog().map((q) => q.sql);
    assert.ok(sqls.indexOf("BEGIN") < sqls.findIndex((q) => q.endsWith("FOR UPDATE")), "the holders are read locked, inside the transaction");
    assert.equal(sqls.at(-1), "ROLLBACK");
  }
);
