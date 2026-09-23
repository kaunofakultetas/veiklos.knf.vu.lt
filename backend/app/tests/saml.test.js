// -----------------------------------------------------------
//  [*] Regression — utils/saml.js (SP setup + attribute map)
//
//  Drives createSamlSetup against the real sso.vu.lt
//  descriptor checked into fixtures/ (as a file and, via a
//  stub server, as a URL). Pins the per-origin SP identity,
//  the mandatory SP key pair
//  (signing + encryption KeyDescriptors, signed requests),
//  the whole encrypted-assertion path against a FAKE IdP
//  built from a throwaway key pair, the missing-metadata and
//  missing-key boot errors, the attribute mapper for VU's
//  OIDs and friendly names, and the LitNET FEDI enrichment.
//
//  The key pairs in fixtures/ (fake-idp.*, fake-sp.*) are
//  test-only, generated for this suite — never registered
//  anywhere.
// -----------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";
import path from "node:path";
import { once } from "node:events";
import * as saml from "samlify";
import {
  SAML_BASE_PATH,
  CLOCK_DRIFT_MS,
  SP_INFO,
  ATTRIBUTE_ALIASES,
  mapSamlAttributes,
  withNestedNameIds,
  enrichSpMetadata,
  createSamlSetup,
} from "../src/utils/saml.js";


// The real VU SSO IdP descriptor (public), as a file path
const VU_FIXTURE = new URL("./fixtures/idp-metadata.xml", import.meta.url).pathname;

// Test-only key pairs (see the header)
const FIX = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const FAKE_SP_KEY = FIX("fake-sp.key");
const FAKE_SP_CERT = FIX("fake-sp.crt");
const FAKE_IDP_KEY = fs.readFileSync(FIX("fake-idp.key"), "utf8");
const FAKE_IDP_CERT = fs.readFileSync(FIX("fake-idp.crt"), "utf8");

// The fake IdP's identity and where its descriptor is written
// for IDP_METADATA
const FAKE_IDP_ENTITY = "https://idp.test.local/metadata";
const FAKE_IDP_FILE = path.join(os.tmpdir(), `fake-idp-${process.pid}.xml`);

// Every env key createSamlSetup / enrichSpMetadata read —
// wiped before each test so nothing leaks between tests
const SAML_ENV = [
  "IDP_METADATA", "SP_PRIVATE_KEY_PATH", "SP_CERT_PATH",
];

let stub;
let stubOrigin;







// -----------------------------------------------------------
// stubMetadata
// -----------------------------------------------------------
//
// The VU descriptor verbatim, served over HTTP for the URL
// form of IDP_METADATA.
//
// Used by:
//   - the stub server (below)
// -----------------------------------------------------------

function stubMetadata() {
  return fs.readFileSync(VU_FIXTURE, "utf8");
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
  // The key pair is mandatory — every test starts with one
  process.env.SP_PRIVATE_KEY_PATH = FAKE_SP_KEY;
  process.env.SP_CERT_PATH = FAKE_SP_CERT;
});







// -----------------------------------------------------------
// fakeIdp
// -----------------------------------------------------------
//
// A samlify IdentityProvider standing in for VU SSO: its own
// (test-only) key pair, assertions encrypted like VU's when
// `encrypted` is true. Its descriptor is written to
// FAKE_IDP_FILE so createSamlSetup loads it like the real
// one. loginResponseFor() mints a signed (and encrypted)
// response for our SP carrying VU's attribute set.
//
// Used by:
//   - the encrypted-assertion tests (below)
// -----------------------------------------------------------

function fakeIdp({ encrypted }) {
  const idp = saml.IdentityProvider({
    entityID: FAKE_IDP_ENTITY,
    privateKey: FAKE_IDP_KEY,
    signingCert: FAKE_IDP_CERT,
    isAssertionEncrypted: encrypted,
    wantLogoutRequestSigned: true,
    nameIDFormat: ["urn:oasis:names:tc:SAML:2.0:nameid-format:transient"],
    singleSignOnService: [
      { Binding: saml.Constants.namespace.binding.redirect, Location: "https://idp.test.local/sso" },
    ],
    singleLogoutService: [
      { Binding: saml.Constants.namespace.binding.redirect, Location: "https://idp.test.local/slo" },
    ],
    // Handing samlify its own default template makes it call
    // our tag replacement, where the attributes go in
    loginResponseTemplate: { context: saml.SamlLib.defaultLoginResponseTemplate.context },
  });
  fs.writeFileSync(FAKE_IDP_FILE, idp.getMetadata());

  const loginResponseFor = async (sp, { audience, attributes, skewMs = 0 }) => {
    // skewMs shifts the IdP's clock: its "now" and the whole
    // validity window move together
    const now = new Date(Date.now() + skewMs);
    const later = new Date(now.getTime() + 5 * 60 * 1000);
    const acs = sp.entityMeta.getAssertionConsumerService("post");
    // A value starting with "<" is emitted as-is (a nested
    // element), anything else as an xs:string
    const attrs = Object.entries(attributes)
      .map(([name, value]) =>
        `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">` +
        (String(value).startsWith("<")
          ? `<saml:AttributeValue>${value}</saml:AttributeValue>`
          : `<saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">${value}</saml:AttributeValue>`) +
        `</saml:Attribute>`)
      .join("");
    const { context } = await idp.createLoginResponse(
      sp,
      { extract: { request: { id: "_req-1" } } },
      "post",
      {},
      (template) => ({
        id: "_resp-1",
        context: saml.SamlLib.replaceTagsByValue(template, {
          ID: "_resp-1",
          AssertionID: "_assertion-1",
          Destination: acs,
          Audience: audience ?? sp.entityMeta.getEntityID(),
          SubjectRecipient: acs,
          Issuer: FAKE_IDP_ENTITY,
          IssueInstant: now.toISOString(),
          StatusCode: "urn:oasis:names:tc:SAML:2.0:status:Success",
          ConditionsNotBefore: now.toISOString(),
          ConditionsNotOnOrAfter: later.toISOString(),
          SubjectConfirmationDataNotOnOrAfter: later.toISOString(),
          NameIDFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
          NameID: "_nameid-1",
          InResponseTo: "_req-1",
          AuthnStatement: `<saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_session-1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`,
          AttributeStatement: `<saml:AttributeStatement>${attrs}</saml:AttributeStatement>`,
        }),
      })
    );
    return context;
  };

  return { idp, loginResponseFor };
}

after(() => fs.rmSync(FAKE_IDP_FILE, { force: true }));







// -----------------------------------------------------------
// file metadata — VU IdP, unsigned requests, login target
// -----------------------------------------------------------
//
// IDP_METADATA as a path: the VU IdP parses, requests stay
// unsigned (no key needed), the SP metadata for an origin
// carries that origin's entity id / ACS / SLO, and the login
// redirect goes straight to sso.vu.lt.
// -----------------------------------------------------------

test("file metadata: VU IdP parsed, SP metadata carries both keys, signed login at sso.vu.lt", async () => {
  process.env.IDP_METADATA = VU_FIXTURE;

  const setup = await createSamlSetup();

  assert.equal(setup.idpSource, VU_FIXTURE);
  assert.equal(setup.idpEntityId, "https://sso.vu.lt/saml/saml2/idp/metadata.php");
  assert.match(setup.spCertFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

  const sp = setup.spFor("https://veiklos.knf.vu.lt");
  const md = sp.getMetadata();
  assert.ok(md.includes('entityID="https://veiklos.knf.vu.lt/auth/saml/metadata"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/assert"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/logout/callback"'));

  // What VU registers: our certificate for signing AND
  // encryption, and the flags that make the IdP sign
  // assertions and expect signed requests
  const certBody = fs.readFileSync(FAKE_SP_CERT, "utf8").replace(/-----[^-]+-----|\s/g, "");
  assert.ok(md.includes('use="signing"') && md.includes('use="encryption"'));
  assert.equal(md.split(certBody).length - 1, 2, "the SP certificate appears once per use");
  assert.ok(md.includes('AuthnRequestsSigned="true"') && md.includes('WantAssertionsSigned="true"'));

  // VU's descriptor does not say WantAuthnRequestsSigned, yet
  // the IdP validates every message — the request is signed
  // regardless (requireSignedRequests)
  assert.ok(!fs.readFileSync(VU_FIXTURE, "utf8").includes("WantAuthnRequestsSigned"));
  const { context } = await sp.createLoginRequest(setup.idp, "redirect");
  assert.ok(
    context.startsWith("https://sso.vu.lt/saml/module.php/saml/idp/singleSignOnService?"),
    "login must redirect to the VU IdP, got " + context
  );
  const params = new URL(context).searchParams;
  assert.ok(params.get("Signature"), "the AuthnRequest is signed");
  assert.equal(params.get("SigAlg"), "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");

  // The request asks for a TRANSIENT NameID — what VU's
  // SimpleSAMLphp issues; asking for persistent made it fail
  const inflated = zlib.inflateRawSync(Buffer.from(params.get("SAMLRequest"), "base64")).toString();
  assert.match(inflated, /NameIDPolicy[^>]*Format="urn:oasis:names:tc:SAML:2.0:nameid-format:transient"/);
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
  assert.ok(context.startsWith("https://sso.vu.lt/saml/module.php/saml/idp/singleSignOnService?"));
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
// the SP key pair is mandatory
// -----------------------------------------------------------
//
// Without a key there is nothing to decrypt VU's assertions
// with, so boot fails with a pointed error naming the env
// var — for the key and for the certificate alike.
// -----------------------------------------------------------

test("no SP_PRIVATE_KEY_PATH / SP_CERT_PATH → pointed boot error", async () => {
  process.env.IDP_METADATA = VU_FIXTURE;

  delete process.env.SP_PRIVATE_KEY_PATH;
  await assert.rejects(() => createSamlSetup(), /SP_PRIVATE_KEY_PATH is required: the SP key pair/);

  process.env.SP_PRIVATE_KEY_PATH = FAKE_SP_KEY;
  delete process.env.SP_CERT_PATH;
  await assert.rejects(() => createSamlSetup(), /SP_CERT_PATH is required/);
});







// -----------------------------------------------------------
// encrypted assertion — the whole path
// -----------------------------------------------------------
//
// A fake IdP encrypts an assertion for OUR certificate and
// signs it with ITS key; our SP (built by createSamlSetup
// from the fake IdP's descriptor) verifies the signature,
// decrypts, and hands back VU's attributes, the audience
// and the session index. This is the production flow with
// VU's key swapped for a throwaway one.
// -----------------------------------------------------------

test("encrypted + signed assertion from the fake IdP decrypts into attributes and audience", async () => {
  const { loginResponseFor } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;

  const setup = await createSamlSetup();
  assert.equal(setup.idpEntityId, FAKE_IDP_ENTITY);
  const sp = setup.spFor("https://veiklos.knf.vu.lt");

  const samlResponse = await loginResponseFor(sp, {
    attributes: {
      "urn:oid:0.9.2342.19200300.100.1.1": "vu12345",
      "urn:oid:0.9.2342.19200300.100.1.3": "jonas.jonaitis@knf.vu.lt",
      "urn:oid:2.5.4.42": "Jonas",
      "urn:oid:2.5.4.4": "Jonaitis",
    },
  });
  assert.ok(Buffer.from(samlResponse, "base64").toString().includes("EncryptedAssertion"), "the wire form is encrypted");

  const { extract } = await sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: samlResponse } });
  assert.equal(extract.audience, "https://veiklos.knf.vu.lt/auth/saml/metadata");
  assert.equal(extract.nameID, "_nameid-1");
  assert.equal(extract.sessionIndex.sessionIndex, "_session-1");
  assert.deepEqual(mapSamlAttributes(extract.attributes), {
    oid: "vu12345",
    email: "jonas.jonaitis@knf.vu.lt",
    firstName: "Jonas",
    lastName: "Jonaitis",
    name: "Jonas Jonaitis",
  });
});







// -----------------------------------------------------------
// encrypted assertion — VU test IdP's actual release
// -----------------------------------------------------------
//
// The four attributes VU's TEST IdP really sends, in the
// shape SimpleSAMLphp emits them: sn, givenName, mail as
// strings and eduPersonTargetedID as a NESTED NameID element.
// samlify hands that last one over as [] — withNestedNameIds
// recovers it from the decrypted assertion, and the mapper
// keys the user on it. This is the login that failed with
// "missing oid or email" against the real test IdP.
// -----------------------------------------------------------

test("VU test IdP release: eduPersonTargetedID as a nested NameID keys the user", async () => {
  const { loginResponseFor } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");

  const samlResponse = await loginResponseFor(sp, {
    attributes: {
      "urn:oid:2.5.4.4": "Jonaitis",
      "urn:oid:2.5.4.42": "Jonas",
      "urn:oid:0.9.2342.19200300.100.1.3": "jonas.jonaitis@knf.vu.lt",
      "urn:oid:1.3.6.1.4.1.5923.1.1.1.10":
        '<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent" ' +
        'NameQualifier="https://sso.test.vu.lt/SSO/saml2/idp/metadata.php" ' +
        'SPNameQualifier="https://veiklos.knf.vu.lt/auth/saml/metadata">a1b2c3d4e5f6</saml:NameID>',
    },
  });
  const { samlContent, extract } = await sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: samlResponse } });

  // what samlify alone gives — the pairwise id is lost
  assert.deepEqual(extract.attributes["urn:oid:1.3.6.1.4.1.5923.1.1.1.10"], []);
  assert.equal(mapSamlAttributes(extract.attributes).oid, null);

  // what /assert does with it — samlContent is still the
  // encrypted wire form, the helper decrypts it again
  assert.ok(samlContent.includes("EncryptedAssertion"));
  const attributes = await withNestedNameIds(sp, extract.attributes, samlContent);
  assert.equal(attributes["urn:oid:1.3.6.1.4.1.5923.1.1.1.10"], "a1b2c3d4e5f6");
  assert.deepEqual(mapSamlAttributes(attributes), {
    oid: "a1b2c3d4e5f6",
    email: "jonas.jonaitis@knf.vu.lt",
    firstName: "Jonas",
    lastName: "Jonaitis",
    name: "Jonas Jonaitis",
  });
});







// -----------------------------------------------------------
// encrypted assertion — clock skew
// -----------------------------------------------------------
//
// The IdP's clock a couple of minutes AHEAD of ours puts the
// assertion's NotBefore in our future; within CLOCK_DRIFT_MS
// it is accepted, beyond it refused. samlify's zero default
// refused VU's real assertions for a skew of seconds.
// -----------------------------------------------------------

test("clock skew: an assertion from an IdP 2 min ahead is accepted, 10 min ahead is refused", async () => {
  const { loginResponseFor } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");
  const attributes = { uid: "u1", mail: "u1@vu.lt" };

  assert.equal(CLOCK_DRIFT_MS, 5 * 60 * 1000);

  const ahead2 = await loginResponseFor(sp, { attributes, skewMs: 2 * 60 * 1000 });
  const ok = await sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: ahead2 } });
  assert.equal(ok.extract.attributes.uid, "u1");

  const ahead10 = await loginResponseFor(sp, { attributes, skewMs: 10 * 60 * 1000 });
  await assert.rejects(
    () => sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: ahead10 } }),
    /ERR_SUBJECT_UNCONFIRMED/
  );
});







// -----------------------------------------------------------
// encrypted assertion — refusals
// -----------------------------------------------------------
//
// A PLAINTEXT assertion (the IdP forgot to encrypt) is
// refused outright, and so is one encrypted for us but
// signed by a key that is not in the IdP descriptor we
// loaded.
// -----------------------------------------------------------

test("plaintext assertion, or one signed by a stranger → refused", async () => {
  const plain = fakeIdp({ encrypted: false });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  let setup = await createSamlSetup();
  let sp = setup.spFor("https://veiklos.knf.vu.lt");
  const plainResponse = await plain.loginResponseFor(sp, { attributes: { uid: "u1" } });
  await assert.rejects(() => sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: plainResponse } }));

  // Swap the signer's certificate in the descriptor for the
  // SP's own, so the signature no longer verifies
  const encrypted = fakeIdp({ encrypted: true });
  const encryptedResponse = await encrypted.loginResponseFor(sp, { attributes: { uid: "u1" } });
  const idpCertBody = FAKE_IDP_CERT.replace(/-----[^-]+-----|\s/g, "");
  const spCertBody = fs.readFileSync(FAKE_SP_CERT, "utf8").replace(/-----[^-]+-----|\s/g, "");
  fs.writeFileSync(FAKE_IDP_FILE, fs.readFileSync(FAKE_IDP_FILE, "utf8").split(idpCertBody).join(spCertBody));
  setup = await createSamlSetup();
  sp = setup.spFor("https://veiklos.knf.vu.lt");
  await assert.rejects(() => sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: encryptedResponse } }));
});







// -----------------------------------------------------------
// mapSamlAttributes — VU SSO OIDs
// -----------------------------------------------------------
//
// The attribute set VU SSO releases: uid, mail, givenName,
// sn by OID — and samlify
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

  // VU's description spells the personnel number "UID" —
  // friendly names match regardless of case
  assert.deepEqual(
    mapSamlAttributes({ UID: "vu12345", Mail: "j@vu.lt", GivenName: "Jonas", SN: "Jonaitis" }),
    { oid: "vu12345", email: "j@vu.lt", firstName: "Jonas", lastName: "Jonaitis", name: "Jonas Jonaitis" }
  );

  // VU's TEST IdP releases eduPersonTargetedID and no uid —
  // the pairwise id keys the user, but uid wins when present
  const testIdp = mapSamlAttributes({
    "urn:oid:2.5.4.4": "Jonaitis",
    "urn:oid:2.5.4.42": "Jonas",
    "urn:oid:0.9.2342.19200300.100.1.3": "j@vu.lt",
    "urn:oid:1.3.6.1.4.1.5923.1.1.1.10": "a1b2c3-pairwise",
  });
  assert.equal(testIdp.oid, "a1b2c3-pairwise");
  assert.equal(testIdp.email, "j@vu.lt");
  assert.equal(
    mapSamlAttributes({ "urn:oid:0.9.2342.19200300.100.1.1": "vu12345", "urn:oid:1.3.6.1.4.1.5923.1.1.1.10": "a1b2c3" }).oid,
    "vu12345"
  );
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
