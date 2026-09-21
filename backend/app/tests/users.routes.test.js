// -----------------------------------------------------------
//  [*] Regression — routes /api/users
//
//  The router is mounted here exactly as it exists: WITHOUT
//  auth of its own (index.js adds verifySamlSession at mount,
//  and no role check anywhere — that mount-level gap is
//  pinned in index/route docs, not testable in isolation).
//  Nothing in the frontend calls these routes; the pins keep
//  the dormant behavior from drifting.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDb, onQuery } from "./helpers/db.js";
import { startRouter, api } from "./helpers/http.js";


let app;

before(async () => {
  app = await startRouter("/api/users", new URL("../src/routes/users.js", import.meta.url).href);
});

after(() => app.close());

beforeEach(() => {
  resetDb();
});







// -----------------------------------------------------------
// GET — table dump
// -----------------------------------------------------------
//
// One scripted SELECT (ORDER BY id DESC pinned in the
// matcher) passed straight through as JSON.
// -----------------------------------------------------------

test("GET /: dumps the users table, newest first", async () => {
  onQuery(/SELECT id, email, full_name, created_at FROM users ORDER BY id DESC/, [
    { id: 2, email: "b@x", full_name: "B", created_at: "2026-01-02" },
    { id: 1, email: "a@x", full_name: "A", created_at: "2026-01-01" },
  ]);

  const res = await api(app.base, "GET", "/api/users");
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].email, "b@x");
});







// -----------------------------------------------------------
// BUG — hang on DB failure
// -----------------------------------------------------------
//
// The scripted query throws. Desired: a prompt 500.
// Shipped: no response ever — the fetch dies on its 1 s
// abort while the rejection goes unhandled.
// -----------------------------------------------------------

test(
  "BUG: GET / with a DB failure should answer 500 — instead the request HANGS",
  { todo: "known bug: the async handler has no try/catch; express 4 never sees the rejection, so no response is sent and node raises an unhandledRejection (same pattern in GET /api/roles)" },
  async () => {
    // Swallow the unhandledRejection the buggy handler emits,
    // so it can't take down the test process
    const swallow = () => {};
    process.on("unhandledRejection", swallow);

    try {
      onQuery(/FROM users/, () => {
        throw new Error("db down");
      });

      // Desired behavior: a prompt 500. Today the fetch aborts
      // on the 1 s timeout because nothing ever responds.
      const res = await fetch(app.base + "/api/users", { signal: AbortSignal.timeout(1000) });
      assert.equal(res.status, 500);
    } finally {
      setTimeout(() => process.removeListener("unhandledRejection", swallow), 200);
    }
  }
);







// -----------------------------------------------------------
// POST — validation
// -----------------------------------------------------------
//
// full_name omitted; the message text talks about rolė
// instead — pinned verbatim.
// -----------------------------------------------------------

test("POST /: missing fields → 400 with the shipped (mismatched) message", async () => {
  const res = await api(app.base, "POST", "/api/users", { body: { email: "a@x" } });
  assert.equal(res.status, 400);
  // The message talks about "rolė" though the missing field
  // is full_name — pinned as shipped
  assert.deepEqual(res.body, { error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });
});







// -----------------------------------------------------------
// POST — create
// -----------------------------------------------------------
//
// The INSERT echoes its params back; 201 with the row.
// No oid column exists on this path.
// -----------------------------------------------------------

test("POST /: creates a user (note: no oid — such users can never sign in)", async () => {
  onQuery(/INSERT INTO users \(email, full_name\)/, (sql, params) => [
    { id: 3, email: params[0], full_name: params[1], created_at: "2026-01-03" },
  ]);

  const res = await api(app.base, "POST", "/api/users", {
    body: { email: "c@x", full_name: "C" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 3);
  assert.equal(res.body.email, "c@x");
});







// -----------------------------------------------------------
// POST — duplicate email
// -----------------------------------------------------------
//
// The stub throws code 23505 → mapped to the 409 with
// the shipped message.
// -----------------------------------------------------------

test("POST /: duplicate email (23505) → 409", async () => {
  onQuery(/INSERT INTO users/, () => {
    const e = new Error("dup");
    e.code = "23505";
    throw e;
  });

  const res = await api(app.base, "POST", "/api/users", {
    body: { email: "c@x", full_name: "C" },
  });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "Klaida. Vartotojo el. paštas jau egzistuoja" });
});







// -----------------------------------------------------------
// POST — other DB error
// -----------------------------------------------------------
//
// Any non-23505 throw → the generic 500 internal
// error body.
// -----------------------------------------------------------

test("POST /: any other DB error → 500 internal error", async () => {
  onQuery(/INSERT INTO users/, () => {
    throw new Error("db down");
  });

  const res = await api(app.base, "POST", "/api/users", {
    body: { email: "c@x", full_name: "C" },
  });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "internal error" });
});
