// -----------------------------------------------------------
//  [*] Regression — auth/samlSessionIndex.js
//
//  The in-memory map from a VU login's SessionIndex / NameID
//  to our session id: filing, lookup by either identifier and
//  in every shape samlify hands them over, forgetting, expiry
//  with the cookie's lifetime, and the sweep on insert.
// -----------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_INDEX_TTL_MS,
  rememberSamlSession,
  forgetSamlSession,
  samlSessionIdFor,
  resetSamlSessionIndex,
} from "../src/auth/samlSessionIndex.js";


beforeEach(() => resetSamlSessionIndex());







// -----------------------------------------------------------
// filing and lookup
// -----------------------------------------------------------
//
// A login is found by its SessionIndex or its NameID alone;
// an unknown identifier is null; a lookup with neither is
// null too. The default lifetime is the cookie's 8 hours.
// -----------------------------------------------------------

test("filed under both identifiers, found by either", () => {
  assert.equal(SESSION_INDEX_TTL_MS, 8 * 60 * 60 * 1000);
  rememberSamlSession({ sessionIndex: "_session-1", nameID: "_nameid-1" }, "sid-1");

  assert.equal(samlSessionIdFor({ sessionIndex: "_session-1" }), "sid-1");
  assert.equal(samlSessionIdFor({ nameID: "_nameid-1" }), "sid-1");
  assert.equal(samlSessionIdFor({ sessionIndex: "_other", nameID: "_nameid-1" }), "sid-1");
  assert.equal(samlSessionIdFor({ sessionIndex: "_other" }), null);
  assert.equal(samlSessionIdFor({}), null);
  assert.equal(samlSessionIdFor(undefined), null);
});







// -----------------------------------------------------------
// the shapes samlify uses
// -----------------------------------------------------------
//
// At login the extract's sessionIndex is an object
// ({ sessionIndex, authnContextClassRef }); an inbound
// LogoutRequest gives a string, or an array when it carried
// several. All three file and find the same entry. A
// SessionIndex whose text equals some NameID is a different
// key.
// -----------------------------------------------------------

test("object, string and array forms of sessionIndex all work; no cross-talk between the two identifiers", () => {
  rememberSamlSession(
    { sessionIndex: { sessionIndex: "_session-2", authnContextClassRef: "urn:x" }, nameID: "_nameid-2" },
    "sid-2"
  );
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-2" }), "sid-2");
  assert.equal(samlSessionIdFor({ sessionIndex: ["_session-2", "_session-9"] }), "sid-2");
  assert.equal(samlSessionIdFor({ sessionIndex: { sessionIndex: "_session-2" } }), "sid-2");

  // the same text as a NameID is not the same key
  assert.equal(samlSessionIdFor({ nameID: "_session-2" }), null);
  assert.equal(samlSessionIdFor({ sessionIndex: "_nameid-2" }), null);
});







// -----------------------------------------------------------
// nothing to file
// -----------------------------------------------------------
//
// No session id, or a login with neither identifier (empty
// strings and arrays included), files nothing — a later
// lookup by an empty identifier must never hit a stray
// entry.
// -----------------------------------------------------------

test("no sid or no identifiers → nothing filed", () => {
  rememberSamlSession({ sessionIndex: "_session-3", nameID: "_nameid-3" }, undefined);
  rememberSamlSession({ sessionIndex: "", nameID: [] }, "sid-3");
  rememberSamlSession({}, "sid-3");
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-3" }), null);
  assert.equal(samlSessionIdFor({ sessionIndex: "", nameID: "" }), null);
});







// -----------------------------------------------------------
// forgetting
// -----------------------------------------------------------
//
// Forgetting by one identifier removes only that key; the
// routes always forget with both, which removes the login
// entirely. Forgetting the unknown is a no-op.
// -----------------------------------------------------------

test("forget drops the given keys; unknown keys are a no-op", () => {
  rememberSamlSession({ sessionIndex: "_session-4", nameID: "_nameid-4" }, "sid-4");

  forgetSamlSession({ sessionIndex: "_session-4" });
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-4" }), null);
  assert.equal(samlSessionIdFor({ nameID: "_nameid-4" }), "sid-4");

  forgetSamlSession({ sessionIndex: "_session-4", nameID: "_nameid-4" });
  assert.equal(samlSessionIdFor({ nameID: "_nameid-4" }), null);
  forgetSamlSession({ sessionIndex: "_never" });
});







// -----------------------------------------------------------
// expiry
// -----------------------------------------------------------
//
// An entry lives as long as it was told to: an already-
// expired lifetime is never found, and a later insert sweeps
// it out. A fresh filing of the same identifiers replaces the
// old session id.
// -----------------------------------------------------------

test("expired entries are not found and are swept on the next insert; refiling replaces", () => {
  rememberSamlSession({ sessionIndex: "_session-5", nameID: "_nameid-5" }, "sid-5", -1);
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-5" }), null);
  assert.equal(samlSessionIdFor({ nameID: "_nameid-5" }), null);

  rememberSamlSession({ sessionIndex: "_session-6" }, "sid-6", -1);
  rememberSamlSession({ sessionIndex: "_session-7" }, "sid-7");
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-6" }), null);
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-7" }), "sid-7");

  rememberSamlSession({ sessionIndex: "_session-7" }, "sid-8");
  assert.equal(samlSessionIdFor({ sessionIndex: "_session-7" }), "sid-8");
});
