// -----------------------------------------------------------
//  [*] Auth — SAML session index
//
//  Which of OUR sessions a VU login belongs to, keyed by what
//  the IdP quotes when it later ends that login: the SAML
//  SessionIndex and the transient NameID. An IdP-initiated
//  LogoutRequest reaches /auth/saml/logout/callback inside a
//  cross-site iframe on sso.vu.lt, where the browser withholds
//  our SameSite=Lax session cookie — the callback cannot reach
//  the session through the request, so it looks the session
//  id up here and ends it through the session store.
//
//  In memory, like the session store itself: gone on restart
//  together with the sessions, one process only. An entry
//  expires with its session (the cookie's maxAge) and expired
//  entries are swept on every insert, so the map stays
//  bounded by the number of live logins.
// -----------------------------------------------------------


// key → { sid, expiresAt }. Keys are prefixed ("si:", "nid:")
// so a SessionIndex and a NameID with the same text never
// collide
const entries = new Map();







// -----------------------------------------------------------
// SESSION_INDEX_TTL_MS
// -----------------------------------------------------------
//
// Lifetime of an entry when the session carries no maxAge —
// the same 8 hours index.js gives the cookie.
//
// Used by:
//   - rememberSamlSession (below)
// -----------------------------------------------------------

export const SESSION_INDEX_TTL_MS = 8 * 60 * 60 * 1000;







// -----------------------------------------------------------
// indexKeys
// -----------------------------------------------------------
//
// The map keys for a login's identifiers. sessionIndex may
// come as a string (an inbound LogoutRequest), as samlify's
// login extract object { sessionIndex, authnContextClassRef }
// or as an array when a message carried several; nameID is
// the transient NameID string. Missing or empty ones are
// skipped, so an identifier VU did not send never becomes a
// key.
//
// Used by:
//   - rememberSamlSession, forgetSamlSession,
//     samlSessionIdFor (below)
// -----------------------------------------------------------

function indexKeys({ sessionIndex, nameID } = {}) {
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const si = first(sessionIndex);
  const siText = typeof si === "object" && si !== null ? first(si.sessionIndex) : si;
  const nid = first(nameID);

  const keys = [];
  if (typeof siText === "string" && siText) keys.push(`si:${siText}`);
  if (typeof nid === "string" && nid) keys.push(`nid:${nid}`);
  return keys;
}







// -----------------------------------------------------------
// rememberSamlSession
// -----------------------------------------------------------
//
// rememberSamlSession({ sessionIndex, nameID }, sid, ttlMs)
// files a login's session id under both identifiers for ttlMs
// (the cookie's maxAge; SESSION_INDEX_TTL_MS when absent). A
// missing sid or a login without either identifier files
// nothing. Expired entries are swept first.
//
// Used by:
//   - routes/saml.js — POST /assert, once the session is saved
// -----------------------------------------------------------

export function rememberSamlSession(ids, sid, ttlMs = SESSION_INDEX_TTL_MS) {
  if (!sid) return;
  const keys = indexKeys(ids);
  if (!keys.length) return;

  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }

  const entry = { sid, expiresAt: now + ttlMs };
  for (const key of keys) entries.set(key, entry);
}







// -----------------------------------------------------------
// forgetSamlSession
// -----------------------------------------------------------
//
// Drops a login's entries once its session is gone, whichever
// side ended it; unknown identifiers are a no-op.
//
// Used by:
//   - routes/saml.js — GET /logout and the IdP-initiated
//     branch of GET /logout/callback
// -----------------------------------------------------------

export function forgetSamlSession(ids) {
  for (const key of indexKeys(ids)) entries.delete(key);
}







// -----------------------------------------------------------
// samlSessionIdFor
// -----------------------------------------------------------
//
// The session id filed for a login, by SessionIndex first and
// NameID second; null when neither is known or the entry has
// expired (an expired entry is dropped on the way).
//
// Used by:
//   - routes/saml.js — the IdP-initiated branch of
//     GET /logout/callback
// -----------------------------------------------------------

export function samlSessionIdFor(ids) {
  const now = Date.now();
  for (const key of indexKeys(ids)) {
    const entry = entries.get(key);
    if (!entry) continue;
    if (entry.expiresAt <= now) {
      entries.delete(key);
      continue;
    }
    return entry.sid;
  }
  return null;
}







// -----------------------------------------------------------
// resetSamlSessionIndex
// -----------------------------------------------------------
//
// Empties the index; the module keeps state across a whole
// process, so tests start each case from nothing.
//
// Used by:
//   - tests/samlSessionIndex.test.js, tests/samlRoutes.test.js
// -----------------------------------------------------------

export function resetSamlSessionIndex() {
  entries.clear();
}
