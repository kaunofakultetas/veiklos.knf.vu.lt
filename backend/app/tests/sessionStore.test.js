// -----------------------------------------------------------
//  [*] Regression — db/sessionStore.js
//
//  The Postgres session store against the fake pool: the SQL
//  and parameters of get/set/touch/destroy, expired rows
//  filtered on read, the expiry derived from the cookie, the
//  login lookup single logout relies on (both keys, every
//  shape, nothing to search by → no query), errors handed to
//  the callback, and the sweep that logs a failure once.
// -----------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import { pool } from "../src/db/pool.js";
import { PgSessionStore, expiryOf, loginKeys, DEFAULT_TTL_MS } from "../src/db/sessionStore.js";


// A store with the sweep timer off — the tests call prune()
const store = () => new PgSessionStore({ pool, pruneIntervalMs: false });

// Callback → promise, the way express-session drives the store
const call = (fn) => new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

beforeEach(() => resetDb());







// -----------------------------------------------------------
// expiry
// -----------------------------------------------------------
//
// The cookie's expires wins (an ISO string after the JSON
// round trip, or a Date); otherwise now + maxAge; otherwise
// now + 8 hours.
// -----------------------------------------------------------

test("expiryOf: cookie.expires, then maxAge, then the 8-hour default", () => {
  const now = Date.parse("2026-09-25T10:00:00.000Z");
  assert.equal(expiryOf({ cookie: { expires: "2026-09-25T18:00:00.000Z" } }, now).toISOString(), "2026-09-25T18:00:00.000Z");
  assert.equal(expiryOf({ cookie: { expires: new Date("2026-09-25T12:00:00.000Z") } }, now).toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal(expiryOf({ cookie: { expires: "not a date", maxAge: 60_000 } }, now).toISOString(), "2026-09-25T10:01:00.000Z");
  assert.equal(expiryOf({ cookie: { originalMaxAge: 120_000 } }, now).toISOString(), "2026-09-25T10:02:00.000Z");
  assert.equal(expiryOf({}, now).getTime(), now + DEFAULT_TTL_MS);
  assert.equal(expiryOf(undefined, now).getTime(), now + DEFAULT_TTL_MS);
});







// -----------------------------------------------------------
// get / set / touch / destroy
// -----------------------------------------------------------
//
// The SQL express-session's four calls turn into: an upsert
// on set with the expiry as the third parameter, a read that
// ignores expired rows and answers null for none, a touch
// that only moves the expiry, a delete. Pool errors reach the
// callback.
// -----------------------------------------------------------

test("set upserts (sid, sess, expire); get reads live rows only; touch moves the expiry; destroy deletes", async () => {
  const s = store();
  const sess = { cookie: { expires: "2026-09-25T18:00:00.000Z", maxAge: 100 }, samlUser: { nameID: "n1", sessionIndex: "s1" } };
  onQuery(/INSERT INTO session/, { rowCount: 1 });
  onQuery(/SELECT sess FROM session WHERE sid = \$1 AND expire > NOW\(\)/, (_sql, params) => (params[0] === "sid-1" ? [{ sess }] : []));
  onQuery(/UPDATE session SET expire = \$2 WHERE sid = \$1/, { rowCount: 1 });
  onQuery(/DELETE FROM session WHERE sid = \$1/, { rowCount: 1 });

  await call((cb) => s.set("sid-1", sess, cb));
  const insert = queryLog()[0];
  assert.match(insert.sql, /^INSERT INTO session \(sid, sess, expire\) VALUES \(\$1, \$2, \$3\) ON CONFLICT \(sid\) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire$/);
  assert.equal(insert.params[0], "sid-1");
  assert.deepEqual(insert.params[1], sess);
  assert.equal(insert.params[2].toISOString(), "2026-09-25T18:00:00.000Z");

  assert.deepEqual(await call((cb) => s.get("sid-1", cb)), sess);
  assert.equal(await call((cb) => s.get("sid-unknown", cb)), null);

  await call((cb) => s.touch("sid-1", sess, cb));
  const touch = queryLog().find((q) => q.sql.startsWith("UPDATE session"));
  assert.deepEqual([touch.params[0], touch.params[1].toISOString()], ["sid-1", "2026-09-25T18:00:00.000Z"]);

  await call((cb) => s.destroy("sid-1", cb));
  assert.deepEqual(queryLog().at(-1), { sql: "DELETE FROM session WHERE sid = $1", params: ["sid-1"] });
});

test("a failing pool reaches the callback as the error", async () => {
  const s = store();
  onQuery(/SELECT sess FROM session/, () => { throw new Error("connection refused"); });
  await assert.rejects(() => call((cb) => s.get("sid-1", cb)), /connection refused/);
});







// -----------------------------------------------------------
// the login lookup
// -----------------------------------------------------------
//
// sidsForLogin searches live rows by the stored samlUser's
// sessionIndex OR nameID — either key alone finds the
// session, every shape samlify uses normalises to the same
// strings, and a lookup with nothing to search by runs no
// query at all.
// -----------------------------------------------------------

test("loginKeys: strings, samlify's object, arrays; empties are null", () => {
  assert.deepEqual(loginKeys({ sessionIndex: "s1", nameID: "n1" }), { sessionIndex: "s1", nameID: "n1" });
  assert.deepEqual(loginKeys({ sessionIndex: { sessionIndex: "s1", authnContextClassRef: "urn:x" }, nameID: ["n1", "n2"] }), { sessionIndex: "s1", nameID: "n1" });
  assert.deepEqual(loginKeys({ sessionIndex: ["s1"], nameID: "" }), { sessionIndex: "s1", nameID: null });
  assert.deepEqual(loginKeys({}), { sessionIndex: null, nameID: null });
  assert.deepEqual(loginKeys(undefined), { sessionIndex: null, nameID: null });
});

test("sidsForLogin: one query with both keys, live rows only; nothing to search by → no query", async () => {
  const s = store();
  onQuery(/SELECT sid FROM session WHERE expire > NOW\(\) AND \(sess->'samlUser'->>'sessionIndex' = \$1 OR sess->'samlUser'->>'nameID' = \$2\)/, [{ sid: "sid-a" }, { sid: "sid-b" }]);

  assert.deepEqual(await s.sidsForLogin({ sessionIndex: { sessionIndex: "s1" }, nameID: "n1" }), ["sid-a", "sid-b"]);
  assert.deepEqual(queryLog()[0].params, ["s1", "n1"]);

  assert.deepEqual(await s.sidsForLogin({ nameID: "n1" }), ["sid-a", "sid-b"]);
  assert.deepEqual(queryLog()[1].params, [null, "n1"]);

  assert.deepEqual(await s.sidsForLogin({}), []);
  assert.deepEqual(await s.sidsForLogin({ sessionIndex: "", nameID: [] }), []);
  assert.equal(queryLog().length, 2, "no query without a key");
});







// -----------------------------------------------------------
// the sweep
// -----------------------------------------------------------
//
// prune() deletes expired rows; a failure is logged once and
// never thrown, and a later success re-arms the message. The
// constructor starts no timer when told not to.
// -----------------------------------------------------------

test("prune deletes expired rows; a failure is logged once and re-armed by a success", async () => {
  const s = store();
  assert.equal(s.timer, null);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    let fail = true;
    onQuery(/DELETE FROM session WHERE expire < NOW\(\)/, () => { if (fail) throw new Error("db down"); return { rowCount: 3 }; });
    await s.prune();
    await s.prune();
    assert.deepEqual(logged, ["session store: sweep failed: db down"]);
    fail = false;
    await s.prune();
    fail = true;
    await s.prune();
    assert.equal(logged.length, 2, "logged again after a success in between");
  } finally {
    console.error = original;
  }
  assert.equal(queryLog().filter((q) => q.sql.startsWith("DELETE FROM session WHERE expire")).length, 4);
});
