// -----------------------------------------------------------
//  [*] Regression — utils/saml.js (SP setup + attribute map)
//
//  Drives createSamlSetup against the real sso.vu.lt
//  descriptor checked into fixtures/ (as a file and, via a
//  stub server, as a URL). Pins the per-origin SP identity,
//  the lab-registration overrides, the signed-request key
//  demand, the missing-metadata boot
//  error, the attribute mapper for VU's OIDs and friendly
//  names, and the LitNET FEDI enrichment.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { once } from "node:events";
import {
  SAML_BASE_PATH,
  SP_INFO,
  ATTRIBUTE_ALIASES,
  mapSamlAttributes,
  enrichSpMetadata,
  createSamlSetup,
} from "../src/utils/saml.js";


// The real VU SSO IdP descriptor (public), as a file path
const VU_FIXTURE = new URL("./fixtures/vu-idp-metadata.xml", import.meta.url).pathname;

// lab.knf.vu.lt's registered identity — what the overrides
// reuse when the app is hosted on that domain
const LAB_ENTITY = "https://lab.knf.vu.lt";
const LAB_ACS = "https://lab.knf.vu.lt/simplesaml/module.php/saml/sp/saml2-acs.php/default-sp";

// Every env key createSamlSetup / enrichSpMetadata read —
// wiped before each test so nothing leaks between tests
const SAML_ENV = [
  "IDP_METADATA", "SP_ENTITY_ID", "SP_ACS_URL", "SP_PRIVATE_KEY_PATH", "SP_SIGNING_CERT_PATH",
];

let stub;
let stubOrigin;

// What the stub serves: the VU descriptor, or a variant that
// demands signed AuthnRequests
let stubWantsSigned = false;







// -----------------------------------------------------------
// stubMetadata
// -----------------------------------------------------------
//
// The VU descriptor verbatim, or with WantAuthnRequestsSigned
// switched on to exercise the key demand.
//
// Used by:
//   - the stub server (below)
// -----------------------------------------------------------

function stubMetadata() {
  const xml = fs.readFileSync(VU_FIXTURE, "utf8");
  if (!stubWantsSigned) return xml;
  return xml.replace("<md:IDPSSODescriptor ", '<md:IDPSSODescriptor WantAuthnRequestsSigned="true" ');
}


before(async () => {
  stub = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/xml");
    res.end(stubMetadata());
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  stubOrigin = `http://127.0.0.1:${stub.address().port}`;
});

after(() => stub.close());

beforeEach(() => {
  for (const k of SAML_ENV) delete process.env[k];
  stubWantsSigned = false;
});







// -----------------------------------------------------------
// file metadata — VU IdP, unsigned requests, login target
// -----------------------------------------------------------
//
// IDP_METADATA as a path: the VU IdP parses, requests stay
// unsigned (no key needed), the SP metadata for an origin
// carries that origin's entity id / ACS / SLO, and the login
// redirect goes straight to sso.vu.lt.
// -----------------------------------------------------------

test("file metadata: VU IdP parsed, unsigned, login at sso.vu.lt", async () => {
  process.env.IDP_METADATA = VU_FIXTURE;

  const setup = await createSamlSetup();

  assert.equal(setup.idpSource, VU_FIXTURE);
  assert.equal(setup.idpEntityId, "https://sso.vu.lt/SSO/saml2/idp/metadata.php");
  assert.equal(setup.idpWantsSignedRequests, false);

  const sp = setup.spFor("https://veiklos.knf.vu.lt");
  const md = sp.getMetadata();
  assert.ok(md.includes('entityID="https://veiklos.knf.vu.lt/auth/saml/metadata"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/assert"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/logout/callback"'));

  const { context } = await sp.createLoginRequest(setup.idp, "redirect");
  assert.ok(
    context.startsWith("https://sso.vu.lt/SSO/saml2/idp/SSOService.php?"),
    "login must redirect to the VU IdP, got " + context
  );
});







// -----------------------------------------------------------
// URL metadata
// -----------------------------------------------------------
//
// IDP_METADATA may also be an http(s) URL; it is fetched
// verbatim.
// -----------------------------------------------------------

test("URL metadata is fetched and used verbatim", async () => {
  process.env.IDP_METADATA = `${stubOrigin}/metadata`;

  const setup = await createSamlSetup();
  assert.equal(setup.idpSource, `${stubOrigin}/metadata`);
  const { context } = await setup.spFor("https://app.example").createLoginRequest(setup.idp, "redirect");
  assert.ok(context.startsWith("https://sso.vu.lt/SSO/saml2/idp/SSOService.php?"));
});







// -----------------------------------------------------------
// SP identity per request origin
// -----------------------------------------------------------
//
// Entity id and ACS hang off whatever origin the request
// arrived on, and each origin gets its own memoized SP.
// -----------------------------------------------------------

test("identity per request origin, one memoized SP each", async () => {
  process.env.IDP_METADATA = VU_FIXTURE;

  const setup = await createSamlSetup();
  assert.equal(setup.spEntityIdOverride, null);
  assert.equal(setup.acsPath, setup.defaultAcsPath);
  assert.deepEqual(setup.identityFor("https://veiklos.knf.vu.lt"), {
    spEntityId: `https://veiklos.knf.vu.lt${SAML_BASE_PATH}/metadata`,
    acsUrl: `https://veiklos.knf.vu.lt${SAML_BASE_PATH}/assert`,
  });
  assert.deepEqual(setup.identityFor("http://dev.local:8080"), {
    spEntityId: `http://dev.local:8080${SAML_BASE_PATH}/metadata`,
    acsUrl: `http://dev.local:8080${SAML_BASE_PATH}/assert`,
  });

  const a = setup.spFor("https://veiklos.knf.vu.lt");
  const b = setup.spFor("http://dev.local:8080");
  assert.notEqual(a, b);
  assert.equal(setup.spFor("https://veiklos.knf.vu.lt"), a);
  assert.ok(b.getMetadata().includes('entityID="http://dev.local:8080/auth/saml/metadata"'));
});







// -----------------------------------------------------------
// overrides — reusing lab.knf.vu.lt's registration
// -----------------------------------------------------------
//
// SP_ENTITY_ID / SP_ACS_URL pin the identity for every
// origin: the SP metadata carries lab's entity id and ACS
// whatever host asked, only the SLO callback follows the
// host, and acsPath is lab's path so index.js mounts the
// assert handler there.
// -----------------------------------------------------------

test("overrides: lab's entity id and ACS pinned for every origin", async () => {
  process.env.IDP_METADATA = VU_FIXTURE;
  process.env.SP_ENTITY_ID = LAB_ENTITY;
  process.env.SP_ACS_URL = LAB_ACS;

  const setup = await createSamlSetup();
  assert.equal(setup.spEntityIdOverride, LAB_ENTITY);
  assert.deepEqual(setup.identityFor("https://kitas.example"), { spEntityId: LAB_ENTITY, acsUrl: LAB_ACS });
  assert.equal(setup.acsPath, "/simplesaml/module.php/saml/sp/saml2-acs.php/default-sp");
  assert.equal(setup.defaultAcsPath, "/auth/saml/assert");

  const md = setup.spFor("https://kitas.example").getMetadata();
  assert.ok(md.includes(`entityID="${LAB_ENTITY}"`));
  assert.ok(md.includes(`Location="${LAB_ACS}"`));
  assert.ok(md.includes('Location="https://kitas.example/auth/saml/logout/callback"'));
});







// -----------------------------------------------------------
// missing metadata
// -----------------------------------------------------------
//
// No IDP_METADATA at all → a pointed boot error; an
// unreachable URL → an error naming it.
// -----------------------------------------------------------

test("no IDP_METADATA → pointed boot error; dead URL → error", async () => {
  await assert.rejects(() => createSamlSetup(), /IDP_METADATA is required/);

  const dead = http.createServer();
  dead.listen(0, "127.0.0.1");
  await once(dead, "listening");
  const deadUrl = `http://127.0.0.1:${dead.address().port}/metadata`;
  await new Promise((r) => dead.close(r));
  process.env.IDP_METADATA = deadUrl;
  await assert.rejects(() => createSamlSetup());
});







// -----------------------------------------------------------
// signed requests — the key demand
// -----------------------------------------------------------
//
// An IdP that wants signed AuthnRequests makes boot fail
// with a pointed error when SP_PRIVATE_KEY_PATH is unset.
// VU SSO does not ask for it — this pins the dormant path.
// -----------------------------------------------------------

test("IdP wanting signed requests + no key path → pointed boot error", async () => {
  stubWantsSigned = true;
  process.env.IDP_METADATA = `${stubOrigin}/metadata`;

  await assert.rejects(
    () => createSamlSetup(),
    /SP_PRIVATE_KEY_PATH is required when IdP expects signed AuthnRequests/
  );
});







// -----------------------------------------------------------
// mapSamlAttributes — VU SSO OIDs
// -----------------------------------------------------------
//
// The attribute set VU SSO releases (as lab.knf.vu.lt
// consumes it): uid, mail, givenName, sn by OID — and samlify
// hands multi-valued attributes over as arrays, so the first
// value is taken.
// -----------------------------------------------------------

test("mapper: VU SSO OIDs, array values", () => {
  const m = mapSamlAttributes({
    "urn:oid:0.9.2342.19200300.100.1.1": "jonas.jonaitis",
    "urn:oid:0.9.2342.19200300.100.1.3": ["jonas.jonaitis@knf.vu.lt", "alias@vu.lt"],
    "urn:oid:2.5.4.42": ["Jonas"],
    "urn:oid:2.5.4.4": "Jonaitis",
  });
  assert.deepEqual(m, {
    oid: "jonas.jonaitis",
    email: "jonas.jonaitis@knf.vu.lt",
    firstName: "Jonas",
    lastName: "Jonaitis",
    name: "Jonas Jonaitis",
  });
});







// -----------------------------------------------------------
// mapSamlAttributes — friendly names and priority
// -----------------------------------------------------------
//
// uid/mail/givenName/sn friendly names work too, and when a
// bag carries both spellings the OID wins.
// -----------------------------------------------------------

test("mapper: friendly names, and OIDs win over friendly names", () => {
  assert.deepEqual(
    mapSamlAttributes({ uid: "u1", mail: "u1@vu.lt", givenName: "Ona", sn: "Onaitė" }),
    { oid: "u1", email: "u1@vu.lt", firstName: "Ona", lastName: "Onaitė", name: "Ona Onaitė" }
  );

  const both = mapSamlAttributes({ uid: "friendly", "urn:oid:0.9.2342.19200300.100.1.1": "vu-uid" });
  assert.equal(both.oid, "vu-uid");
  assert.equal(ATTRIBUTE_ALIASES.oid[0], "urn:oid:0.9.2342.19200300.100.1.1");
});







// -----------------------------------------------------------
// mapSamlAttributes — missing and empty
// -----------------------------------------------------------
//
// Empty strings and empty arrays count as absent; a missing
// bag yields all nulls, and a lone surname makes the name
// without a stray space.
// -----------------------------------------------------------

test("mapper: empties are nulls, partial names join cleanly", () => {
  assert.deepEqual(mapSamlAttributes(undefined), {
    oid: null, email: null, firstName: null, lastName: null, name: null,
  });
  const m = mapSamlAttributes({ "urn:oid:0.9.2342.19200300.100.1.1": "", uid: "fallback", mail: [], sn: "Kazlauskaitė" });
  assert.equal(m.oid, "fallback");
  assert.equal(m.email, null);
  assert.equal(m.name, "Kazlauskaitė");
});







// -----------------------------------------------------------
// enrichSpMetadata — the FEDI blocks
// -----------------------------------------------------------
//
// The registration blocks (SP_INFO, fixed in code) land
// inside the descriptor, and the requested attributes are
// exactly VU SSO's four — uid and mail required. No privacy
// URL is set, so that element is omitted.
// -----------------------------------------------------------

test("enrichSpMetadata: mdui, uid+mail required, organization, contact", () => {
  const xml = enrichSpMetadata(
    '<EntityDescriptor><SPSSODescriptor protocolSupportEnumeration="x"></SPSSODescriptor></EntityDescriptor>'
  );
  assert.ok(xml.includes(`<mdui:DisplayName xml:lang="en">${SP_INFO.displayName}</mdui:DisplayName>`));
  assert.ok(xml.includes("Veiklų registravimo sistema"));
  assert.ok(!xml.includes("PrivacyStatementURL"));
  assert.ok(xml.includes('Name="urn:oid:0.9.2342.19200300.100.1.1" FriendlyName="uid" isRequired="true"'));
  assert.ok(xml.includes('Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="mail" isRequired="true"'));
  assert.ok(xml.includes('FriendlyName="givenName" isRequired="false"'));
  assert.ok(xml.includes('FriendlyName="sn" isRequired="false"'));
  assert.ok(xml.includes("<OrganizationName xml:lang=\"en\">Vilnius University Kaunas Faculty</OrganizationName>"));
  assert.ok(xml.includes("<OrganizationURL xml:lang=\"en\">https://www.knf.vu.lt</OrganizationURL>"));
  assert.ok(xml.includes("mailto:admin@knf.vu.lt"));
  assert.ok(xml.indexOf("<Extensions>") < xml.indexOf("</SPSSODescriptor>"));
  assert.ok(xml.indexOf("<ContactPerson") < xml.indexOf("</EntityDescriptor>"));
});
