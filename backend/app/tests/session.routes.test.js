// -----------------------------------------------------------
//  [*] Regression — routes /api/session
//
//  The router has one route, GET /check: the SPA's "am I
//  signed in" probe. The user upsert and Darbuotojas
//  auto-grant live in the SAML /assert callback
//  (routes/saml.js).
//
//  verifySamlSession/attachRoles are mocked
//  (helpers/authMock.js).
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signInAs, signOut } from "./helpers/authMock.js";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


let app;

before(async () => {
  app = await startRouter(
    "/api/session",
    new URL("../src/routes/session.js", import.meta.url).href
  );
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});







// -----------------------------------------------------------
// check — anonymous
// -----------------------------------------------------------
//
// No SAML session → the middleware's Neprisijungta 401,
// before any DB work.
// -----------------------------------------------------------

test("check: 401 Neprisijungta without a session", async () => {
  const res = await api(app.base, "GET", "/api/session/check");
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "Neprisijungta" });
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// check — signed in
// -----------------------------------------------------------
//
// The user row is re-read from the DB by the session's eid,
// and the roles (from attachRoles) come back as { name }
// objects — the shape App.jsx expects.
// -----------------------------------------------------------

test("check: returns the DB user row plus roles as { name } objects", async () => {
  signInAs("eid-1", ["Darbuotojas", "Vadybininkas"], { email: "j@vu.lt", name: "Jonas" });
  onQuery(/SELECT eid, email, full_name, created_at, last_login_at FROM users WHERE eid = \$1/, [
    { eid: "eid-1", email: "j@vu.lt", full_name: "Jonas Jonaitis" },
  ]);

  const res = await api(app.base, "GET", "/api/session/check");
  assert.equal(res.status, 200);
  assert.equal(res.body.user.eid, "eid-1");
  assert.deepEqual(res.body.roles, [{ name: "Darbuotojas" }, { name: "Vadybininkas" }]);
  assert.deepEqual(queryLog()[0].params, ["eid-1"]);
});







// -----------------------------------------------------------
// check — user missing from the DB
// -----------------------------------------------------------
//
// A session for an eid the users table doesn't know (e.g.
// wiped DB) still answers 200 — user comes back undefined,
// not an error.
// -----------------------------------------------------------

test("check: unknown eid → 200 with user undefined", async () => {
  signInAs("ghost-eid", ["Darbuotojas"]);
  onQuery(/FROM users WHERE eid = \$1/, []);

  const res = await api(app.base, "GET", "/api/session/check");
  assert.equal(res.status, 200);
  assert.equal(res.body.user, undefined);
  assert.deepEqual(res.body.roles, [{ name: "Darbuotojas" }]);
});







// -----------------------------------------------------------
// check — DB failure
// -----------------------------------------------------------
//
// The query throws → the catch-all 500.
// -----------------------------------------------------------

test("check: DB failure → 500 internal error", async () => {
  signInAs("eid-1", []);
  onQuery(/FROM users WHERE eid = \$1/, () => {
    throw new Error("db down");
  });

  const res = await api(app.base, "GET", "/api/session/check");
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "internal error" });
});
