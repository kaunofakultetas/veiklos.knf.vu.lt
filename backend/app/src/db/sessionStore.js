// -----------------------------------------------------------
//  [*] DB — the Postgres session store
//
//  express-session's store backed by the `session` table
//  (postgres/init.sql): the id, the serialized session as
//  jsonb (the cookie and the SAML login, attributes included)
//  and when it ends. Sessions therefore survive a backend
//  restart or redeploy and are shared by every instance that
//  points at the same database. The same table answers the
//  one question single logout must ask WITHOUT a cookie —
//  which session belongs to the login the IdP names by
//  SessionIndex / NameID — by looking inside the stored
//  samlUser, so there is no separate index to keep in step.
//
//  Expired rows are ignored on read and swept every
//  PRUNE_INTERVAL_MS by a timer that never keeps the process
//  alive; a sweep that fails (the database is down) is
//  logged once, not every quarter hour. The expiry column is
//  timestamptz: the db container runs on the host's clock,
//  the backend on UTC, and an instant compares correctly
//  either way.
// -----------------------------------------------------------

import session from "express-session";







// -----------------------------------------------------------
// PRUNE_INTERVAL_MS
// -----------------------------------------------------------
//
// How often expired rows are deleted. Reads already ignore
// them, so this is housekeeping, not correctness.
//
// Used by:
//   - PgSessionStore (below) — the constructor's default
// -----------------------------------------------------------

export const PRUNE_INTERVAL_MS = 15 * 60 * 1000;







// -----------------------------------------------------------
// DEFAULT_TTL_MS
// -----------------------------------------------------------
//
// Lifetime of a session whose cookie carries no expiry — the
// same 8 hours index.js gives the cookie.
//
// Used by:
//   - expiryOf (below)
// -----------------------------------------------------------

export const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;







// -----------------------------------------------------------
// expiryOf
// -----------------------------------------------------------
//
// When a session ends: the cookie's own expiry when it has
// one (express-session sets it from maxAge and serializes it
// as an ISO string), else now + maxAge, else now +
// DEFAULT_TTL_MS. Always a Date.
//
// Used by:
//   - PgSessionStore.set / touch (below)
// -----------------------------------------------------------

export function expiryOf(sess, now = Date.now()) {
  const expires = sess?.cookie?.expires;
  if (expires) {
    const at = new Date(expires);
    if (!Number.isNaN(at.getTime())) return at;
  }
  const maxAge = sess?.cookie?.maxAge ?? sess?.cookie?.originalMaxAge;
  return new Date(now + (typeof maxAge === "number" ? maxAge : DEFAULT_TTL_MS));
}







// -----------------------------------------------------------
// loginKeys
// -----------------------------------------------------------
//
// The two strings single logout can search by, from whatever
// shape the caller has: a SessionIndex as a string, as
// samlify's login extract object { sessionIndex,
// authnContextClassRef } or as an array; a NameID string.
// Missing or empty ones are null.
//
// Used by:
//   - PgSessionStore.sidsForLogin (below)
// -----------------------------------------------------------

export function loginKeys({ sessionIndex, nameID } = {}) {
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const si = first(sessionIndex);
  const siText = si && typeof si === "object" ? first(si.sessionIndex) : si;
  const nid = first(nameID);
  return {
    sessionIndex: typeof siText === "string" && siText ? siText : null,
    nameID: typeof nid === "string" && nid ? nid : null,
  };
}







// -----------------------------------------------------------
// PgSessionStore
// -----------------------------------------------------------
//
// new PgSessionStore({ pool }) — the store index.js hands to
// express-session. get/set/destroy/touch are the callback
// methods express-session calls; sidsForLogin() is ours, for
// routes/saml.js. pruneIntervalMs: false turns the sweep
// timer off (tests). The pool is read at call time, so the
// tests' fake pool applies.
//
// Used by:
//   - index.js — the session middleware's store
//   - routes/saml.js — GET /logout/callback, through
//     req.sessionStore.sidsForLogin
// -----------------------------------------------------------

export class PgSessionStore extends session.Store {
  constructor({ pool, pruneIntervalMs = PRUNE_INTERVAL_MS } = {}) {
    super();
    this.pool = pool;
    this.sweepFailed = false;
    this.timer = null;
    if (pruneIntervalMs) {
      this.timer = setInterval(() => this.prune(), pruneIntervalMs);
      this.timer.unref();
    }
  }

  get(sid, cb) {
    this.pool
      .query(`SELECT sess FROM session WHERE sid = $1 AND expire > NOW()`, [sid])
      .then((r) => cb(null, r.rows[0]?.sess ?? null), cb);
  }

  set(sid, sess, cb) {
    this.pool
      .query(
        `INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, sess, expiryOf(sess)]
      )
      .then(() => cb(null), cb);
  }

  touch(sid, sess, cb) {
    this.pool
      .query(`UPDATE session SET expire = $2 WHERE sid = $1`, [sid, expiryOf(sess)])
      .then(() => cb(null), cb);
  }

  destroy(sid, cb) {
    this.pool
      .query(`DELETE FROM session WHERE sid = $1`, [sid])
      .then(() => cb(null), cb);
  }

  // Every live session of the login the IdP names; nothing
  // to search by → nothing, without a query
  async sidsForLogin(ids) {
    const { sessionIndex, nameID } = loginKeys(ids);
    if (!sessionIndex && !nameID) return [];
    const r = await this.pool.query(
      `SELECT sid FROM session
        WHERE expire > NOW()
          AND (sess->'samlUser'->>'sessionIndex' = $1 OR sess->'samlUser'->>'nameID' = $2)`,
      [sessionIndex, nameID]
    );
    return r.rows.map((row) => row.sid);
  }

  async prune() {
    try {
      await this.pool.query(`DELETE FROM session WHERE expire < NOW()`);
      this.sweepFailed = false;
    } catch (err) {
      if (!this.sweepFailed) {
        this.sweepFailed = true;
        console.error("session store: sweep failed:", err.message);
      }
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
  }
}
