// -----------------------------------------------------------
//  [*] Regression — routes/saml.js (the login flow)
//
//  The router factory with a FAKE samlify pair: the SP stub
//  returns a scripted assertion extract, so /assert's own
//  logic — attribute mapping, the user upsert, the first
//  sign-in grant, the session write and the redirect — is
//  pinned without any XML. The same stub scripts the logout
//  parsers, so /logout/callback's two branches — the IdP's
//  LogoutResponse and an IdP-initiated LogoutRequest — are
//  pinned the same way, down to the raw octet string handed
//  over for the signature check, and the store lookup that
//  lets an IdP-initiated logout end a login without its
//  cookie. A fake express-session (with a fake store) stands
//  in for the cookie store; the pool is the usual fake.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { resetDb, onQuery, queryLog } from "./helpers/db.js";
import createSamlRouter from "../src/routes/saml.js";


// What the fake SP "parses" out of the next POSTed assertion;
// set per test. null → parseLoginResponse throws
let nextExtract = null;

// What the fake SP makes of the next logout message on
// /logout/callback: the LogoutRequest extract (null →
// parseLogoutRequest throws), whether the LogoutResponse
// verifies, whether building our answer throws
let nextLogoutRequest = null;
let logoutResponseVerifies = true;
let logoutResponseBuildFails = false;

// Whether building OUR LogoutRequest (POST /logout) throws,
// and the extra arguments the route passed for it
let logoutRequestBuildFails = false;
let lastLogoutRequestArgs = null;

// Every samlify logout call the router made, in order, with
// its arguments and whether the session was already gone
const samlCalls = [];

// The session object of the LAST request, for inspection
let lastSession = null;

// The fake session store: every session id destroyed through
// it, in order — the path an IdP-initiated logout takes when
// no cookie came along — and the login lookup, scripted per
// test (loginSids) and recorded (lookups); a destroyed sid
// drops out of loginSids like a deleted row would
const fakeStore = {
  destroyed: [],
  loginSids: [],
  lookups: [],
  destroy(sid, cb) {
    this.destroyed.push(sid);
    this.loginSids = this.loginSids.filter((s) => s !== sid);
    cb();
  },
  async sidsForLogin(ids) {
    this.lookups.push(ids);
    return this.loginSids.slice();
  },
};

// Each request gets the next session id, like express-session
// minting one per cookie-less visitor
let sessionCounter = 0;

let server;
let base;

// Every origin the router asked spFor() for, in order
const askedOrigins = [];

// The audience /assert demands: this server's own entity id
const audienceOf = () => `${base}/auth/saml/metadata`;

// The setup's IdP object; the callback must hand THIS to
// every samlify logout call
const fakeIdp = { entityID: "https://idp.test" };







// -----------------------------------------------------------
// fakeSp
// -----------------------------------------------------------
//
// Just enough of samlify's ServiceProvider surface for the
// five routes: metadata, login/logout request contexts, a
// parseLoginResponse driven by nextExtract, and the logout
// parsers / response builder driven by the logout script
// above — every logout call lands in samlCalls.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

const logCall = (fn, rest) =>
  samlCalls.push({ fn, sessionGone: lastSession?.destroyed === true, ...rest });

const fakeSp = {
  getMetadata: () =>
    '<EntityDescriptor entityID="https://app.test"><SPSSODescriptor></SPSSODescriptor></EntityDescriptor>',
  createLoginRequest: async () => ({ context: "https://idp.test/sso?SAMLRequest=x" }),
  createLogoutRequest: async (_idp, _binding, { logoutNameID }, relayState, tagReplacement) => {
    lastLogoutRequestArgs = { relayState, tagReplacement };
    if (logoutRequestBuildFails) throw new Error("ERR_GENERATE_REDIRECT_LOGOUT_REQUEST_MISSING_METADATA");
    return { context: `https://idp.test/slo?nameid=${logoutNameID}` };
  },
  parseLoginResponse: async () => {
    if (!nextExtract) throw new Error("bad signature");
    return { extract: nextExtract };
  },
  // samlify rejects redirect-binding messages with bare
  // strings, not Errors — mirrored here
  parseLogoutRequest: async (idp, binding, message) => {
    logCall("parseLogoutRequest", { idp, binding, message });
    if (!nextLogoutRequest) throw "ERR_FAILED_MESSAGE_SIGNATURE_VERIFICATION";
    return nextLogoutRequest;
  },
  parseLogoutResponse: async (idp, binding, message) => {
    logCall("parseLogoutResponse", { idp, binding, message });
    if (!logoutResponseVerifies) throw "ERR_FAILED_MESSAGE_SIGNATURE_VERIFICATION";
    return { extract: { response: { inResponseTo: "_our-req-1" } } };
  },
  createLogoutResponse: (idp, requestInfo, binding, relayState) => {
    logCall("createLogoutResponse", { idp, requestInfo, binding, relayState });
    if (logoutResponseBuildFails) throw new Error("ERR_GENERATE_REDIRECT_LOGOUT_RESPONSE_MISSING_METADATA");
    return { context: `https://idp.test/slo?SAMLResponse=y&RelayState=${encodeURIComponent(relayState)}` };
  },
};







// -----------------------------------------------------------
// fakeSessionMiddleware
// -----------------------------------------------------------
//
// express-session stand-in: a fresh object per request with
// save/destroy/regenerate that call back immediately, its id
// on req.sessionID / session.id, the fake store on
// req.sessionStore and the cookie's maxAge; remembered in
// lastSession so tests can read what /assert stored and
// whether a logout route destroyed it. regenerate() retires
// the object (destroyed) and hands the request a fresh one
// with the next id, keeping a link back (regeneratedFrom) —
// what express-session does at login.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

function makeSession(req, regeneratedFrom = null) {
  const session = {
    id: req.sessionID,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
    regeneratedFrom,
    save: (cb) => cb(),
    destroy: (cb) => { session.destroyed = true; cb(); },
    regenerate: (cb) => {
      session.destroyed = true;
      req.sessionID = `sid-${++sessionCounter}`;
      req.session = makeSession(req, session);
      lastSession = req.session;
      cb();
    },
  };
  return session;
}

function fakeSessionMiddleware(req, _res, next) {
  req.sessionID = `sid-${++sessionCounter}`;
  req.sessionStore = fakeStore;
  req.session = makeSession(req);
  if (req.headers["x-test-session"] === "signed-in") {
    req.session.samlUser = { nameID: "name-1", sessionIndex: "idx-1", attributes: { eID: "112546" } };
  }
  lastSession = req.session;
  next();
}







// -----------------------------------------------------------
// post
// -----------------------------------------------------------
//
// A form-encoded POST that does NOT follow redirects — the
// 302 and its Location are what the tests assert.
//
// Used by:
//   - the /assert tests (below)
// -----------------------------------------------------------

async function post(path, headers = {}) {
  return fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: "SAMLResponse=dGVzdA%3D%3D",
  });
}


before(async () => {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(fakeSessionMiddleware);

  // Mounted exactly like index.js does; the fake setup hands
  // the same SP to every origin but records which origin was
  // asked for
  const router = createSamlRouter({
    setup: {
      idp: fakeIdp,
      spFor: (origin) => {
        askedOrigins.push(origin);
        return fakeSp;
      },
      identityFor: (origin) => ({ spEntityId: `${origin}/auth/saml/metadata` }),
    },
  });
  app.use("/auth/saml", router);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  resetDb();
  nextExtract = null;
  nextLogoutRequest = null;
  logoutResponseVerifies = true;
  logoutResponseBuildFails = false;
  logoutRequestBuildFails = false;
  lastLogoutRequestArgs = null;
  samlCalls.length = 0;
  fakeStore.destroyed.length = 0;
  fakeStore.loginSids = [];
  fakeStore.lookups.length = 0;
  lastSession = null;
  askedOrigins.length = 0;
});







// -----------------------------------------------------------
// stubReturningUser
// -----------------------------------------------------------
//
// The DB script for a user who already has a role row: the
// upsert plus the "any roles?" probe answering yes, so no
// grant happens.
//
// Used by:
//   - the /assert happy-path tests (below)
// -----------------------------------------------------------

function stubReturningUser() {
  onQuery(/INSERT INTO users \(eid, email, full_name, last_login_at\)/, { rowCount: 1 });
  onQuery(/SELECT 1 FROM user_roles WHERE user_eid = \$1 LIMIT 1/, [{ "?column?": 1 }]);
}







// -----------------------------------------------------------
// assert — VU SSO attributes
// -----------------------------------------------------------
//
// An assertion carrying VU's attribute set: the upsert is
// keyed by eID, gets mail and "givenName sn", the RAW bag is
// stored in the session, and the browser is sent home.
// -----------------------------------------------------------

test("assert: VU attributes → upsert by eID, session stored, redirect /", async () => {
  nextExtract = {
    audience: audienceOf(),    nameID: "transient-1",
    sessionIndex: { sessionIndex: "sidx-1", authnContextClassRef: "urn:oasis:names:tc:SAML:2.0:ac:classes:Password" },
    attributes: {
      eID: "112546",
      "urn:oid:0.9.2342.19200300.100.1.3": ["jonas.jonaitis@knf.vu.lt"],
      "urn:oid:2.5.4.42": "Jonas",
      "urn:oid:2.5.4.4": "Jonaitis",
    },
  };
  stubReturningUser();

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");

  const upsert = queryLog()[0];
  assert.ok(upsert.sql.startsWith("INSERT INTO users"), "the upsert is the first query");
  assert.deepEqual(upsert.params, ["112546", "jonas.jonaitis@knf.vu.lt", "Jonas Jonaitis"]);
  assert.equal(lastSession.samlUser.nameID, "transient-1");
  assert.equal(lastSession.samlUser.attributes["urn:oid:2.5.4.42"], "Jonas");

  // a fresh session id at login: the anonymous one is retired
  assert.ok(lastSession.regeneratedFrom, "the session was regenerated at login");
  assert.equal(lastSession.regeneratedFrom.destroyed, true);
  assert.notEqual(lastSession.id, lastSession.regeneratedFrom.id);
  assert.equal(lastSession.regeneratedFrom.samlUser, undefined, "nothing was stored on the old session");

  // the SessionIndex is stored as one string — what the
  // store searches by and our LogoutRequest sends
  assert.equal(lastSession.samlUser.sessionIndex, "sidx-1");
});







// -----------------------------------------------------------
// assert — first sign-in grant
// -----------------------------------------------------------
//
// No user_roles row yet → Darbuotojas is looked up by name
// and granted; a missing role row is skipped silently.
// -----------------------------------------------------------

test("assert: first sign-in auto-grants Darbuotojas", async () => {
  nextExtract = { audience: audienceOf(),  nameID: "n", sessionIndex: "s", attributes: { eID: "200001", mail: "new@vu.lt" } };
  onQuery(/INSERT INTO users \(eid, email, full_name, last_login_at\)/, { rowCount: 1 });
  onQuery(/SELECT 1 FROM user_roles WHERE user_eid = \$1 LIMIT 1/, []);
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 3 }]);
  onQuery(/INSERT INTO user_roles \(user_eid, role_id\)/, { rowCount: 1 });

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 302);

  // name is null when the IdP sent neither part
  assert.deepEqual(queryLog()[0].params, ["200001", "new@vu.lt", null]);
  const grant = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.deepEqual(grant.params, ["200001", 3]);
});







// -----------------------------------------------------------
// assert — missing identity
// -----------------------------------------------------------
//
// No eID or no mail → 400 before any DB work, naming the
// attributes that DID arrive so a release policy with
// unknown names is diagnosable. uid or eduPersonTargetedID
// alone never key an account.
// -----------------------------------------------------------

test("assert: no eID or mail → 400 naming what arrived, no queries", async () => {
  nextExtract = {
    audience: audienceOf(), nameID: "n", sessionIndex: "s",
    attributes: { "urn:oid:0.9.2342.19200300.100.1.1": "vu12345", "urn:oid:1.3.6.1.4.1.5923.1.1.1.10": "pairwise", mail: "j@vu.lt" },
  };

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 400);
  assert.equal(
    await res.text(),
    "SAML assertion missing eID or mail attributes (received: urn:oid:0.9.2342.19200300.100.1.1, urn:oid:1.3.6.1.4.1.5923.1.1.1.10, mail)"
  );
  assert.equal(queryLog().length, 0);
});







// -----------------------------------------------------------
// assert — invalid response
// -----------------------------------------------------------
//
// samlify rejecting the response (bad signature, wrong
// audience…) → 401 with the reason.
// -----------------------------------------------------------

test("assert: parse failure → 401 with the reason", async () => {
  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 401);
  assert.equal(await res.text(), "SAML assertion parsing failed: bad signature");
});







// -----------------------------------------------------------
// assert — the IdP's own failure reason
// -----------------------------------------------------------
//
// When the IdP answers with a non-Success status, its
// StatusMessage and the nested status codes are read out of
// the posted response and appended to the 401 — the
// "Responder" code alone says nothing about the cause.
// -----------------------------------------------------------

test("assert: a failed-status response surfaces the IdP's StatusMessage", async () => {
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><samlp:Status>` +
    `<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder">` +
    `<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:InvalidNameIDPolicy"/></samlp:StatusCode>` +
    `<samlp:StatusMessage>Unable to provide requested NameID format</samlp:StatusMessage></samlp:Status></samlp:Response>`;
  const res = await fetch(base + "/auth/saml/assert", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "SAMLResponse=" + encodeURIComponent(Buffer.from(xml).toString("base64")),
  });
  assert.equal(res.status, 401);
  assert.equal(
    await res.text(),
    "SAML assertion parsing failed: bad signature — IdP says: Unable to provide requested NameID format " +
      "(urn:oasis:names:tc:SAML:2.0:status:Responder → urn:oasis:names:tc:SAML:2.0:status:InvalidNameIDPolicy)"
  );
});







// -----------------------------------------------------------
// assert — DB failure after a valid assertion
// -----------------------------------------------------------
//
// A Postgres error (five-character SQLSTATE code) once the
// assertion has already been accepted is ours: 500 with a
// message that does not blame the assertion.
// -----------------------------------------------------------

test("assert: a DB error after a valid assertion → 500, not 'parsing failed'", async () => {
  nextExtract = { audience: audienceOf(), nameID: "n", sessionIndex: "s", attributes: { eID: "112546", mail: "u1@vu.lt" } };
  onQuery(/INSERT INTO users/, () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), { code: "23505" });
  });

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "Login failed on our side; the assertion was fine");
});







// -----------------------------------------------------------
// assert — audience
// -----------------------------------------------------------
//
// samlify does not check the AudienceRestriction, so /assert
// does: an assertion minted for another SP (or carrying no
// audience at all) is a 401, and nothing is upserted. An
// array of audiences containing ours passes.
// -----------------------------------------------------------

test("assert: foreign or missing audience → 401, no upsert; a list containing ours passes", async () => {
  for (const audience of ["https://kitas-sp.example/metadata", undefined, []]) {
    resetDb();
    nextExtract = { nameID: "n", sessionIndex: "s", attributes: { eID: "112546", mail: "u1@vu.lt" } };
    if (audience !== undefined) nextExtract.audience = audience;

    const res = await post("/auth/saml/assert");
    assert.equal(res.status, 401, String(audience));
    assert.equal(await res.text(), "SAML assertion audience mismatch");
    assert.equal(queryLog().length, 0);
  }

  resetDb();
  stubReturningUser();
  nextExtract = { audience: ["https://other.example", audienceOf()], nameID: "n", sessionIndex: "s", attributes: { eID: "112546", mail: "u1@vu.lt" } };
  const ok = await post("/auth/saml/assert");
  assert.equal(ok.status, 302);
});







// -----------------------------------------------------------
// the SP follows the request origin
// -----------------------------------------------------------
//
// Every route asks the setup for the SP of the origin the
// request arrived on — scheme + Host header, port included —
// so the app answers under any domain name.
// -----------------------------------------------------------

test("routes ask for the SP of the request's own origin", async () => {
  await fetch(base + "/auth/saml/metadata");
  assert.deepEqual(askedOrigins, [base]);

  // a different Host header → a different origin asked for
  await new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request(
      { host: u.hostname, port: u.port, path: "/auth/saml/metadata", headers: { Host: "veiklos.example" } },
      (res) => { res.resume(); res.on("end", resolve); }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(askedOrigins[1], "http://veiklos.example");
});







// -----------------------------------------------------------
// metadata + login
// -----------------------------------------------------------
//
// /metadata is public XML enriched with the FEDI blocks;
// /login bounces to the SP's login-request context.
// -----------------------------------------------------------

test("metadata is enriched XML; login redirects to the IdP", async () => {
  const md = await fetch(base + "/auth/saml/metadata");
  assert.equal(md.status, 200);
  assert.ok(md.headers.get("content-type").includes("xml"));
  const xml = await md.text();
  assert.ok(xml.includes('Name="eID" FriendlyName="eID" isRequired="true"'));

  const login = await fetch(base + "/auth/saml/login", { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get("location"), "https://idp.test/sso?SAMLRequest=x");
});







// -----------------------------------------------------------
// logout
// -----------------------------------------------------------
//
// A POST answered with JSON — where the browser goes next.
// Without a session: "/". With one: the local session and its
// index entry go first, then the IdP's logout URL with the
// stored nameID; when that URL cannot be built, "/" — signed
// out either way. There is no GET: a cross-site link cannot
// sign anyone out, and a cross-site POST carries no
// SameSite=Lax cookie.
// -----------------------------------------------------------

test("logout: POST answers the next URL — home without a session, the IdP with one; no GET", async () => {
  const post = (signedIn) => fetch(base + "/auth/saml/logout", {
    method: "POST",
    headers: signedIn ? { "x-test-session": "signed-in" } : {},
  });

  let res = await post(false);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { redirect: "/" });

  res = await post(true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { redirect: "https://idp.test/slo?nameid=name-1" });
  assert.equal(lastSession.destroyed, true);
  // the SessionIndex template is only used with a tag replacer
  assert.equal(typeof lastLogoutRequestArgs.tagReplacement, "function");
  assert.equal(lastLogoutRequestArgs.relayState, "");

  // the IdP URL cannot be built: still signed out, home
  logoutRequestBuildFails = true;
  res = await post(true);
  assert.deepEqual(await res.json(), { redirect: "/" });
  assert.equal(lastSession.destroyed, true);

  // a GET — what a cross-site link would be — matches nothing
  // and touches nothing
  res = await fetch(base + "/auth/saml/logout", { redirect: "manual", headers: { "x-test-session": "signed-in" } });
  assert.equal(res.status, 404);
  assert.notEqual(lastSession.destroyed, true);

  res = await fetch(base + "/auth/saml/logout/callback", { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});







// -----------------------------------------------------------
// callback
// -----------------------------------------------------------
//
// A redirect-binding message as VU's IdP sends it: the query
// still percent-encoded on the wire, Signature last. The
// route must hand samlify the DECODED query plus the raw
// octet string (everything before &Signature=, untouched).
// -----------------------------------------------------------

const SIG_ALG = "http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256";
const RAW_RESPONSE = `SAMLResponse=AbC%2Bd%2F%3D%3D&RelayState=x%20y&SigAlg=${SIG_ALG}`;
const RAW_REQUEST = `SAMLRequest=ReQ%2B%2F%3D&RelayState=RS-1&SigAlg=${SIG_ALG}`;

async function callback(rawQuery, signedIn = true) {
  return fetch(`${base}/auth/saml/logout/callback${rawQuery ? "?" + rawQuery : ""}`, {
    redirect: "manual",
    headers: signedIn ? { "x-test-session": "signed-in" } : {},
  });
}







// -----------------------------------------------------------
// callback — the IdP's LogoutResponse
// -----------------------------------------------------------
//
// The return leg of our own logout: the response is verified
// over the raw octet string against the setup's IdP, the
// session goes, the browser goes home. The IdP's verdict
// cannot keep anyone signed in — a response that fails
// verification still ends at "/" with the session gone.
// -----------------------------------------------------------

test("callback: LogoutResponse verified over the raw query, then home", async () => {
  let res = await callback(`${RAW_RESPONSE}&Signature=s%2Fg%3D`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.equal(lastSession.destroyed, true);

  assert.deepEqual(samlCalls.map((c) => c.fn), ["parseLogoutResponse"]);
  const [call] = samlCalls;
  assert.equal(call.idp, fakeIdp);
  assert.equal(call.binding, "redirect");
  assert.equal(call.message.octetString, RAW_RESPONSE);
  assert.deepEqual(call.message.query, {
    SAMLResponse: "AbC+d/==",
    RelayState: "x y",
    SigAlg: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    Signature: "s/g=",
  });

  // a response that does not verify: logged, never fatal
  logoutResponseVerifies = false;
  res = await callback(`${RAW_RESPONSE}&Signature=bad`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.equal(lastSession.destroyed, true);
});







// -----------------------------------------------------------
// callback — IdP-initiated LogoutRequest
// -----------------------------------------------------------
//
// The user signed out elsewhere and VU tells us: the request
// is verified, the local session is ended BEFORE the answer
// is built, and the browser is sent to the IdP with a
// LogoutResponse for that request carrying VU's RelayState
// (empty when VU sent none).
// -----------------------------------------------------------

test("callback: IdP-initiated LogoutRequest ends the session and is answered at the IdP", async () => {
  nextLogoutRequest = { extract: { request: { id: "_idp-req-1" }, nameID: "name-1" } };

  let res = await callback(`${RAW_REQUEST}&Signature=s%2Fg%3D`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://idp.test/slo?SAMLResponse=y&RelayState=RS-1");
  assert.equal(lastSession.destroyed, true);

  assert.deepEqual(samlCalls.map((c) => c.fn), ["parseLogoutRequest", "createLogoutResponse"]);
  const [parse, answer] = samlCalls;
  assert.equal(parse.idp, fakeIdp);
  assert.equal(parse.binding, "redirect");
  assert.equal(parse.message.octetString, RAW_REQUEST);
  assert.equal(parse.message.query.SAMLRequest, "ReQ+/=");
  assert.equal(parse.sessionGone, false);
  assert.equal(answer.sessionGone, true, "the session is gone before the answer is built");
  assert.equal(answer.idp, fakeIdp);
  assert.equal(answer.requestInfo, nextLogoutRequest, "the parsed request is what the answer is built from");
  assert.equal(answer.binding, "redirect");
  assert.equal(answer.relayState, "RS-1");

  // no RelayState from the IdP → an empty one in the answer
  samlCalls.length = 0;
  res = await callback(`SAMLRequest=ReQ&SigAlg=${SIG_ALG}&Signature=x`);
  assert.equal(res.status, 302);
  assert.equal(samlCalls[1].relayState, "");
});







// -----------------------------------------------------------
// callback — IdP-initiated logout without the cookie
// -----------------------------------------------------------
//
// The iframe case: the request carries no session, but the
// store finds the login by the request's SessionIndex /
// NameID — every session it names is destroyed there, and
// the IdP is answered. A repeat, or a request naming no
// known login, destroys nothing and is still answered.
// -----------------------------------------------------------

test("callback: cookie-less IdP-initiated logout ends the login's sessions through the store", async () => {
  fakeStore.loginSids = ["sid-login", "sid-login-tab2"];
  nextLogoutRequest = { extract: { request: { id: "_idp-req-3" }, nameID: "nid-9", sessionIndex: "sidx-9" } };

  let res = await callback(`${RAW_REQUEST}&Signature=s`, false);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://idp.test/slo?SAMLResponse=y&RelayState=RS-1");
  assert.deepEqual(fakeStore.lookups, [{ sessionIndex: "sidx-9", nameID: "nid-9" }]);
  assert.deepEqual(fakeStore.destroyed, ["sid-login", "sid-login-tab2"]);
  assert.equal(lastSession.destroyed, true, "the request's own blank session goes too");

  // a repeat, and a request for a login never filed
  res = await callback(`${RAW_REQUEST}&Signature=s`, false);
  assert.equal(res.status, 302);
  nextLogoutRequest = { extract: { request: { id: "_idp-req-4" }, nameID: "nid-unknown", sessionIndex: "sidx-unknown" } };
  res = await callback(`${RAW_REQUEST}&Signature=s`, false);
  assert.equal(res.status, 302);
  assert.deepEqual(fakeStore.destroyed, ["sid-login", "sid-login-tab2"]);
  assert.equal(fakeStore.lookups.length, 3);
});







// -----------------------------------------------------------
// callback — refused and failed logout requests
// -----------------------------------------------------------
//
// A LogoutRequest that fails verification is a 400 that
// changes nothing: the session stays and no answer is built —
// a forged link cannot log anyone out. When the request is
// fine but the answer cannot be built, the session is still
// gone and the browser goes home.
// -----------------------------------------------------------

test("callback: unverified LogoutRequest → 400 and nothing changes; unbuildable answer → home", async () => {
  let res = await callback(`${RAW_REQUEST}&Signature=forged`);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), "Invalid SAML logout request");
  assert.notEqual(lastSession.destroyed, true);
  assert.deepEqual(samlCalls.map((c) => c.fn), ["parseLogoutRequest"]);
  assert.deepEqual(fakeStore.destroyed, []);

  nextLogoutRequest = { extract: { request: { id: "_idp-req-2" } } };
  logoutResponseBuildFails = true;
  res = await callback(`${RAW_REQUEST}&Signature=s`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.equal(lastSession.destroyed, true);
});







// -----------------------------------------------------------
// callback — no message
// -----------------------------------------------------------
//
// A bare visit carries nothing to verify: no samlify call,
// the session (if any) goes, the browser goes home.
// -----------------------------------------------------------

test("callback: no SAML message → home, nothing parsed", async () => {
  const res = await callback("", true);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.equal(lastSession.destroyed, true);
  assert.deepEqual(samlCalls, []);
});
