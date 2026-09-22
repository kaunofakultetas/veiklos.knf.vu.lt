// -----------------------------------------------------------
//  [*] Regression — routes/saml.js (the login flow)
//
//  The router factory with a FAKE samlify pair: the SP stub
//  returns a scripted assertion extract, so /assert's own
//  logic — attribute mapping, the user upsert, the first
//  sign-in grant, the session write and the redirect — is
//  pinned without any XML. A fake express-session stands in
//  for the cookie store; the pool is the usual fake.
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

// The session object of the LAST request, for inspection
let lastSession = null;

let server;
let base;

// Every origin the router asked spFor() for, in order
const askedOrigins = [];

// The audience /assert demands: this server's own entity id
const audienceOf = () => `${base}/auth/saml/metadata`;







// -----------------------------------------------------------
// fakeSp
// -----------------------------------------------------------
//
// Just enough of samlify's ServiceProvider surface for the
// five routes: metadata, login/logout request contexts, and
// a parseLoginResponse driven by nextExtract.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

const fakeSp = {
  getMetadata: () =>
    '<EntityDescriptor entityID="https://app.test"><SPSSODescriptor></SPSSODescriptor></EntityDescriptor>',
  createLoginRequest: async () => ({ context: "https://idp.test/sso?SAMLRequest=x" }),
  createLogoutRequest: async (_idp, _binding, { logoutNameID }) => ({
    context: `https://idp.test/slo?nameid=${logoutNameID}`,
  }),
  parseLoginResponse: async () => {
    if (!nextExtract) throw new Error("bad signature");
    return { extract: nextExtract };
  },
};







// -----------------------------------------------------------
// fakeSessionMiddleware
// -----------------------------------------------------------
//
// express-session stand-in: a fresh object per request with
// save/destroy that call back immediately; remembered in
// lastSession so tests can read what /assert stored.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

function fakeSessionMiddleware(req, _res, next) {
  req.session = {
    save: (cb) => cb(),
    destroy: (cb) => cb(),
  };
  if (req.headers["x-test-session"] === "signed-in") {
    req.session.samlUser = { nameID: "name-1", sessionIndex: "idx-1", attributes: { uid: "u1" } };
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
      idp: {},
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
  onQuery(/INSERT INTO users \(oid, email, full_name\)/, { rowCount: 1 });
  onQuery(/SELECT 1 FROM user_roles WHERE user_oid = \$1 LIMIT 1/, [{ "?column?": 1 }]);
}







// -----------------------------------------------------------
// assert — VU SSO attributes
// -----------------------------------------------------------
//
// An assertion carrying the OID attribute set: the upsert is
// keyed by uid, gets mail and "givenName sn", the RAW bag is
// stored in the session, and the browser is sent home.
// -----------------------------------------------------------

test("assert: OID attributes → upsert by uid, session stored, redirect /", async () => {
  nextExtract = {
    audience: audienceOf(),    nameID: "transient-1",
    sessionIndex: "sidx-1",
    attributes: {
      "urn:oid:0.9.2342.19200300.100.1.1": "jonas.jonaitis",
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
  assert.deepEqual(upsert.params, ["jonas.jonaitis", "jonas.jonaitis@knf.vu.lt", "Jonas Jonaitis"]);
  assert.equal(lastSession.samlUser.nameID, "transient-1");
  assert.equal(lastSession.samlUser.attributes["urn:oid:2.5.4.42"], "Jonas");
});







// -----------------------------------------------------------
// assert — first sign-in grant
// -----------------------------------------------------------
//
// No user_roles row yet → Darbuotojas is looked up by name
// and granted; a missing role row is skipped silently.
// -----------------------------------------------------------

test("assert: first sign-in auto-grants Darbuotojas", async () => {
  nextExtract = { audience: audienceOf(),  nameID: "n", sessionIndex: "s", attributes: { uid: "new-1", mail: "new@vu.lt" } };
  onQuery(/INSERT INTO users \(oid, email, full_name\)/, { rowCount: 1 });
  onQuery(/SELECT 1 FROM user_roles WHERE user_oid = \$1 LIMIT 1/, []);
  onQuery(/SELECT id FROM roles WHERE name = \$1/, [{ id: 3 }]);
  onQuery(/INSERT INTO user_roles \(user_oid, role_id\)/, { rowCount: 1 });

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 302);

  // name is null when the IdP sent neither part
  assert.deepEqual(queryLog()[0].params, ["new-1", "new@vu.lt", null]);
  const grant = queryLog().find((q) => q.sql.includes("INSERT INTO user_roles"));
  assert.deepEqual(grant.params, ["new-1", 3]);
});







// -----------------------------------------------------------
// assert — missing identity
// -----------------------------------------------------------
//
// No usable oid/uid or email in any spelling → 400 before
// any DB work.
// -----------------------------------------------------------

test("assert: no oid or email in any scheme → 400, no queries", async () => {
  nextExtract = { audience: audienceOf(),  nameID: "n", sessionIndex: "s", attributes: { givenName: "Anonimas" } };

  const res = await post("/auth/saml/assert");
  assert.equal(res.status, 400);
  assert.equal(await res.text(), "SAML assertion missing oid or email attributes");
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
    nextExtract = { nameID: "n", sessionIndex: "s", attributes: { uid: "u1", mail: "u1@vu.lt" } };
    if (audience !== undefined) nextExtract.audience = audience;

    const res = await post("/auth/saml/assert");
    assert.equal(res.status, 401, String(audience));
    assert.equal(await res.text(), "SAML assertion audience mismatch");
    assert.equal(queryLog().length, 0);
  }

  resetDb();
  stubReturningUser();
  nextExtract = { audience: ["https://other.example", audienceOf()], nameID: "n", sessionIndex: "s", attributes: { uid: "u1", mail: "u1@vu.lt" } };
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
  assert.ok(xml.includes('FriendlyName="uid" isRequired="true"'));

  const login = await fetch(base + "/auth/saml/login", { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get("location"), "https://idp.test/sso?SAMLRequest=x");
});







// -----------------------------------------------------------
// logout
// -----------------------------------------------------------
//
// Without a session: straight home. With one: the local
// session goes first, then the browser is sent to the IdP's
// logout with the stored nameID.
// -----------------------------------------------------------

test("logout: home without a session, IdP logout with one", async () => {
  let res = await fetch(base + "/auth/saml/logout", { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");

  res = await fetch(base + "/auth/saml/logout", {
    redirect: "manual",
    headers: { "x-test-session": "signed-in" },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://idp.test/slo?nameid=name-1");

  res = await fetch(base + "/auth/saml/logout/callback", { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});
