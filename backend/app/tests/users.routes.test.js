// -----------------------------------------------------------
//  [*] Regression — routes /api/users
//
//  Mounted exactly like index.js does — behind the mocked
//  verifySamlSession + attachRoles (as `pre`) — with the
//  real authorize(["Vadybininkas"]) guard in the router:
//  anonymous 401, non-manager 403. Listing every user's eid,
//  email and name is manager business only. Nothing in the
//  frontend calls this route; the pins keep the dormant
//  behavior from drifting.
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
    "/api/users",
    new URL("../src/routes/users.js", import.meta.url).href,
    [verifySamlSession, attachRoles]
  );
});

after(() => app.close());

beforeEach(() => {
  resetDb();
  signOut();
});


// A signed-in manager — authorize() checks OWNED roles only
const manager = () => signInAs("mgr-1", ["Vadybininkas"]);







// -----------------------------------------------------------
// gates — anonymous and non-manager
// -----------------------------------------------------------
//
// No session → 401 from the session middleware; a signed-in
// employee → authorize's 403 — and in neither case is the
// users table touched.
// -----------------------------------------------------------

test("GET /: anonymous → 401, plain employee → 403, no query either way", async () => {
  const anon = await api(app.base, "GET", "/api/users");
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.body, { error: "Neprisijungta" });

  signInAs("emp-1", ["Darbuotojas", "Komisijos narys"]);
  const emp = await api(app.base, "GET", "/api/users");
  assert.equal(emp.status, 403);
  assert.deepEqual(emp.body, { error: "Forbidden: insufficient role" });

  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// GET — table dump
// -----------------------------------------------------------
//
// One scripted SELECT over the real columns (eid, no serial
// id; ORDER BY created_at DESC pinned in the matcher) passed
// straight through as JSON.
// -----------------------------------------------------------

test("GET /: a manager gets the users table, newest first", async () => {
  manager();
  onQuery(/SELECT eid, email, full_name, created_at FROM users ORDER BY created_at DESC/, [
    { eid: "o2", email: "b@x", full_name: "B", created_at: "2026-01-02" },
    { eid: "o1", email: "a@x", full_name: "A", created_at: "2026-01-01" },
  ]);

  const res = await api(app.base, "GET", "/api/users");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].email, "b@x");
});







// -----------------------------------------------------------
// GET — DB failure
// -----------------------------------------------------------
//
// The scripted query throws → a prompt 500 internal error,
// no hanging request.
// -----------------------------------------------------------

test("GET /: DB failure → 500 internal error", async () => {
  manager();
  onQuery(/FROM users/, () => {
    throw new Error("db down");
  });

  const res = await api(app.base, "GET", "/api/users");
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "internal error" });
});







// -----------------------------------------------------------
// POST — gone
// -----------------------------------------------------------
//
// There is no create route: users are born in the SAML
// /assert upsert only. The path falls through to the 404.
// -----------------------------------------------------------

test("POST /: no such route → 404", async () => {
  manager();
  const res = await api(app.base, "POST", "/api/users", { body: { email: "c@x", full_name: "C" } });
  assert.equal(res.status, 404);
});
