// -----------------------------------------------------------
//  [*] Regression — auth middlewares (real implementations)
//
//  Unit-tests the four middlewares in src/auth/ with fake
//  req/res objects — no module mocks here, these are the real
//  functions. verifySamlSession is the session gate;
//  attachRoles runs against the fake pool.
// -----------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { verifySamlSession } from "../src/auth/verifySamlSession.js";
import { authorize } from "../src/auth/authorize.js";
import { requireActiveRoleIn } from "../src/auth/requireActiveRole.js";
import { attachRoles } from "../src/auth/attachRoles.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";







// -----------------------------------------------------------
// fakeRes
// -----------------------------------------------------------
//
// Minimal express-res stand-in: records status/json and
// resolves a promise when json() fires, so async middlewares
// (attachRoles' pool query) can be awaited.
//
// Used by:
//   - every test in this file
// -----------------------------------------------------------

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.done = new Promise((resolve) => {
    res.status = (c) => {
      res.statusCode = c;
      return res;
    };
    res.json = (b) => {
      res.body = b;
      resolve("json");
      return res;
    };
    res.resolveNext = () => resolve("next");
  });
  return res;
}


beforeEach(() => {
  resetDb();
});







// -----------------------------------------------------------
// verifySamlSession — no session
// -----------------------------------------------------------
//
// No session at all (and an empty one): the Lithuanian
// Neprisijungta 401, synchronously — the gate every guarded
// route now starts with.
// -----------------------------------------------------------

test("verifySamlSession: no session → 401 Neprisijungta", async () => {
  for (const req of [{}, { session: {} }]) {
    const res = fakeRes();
    verifySamlSession(req, res, () => res.resolveNext());
    assert.equal(await res.done, "json");
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "Neprisijungta" });
  }
});







// -----------------------------------------------------------
// verifySamlSession — attribute mapping
// -----------------------------------------------------------
//
// VU SSO's OID attributes (uid, mail, givenName, sn) become
// req.user; the name is the givenName/sn pair joined.
// -----------------------------------------------------------

test("verifySamlSession: maps VU SSO attributes onto req.user", async () => {
  const req = {
    session: {
      samlUser: {
        attributes: {
          eID: "112546",
          "urn:oid:0.9.2342.19200300.100.1.3": ["jonas.jonaitis@knf.vu.lt"],
          "urn:oid:2.5.4.42": "Jonas",
          "urn:oid:2.5.4.4": "Jonaitis",
        },
      },
    },
  };
  let called = false;

  verifySamlSession(req, fakeRes(), () => (called = true));

  assert.equal(called, true);
  assert.deepEqual(req.user, { eid: "112546", email: "jonas.jonaitis@knf.vu.lt", name: "Jonas Jonaitis" });
});







// -----------------------------------------------------------
// verifySamlSession — fallbacks
// -----------------------------------------------------------
//
// Friendly attribute names serve too, and a lone sn doesn't
// leave a stray space in the name.
// -----------------------------------------------------------

test("verifySamlSession: friendly names and partial names", async () => {
  const req = {
    session: {
      samlUser: {
        attributes: { eid: "300003", mail: "kitas@vu.lt", sn: "Kazlauskaitė" },
      },
    },
  };

  verifySamlSession(req, fakeRes(), () => {});

  assert.deepEqual(req.user, { eid: "300003", email: "kitas@vu.lt", name: "Kazlauskaitė" });
});







// -----------------------------------------------------------
// authorize — empty allow-list
// -----------------------------------------------------------
//
// authorize([]) is a no-op gate: next() without even
// reading the caller's roles.
// -----------------------------------------------------------

test("authorize: empty required list passes everyone", async () => {
  let called = false;
  authorize([])({ user: { roles: [] } }, fakeRes(), () => (called = true));
  assert.equal(called, true);
});







// -----------------------------------------------------------
// authorize — role owned
// -----------------------------------------------------------
//
// One of the caller's roles appears on the list —
// ownership alone passes, no active-role concept here.
// -----------------------------------------------------------

test("authorize: passes when ANY owned role is in the required list", async () => {
  let called = false;
  const req = { user: { roles: ["Darbuotojas", "Vadybininkas"] } };
  authorize(["Vadybininkas"])(req, fakeRes(), () => (called = true));
  assert.equal(called, true);
});







// -----------------------------------------------------------
// authorize — no matching role
// -----------------------------------------------------------
//
// Owned roles miss the allow-list → the flat English
// 403 body.
// -----------------------------------------------------------

test("authorize: 403 when no required role is owned", async () => {
  const res = fakeRes();
  authorize(["Vadybininkas"])({ user: { roles: ["Darbuotojas"] } }, res, () => res.resolveNext());
  assert.equal(await res.done, "json");
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden: insufficient role" });
});







// -----------------------------------------------------------
// requireActiveRoleIn — no header
// -----------------------------------------------------------
//
// Without X-Active-Role the guard 400s even for a
// caller who owns the required role.
// -----------------------------------------------------------

test("requireActiveRoleIn: missing header → 400", async () => {
  const res = fakeRes();
  const req = { get: () => undefined, user: { roles: ["Darbuotojas"] } };

  requireActiveRoleIn(["Darbuotojas"])(req, res, () => res.resolveNext());

  assert.equal(await res.done, "json");
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Active role header (X-Active-Role) is required" });
});







// -----------------------------------------------------------
// requireActiveRoleIn — role not owned
// -----------------------------------------------------------
//
// The header names a role the caller doesn't own →
// 403 before the allow-list is consulted.
// -----------------------------------------------------------

test("requireActiveRoleIn: active role not owned → 403", async () => {
  const res = fakeRes();
  const req = { get: () => "Vadybininkas", user: { roles: ["Darbuotojas"] } };

  requireActiveRoleIn(["Vadybininkas"])(req, res, () => res.resolveNext());

  assert.equal(await res.done, "json");
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden: you don't have the selected role" });
});







// -----------------------------------------------------------
// requireActiveRoleIn — role not allowed
// -----------------------------------------------------------
//
// The caller owns the active role, but the endpoint's
// allow-list doesn't include it → the third 403 body.
// -----------------------------------------------------------

test("requireActiveRoleIn: owned but not allowed for the endpoint → 403", async () => {
  const res = fakeRes();
  const req = { get: () => "Darbuotojas", user: { roles: ["Darbuotojas"] } };

  requireActiveRoleIn(["Vadybininkas"])(req, res, () => res.resolveNext());

  assert.equal(await res.done, "json");
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Forbidden: selected role not allowed for this endpoint" });
});







// -----------------------------------------------------------
// requireActiveRoleIn — success
// -----------------------------------------------------------
//
// Owned + allowed: next() runs and the chosen role
// lands on req.user.activeRole for the handler.
// -----------------------------------------------------------

test("requireActiveRoleIn: success exposes req.user.activeRole", async () => {
  const res = fakeRes();
  const req = { get: () => "Vadybininkas", user: { roles: ["Vadybininkas"] } };
  let called = false;

  requireActiveRoleIn(["Vadybininkas"])(req, res, () => (called = true));

  assert.equal(called, true);
  assert.equal(req.user.activeRole, "Vadybininkas");
});







// -----------------------------------------------------------
// requireActiveRoleIn — empty allow-list
// -----------------------------------------------------------
//
// required [] skips the allow-list check but still
// demands an OWNED active role in the header.
// -----------------------------------------------------------

test("requireActiveRoleIn: empty required list accepts any OWNED active role", async () => {
  const req = { get: () => "Darbuotojas", user: { roles: ["Darbuotojas"] } };
  let called = false;

  requireActiveRoleIn([])(req, res0(), () => (called = true));

  assert.equal(called, true);

  function res0() {
    return fakeRes();
  }
});







// -----------------------------------------------------------
// attachRoles — load + auto-grant
// -----------------------------------------------------------
//
// Three scripted queries: role lookup, the
// every-request ON CONFLICT grant (params pinned), and
// the name list landing on req.user.roles.
// -----------------------------------------------------------

test("attachRoles: loads role names and auto-grants Darbuotojas", async () => {
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 1 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 1 });
  onQuery(/SELECT r\.name FROM user_roles ur/, [{ name: "Darbuotojas" }, { name: "Vadybininkas" }]);

  const req = { user: { eid: "eid-1" } };
  let called = false;
  await attachRoles(req, fakeRes(), () => (called = true));

  assert.equal(called, true);
  assert.deepEqual(req.user.roles, ["Darbuotojas", "Vadybininkas"]);

  // The auto-grant INSERT runs on EVERY call (ON CONFLICT
  // makes it a no-op after the first) — pinned
  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.deepEqual(insert.params, ["eid-1", 1]);
});







// -----------------------------------------------------------
// attachRoles — sub fallback
// -----------------------------------------------------------
//
// No eid claim: the sub claim keys the grant instead —
// pinned via the INSERT's bound params.
// -----------------------------------------------------------

test("attachRoles: sub claim is the eid fallback", async () => {
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 1 }]);
  onQuery(/INSERT INTO user_roles/, { rowCount: 0 });
  onQuery(/SELECT r\.name FROM user_roles ur/, []);

  const req = { user: { sub: "sub-9" } };
  await attachRoles(req, fakeRes(), () => {});

  const insert = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.deepEqual(insert.params, ["sub-9", 1]);
});







// -----------------------------------------------------------
// attachRoles — anonymous claims
// -----------------------------------------------------------
//
// Neither claim present: roles [] with ZERO queries,
// and the request still continues.
// -----------------------------------------------------------

test("attachRoles: no eid/sub → roles [] and continues", async () => {
  const req = { user: {} };
  let called = false;
  await attachRoles(req, fakeRes(), () => (called = true));

  assert.equal(called, true);
  assert.deepEqual(req.user.roles, []);
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// attachRoles — broken catalog
// -----------------------------------------------------------
//
// The Darbuotojas row is gone: auto-grant silently
// skipped after a single query, roles [].
// -----------------------------------------------------------

test('attachRoles: "Darbuotojas" role missing from catalog → roles [] (auto-grant silently broken)', async () => {
  onQuery(/SELECT id FROM roles WHERE name = \$1/, []);

  const req = { user: { eid: "eid-1" } };
  let called = false;
  await attachRoles(req, fakeRes(), () => (called = true));

  assert.equal(called, true);
  assert.deepEqual(req.user.roles, []);
  assert.equal(queryLog().length, 1);
});







// -----------------------------------------------------------
// attachRoles — fail-open
// -----------------------------------------------------------
//
// The first query throws: the catch leaves roles []
// and STILL calls next() — rejecting is left to the
// guards downstream.
// -----------------------------------------------------------

test("attachRoles: DB failure fails OPEN — roles [], request continues", async () => {
  onQuery(/SELECT id FROM roles WHERE name = \$1/, () => {
    throw new Error("db down");
  });

  const req = { user: { eid: "eid-1" } };
  let called = false;
  await attachRoles(req, fakeRes(), () => (called = true));

  assert.equal(called, true);
  assert.deepEqual(req.user.roles, []);
});
