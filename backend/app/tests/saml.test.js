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
//  OIDs and friendly names, the LitNET FEDI enrichment, and
//  the logout leg with real signatures: our LogoutRequest,
//  the IdP's LogoutResponse and an IdP-initiated
//  LogoutRequest verified over the raw octet string
//  (logoutOctetString), our signed answer verified back at
//  the fake IdP.
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
  enrichSpMetadata,
  createSamlSetup,
  logoutOctetString,
  logoutRequestTags,
  LOGOUT_REQUEST_TEMPLATE,
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
// one. Like VU it signs its logout messages and demands
// signed ones back. loginResponseFor() mints a signed (and
// encrypted) response for our SP carrying VU's attribute set.
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
    wantLogoutResponseSigned: true,
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
    const attrs = Object.entries(attributes)
      .map(([name, value]) =>
        `<saml:Attribute Name="${name}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri"><saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">${value}</saml:AttributeValue></saml:Attribute>`)
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
      eID: "112546",
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
    eid: "112546",
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
  const attributes = { eID: "112546", mail: "u1@vu.lt" };

  assert.equal(CLOCK_DRIFT_MS, 5 * 60 * 1000);

  const ahead2 = await loginResponseFor(sp, { attributes, skewMs: 2 * 60 * 1000 });
  const ok = await sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: ahead2 } });
  assert.equal(ok.extract.attributes.eID, "112546");

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
  const plainResponse = await plain.loginResponseFor(sp, { attributes: { eID: "112546" } });
  await assert.rejects(() => sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: plainResponse } }));

  // Swap the signer's certificate in the descriptor for the
  // SP's own, so the signature no longer verifies
  const encrypted = fakeIdp({ encrypted: true });
  const encryptedResponse = await encrypted.loginResponseFor(sp, { attributes: { eID: "112546" } });
  const idpCertBody = FAKE_IDP_CERT.replace(/-----[^-]+-----|\s/g, "");
  const spCertBody = fs.readFileSync(FAKE_SP_CERT, "utf8").replace(/-----[^-]+-----|\s/g, "");
  fs.writeFileSync(FAKE_IDP_FILE, fs.readFileSync(FAKE_IDP_FILE, "utf8").split(idpCertBody).join(spCertBody));
  setup = await createSamlSetup();
  sp = setup.spFor("https://veiklos.knf.vu.lt");
  await assert.rejects(() => sp.parseLoginResponse(setup.idp, "post", { body: { SAMLResponse: encryptedResponse } }));
});







// -----------------------------------------------------------
// mapSamlAttributes — VU SSO attributes
// -----------------------------------------------------------
//
// The attribute set VU SSO releases: eID by its own name,
// mail, givenName, sn by OID — and samlify hands
// multi-valued attributes over as arrays, so the first
// value is taken.
// -----------------------------------------------------------

test("mapper: VU SSO attributes, array values", () => {
  const m = mapSamlAttributes({
    eID: "112546",
    "urn:oid:0.9.2342.19200300.100.1.3": ["jonas.jonaitis@knf.vu.lt", "alias@vu.lt"],
    "urn:oid:2.5.4.42": ["Jonas"],
    "urn:oid:2.5.4.4": "Jonaitis",
  });
  assert.deepEqual(m, {
    eid: "112546",
    email: "jonas.jonaitis@knf.vu.lt",
    firstName: "Jonas",
    lastName: "Jonaitis",
    name: "Jonas Jonaitis",
  });
});







// -----------------------------------------------------------
// mapSamlAttributes — friendly names, case, and eID only
// -----------------------------------------------------------
//
// mail/givenName/sn friendly names work too, matched
// regardless of case, and the OID wins when a bag carries
// both spellings. The user key is eID alone: uid and
// eduPersonTargetedID, however present, never fill eid.
// -----------------------------------------------------------

test("mapper: friendly names any case, OIDs win, eID is the only key", () => {
  assert.deepEqual(
    mapSamlAttributes({ eid: "112546", Mail: "u1@vu.lt", GivenName: "Ona", SN: "Onaitė" }),
    { eid: "112546", email: "u1@vu.lt", firstName: "Ona", lastName: "Onaitė", name: "Ona Onaitė" }
  );

  const both = mapSamlAttributes({ mail: "friendly@vu.lt", "urn:oid:0.9.2342.19200300.100.1.3": "eid@vu.lt" });
  assert.equal(both.email, "eid@vu.lt");
  assert.deepEqual(ATTRIBUTE_ALIASES.eid, ["eID"]);

  const withoutEid = mapSamlAttributes({
    "urn:oid:0.9.2342.19200300.100.1.1": "vu12345",
    "urn:oid:1.3.6.1.4.1.5923.1.1.1.10": "a1b2c3-pairwise",
    uid: "vu12345",
    eduPersonTargetedID: "a1b2c3",
    mail: "j@vu.lt",
  });
  assert.equal(withoutEid.eid, null);
  assert.equal(withoutEid.email, "j@vu.lt");
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
    eid: null, email: null, firstName: null, lastName: null, name: null,
  });
  const m = mapSamlAttributes({ eID: "", EID: "112546", mail: [], sn: "Kazlauskaitė" });
  assert.equal(m.eid, "112546");
  assert.equal(m.email, null);
  assert.equal(m.name, "Kazlauskaitė");
});







// -----------------------------------------------------------
// enrichSpMetadata — the FEDI blocks
// -----------------------------------------------------------
//
// The registration blocks (SP_INFO, fixed in code) land
// inside the descriptor, and the requested attributes are
// eID and mail required, givenName and sn optional. No
// privacy URL is set, so that element is omitted.
// -----------------------------------------------------------

test("enrichSpMetadata: mdui, eID+mail required, organization, contact", () => {
  const xml = enrichSpMetadata(
    '<EntityDescriptor><SPSSODescriptor protocolSupportEnumeration="x"></SPSSODescriptor></EntityDescriptor>'
  );
  assert.ok(xml.includes(`<mdui:DisplayName xml:lang="en">${SP_INFO.displayName}</mdui:DisplayName>`));
  assert.ok(xml.includes("Veiklų registravimo sistema"));
  assert.ok(!xml.includes("PrivacyStatementURL"));
  assert.ok(xml.includes('NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic" Name="eID" FriendlyName="eID" isRequired="true"'));
  assert.ok(!xml.includes('FriendlyName="uid"'));
  assert.ok(xml.includes('Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="mail" isRequired="true"'));
  assert.ok(xml.includes('FriendlyName="givenName" isRequired="false"'));
  assert.ok(xml.includes('FriendlyName="sn" isRequired="false"'));
  assert.ok(xml.includes("<OrganizationName xml:lang=\"en\">Vilnius University Kaunas Faculty</OrganizationName>"));
  assert.ok(xml.includes("<OrganizationURL xml:lang=\"en\">https://www.knf.vu.lt</OrganizationURL>"));
  assert.ok(xml.includes("mailto:admin@knf.vu.lt"));
  assert.ok(xml.indexOf("<Extensions>") < xml.indexOf("</SPSSODescriptor>"));
  assert.ok(xml.indexOf("<ContactPerson") < xml.indexOf("</EntityDescriptor>"));
});







// -----------------------------------------------------------
// redirectMessage
// -----------------------------------------------------------
//
// A redirect-binding URL turned into what the callback route
// hands samlify: the query as express parses it (decoded)
// plus the raw octet string cut from the URL by
// logoutOctetString.
//
// Used by:
//   - the logout tests (below)
// -----------------------------------------------------------

function redirectMessage(url) {
  const u = new URL(url);
  return {
    query: Object.fromEntries(u.searchParams.entries()),
    octetString: logoutOctetString({ originalUrl: u.pathname + u.search }),
  };
}







// -----------------------------------------------------------
// logoutOctetString
// -----------------------------------------------------------
//
// The signed part of a redirect-binding message: the raw
// query with the Signature parameter dropped and nothing
// else touched — order and percent-encoding survive, since
// re-encoding one character would break the signature.
// -----------------------------------------------------------

test("logoutOctetString: raw query minus Signature, encoding and order untouched", () => {
  const signed = "SAMLResponse=a%2Bb%3D&RelayState=x%20y&SigAlg=rsa%23sha256";
  assert.equal(logoutOctetString({ originalUrl: `/auth/saml/logout/callback?${signed}&Signature=zz%2F` }), signed);

  // Signature anywhere in the query; only that parameter goes
  assert.equal(logoutOctetString({ originalUrl: "/cb?Signature=zz&SAMLRequest=a&SigAlg=b" }), "SAMLRequest=a&SigAlg=b");
  assert.equal(logoutOctetString({ originalUrl: "/cb?SAMLRequest=a&XSignature=1&SigAlg=b&Signature=zz" }), "SAMLRequest=a&XSignature=1&SigAlg=b");

  // no query at all, and req.url as the fallback
  assert.equal(logoutOctetString({ originalUrl: "/auth/saml/logout/callback" }), "");
  assert.equal(logoutOctetString({ url: "/cb?SAMLRequest=a&Signature=s" }), "SAMLRequest=a");
});







// -----------------------------------------------------------
// our LogoutRequest
// -----------------------------------------------------------
//
// What /logout sends the IdP: a signed redirect to its SLO
// endpoint naming our entity id and the transient NameID
// from login — and the IdP, holding our certificate,
// verifies that signature.
// -----------------------------------------------------------

test("logout request: signed redirect to the IdP's SLO with our entity id and the transient NameID", async () => {
  const { idp } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");

  const { context } = await sp.createLogoutRequest(setup.idp, "redirect", { logoutNameID: "_nameid-1", sessionIndex: "_session-1" });
  const u = new URL(context);
  assert.equal(u.origin + u.pathname, "https://idp.test.local/slo");
  assert.deepEqual([...u.searchParams.keys()], ["SAMLRequest", "SigAlg", "Signature"]);
  assert.equal(u.searchParams.get("SigAlg"), "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");

  const xml = zlib.inflateRawSync(Buffer.from(u.searchParams.get("SAMLRequest"), "base64")).toString();
  assert.ok(xml.includes("<saml:Issuer>https://veiklos.knf.vu.lt/auth/saml/metadata</saml:Issuer>"));
  assert.ok(xml.includes('<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">_nameid-1</saml:NameID>'));

  const { extract } = await idp.parseLogoutRequest(sp, "redirect", redirectMessage(context));
  assert.equal(extract.nameID, "_nameid-1");
  assert.equal(extract.issuer, "https://veiklos.knf.vu.lt/auth/saml/metadata");
});







// -----------------------------------------------------------
// the IdP's LogoutResponse
// -----------------------------------------------------------
//
// The return leg of our logout: the IdP's signed response
// verifies against the certificate in its descriptor; a
// tampered octet string or a response stripped of its
// signature is refused.
// -----------------------------------------------------------

test("logout response from the IdP: verified; tampered or unsigned → refused", async () => {
  const { idp } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");

  const { context } = idp.createLogoutResponse(sp, { extract: { request: { id: "_our-req-1" } } }, "redirect", "");
  const message = redirectMessage(context);
  assert.ok(message.query.Signature, "the fake IdP signs, as VU does");

  const { extract } = await sp.parseLogoutResponse(setup.idp, "redirect", message);
  assert.equal(extract.response.inResponseTo, "_our-req-1");
  assert.equal(extract.issuer, FAKE_IDP_ENTITY);

  await assert.rejects(
    () => sp.parseLogoutResponse(setup.idp, "redirect", { ...message, octetString: message.octetString.replace("SAMLResponse=", "SAMLResponse=A") }),
    /ERR_FAILED_MESSAGE_SIGNATURE_VERIFICATION/
  );
  const { SigAlg, Signature, ...unsigned } = message.query;
  await assert.rejects(
    () => sp.parseLogoutResponse(setup.idp, "redirect", { query: unsigned, octetString: message.octetString.replace(/&SigAlg=.*$/, "") }),
    /ERR_MISSING_SIG_ALG/
  );
});







// -----------------------------------------------------------
// IdP-initiated logout
// -----------------------------------------------------------
//
// VU telling us the user signed out elsewhere: its signed
// LogoutRequest verifies, one signed by a stranger with the
// same entity id does not, and our answer — a LogoutResponse
// for that request, Success, the IdP's RelayState echoed,
// signed with the SP key — verifies back at the IdP.
// -----------------------------------------------------------

test("IdP-initiated logout: the request verifies, a stranger's does not, our signed answer verifies at the IdP", async () => {
  const { idp } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");

  const { context } = idp.createLogoutRequest(sp, "redirect", { logoutNameID: "_nameid-1" }, "RS-7");
  const message = redirectMessage(context);
  assert.equal(message.query.RelayState, "RS-7");

  const parsed = await sp.parseLogoutRequest(setup.idp, "redirect", message);
  assert.equal(parsed.extract.nameID, "_nameid-1");
  assert.equal(parsed.extract.issuer, FAKE_IDP_ENTITY);
  assert.match(parsed.extract.request.id, /^_/);

  // Same entity id, a different key: the SP's own pair
  // standing in for a stranger
  const stranger = saml.IdentityProvider({
    entityID: FAKE_IDP_ENTITY,
    privateKey: fs.readFileSync(FAKE_SP_KEY, "utf8"),
    signingCert: fs.readFileSync(FAKE_SP_CERT, "utf8"),
    wantLogoutRequestSigned: true,
    singleSignOnService: [
      { Binding: saml.Constants.namespace.binding.redirect, Location: "https://idp.test.local/sso" },
    ],
    singleLogoutService: [
      { Binding: saml.Constants.namespace.binding.redirect, Location: "https://idp.test.local/slo" },
    ],
  });
  const forged = stranger.createLogoutRequest(sp, "redirect", { logoutNameID: "_nameid-1" }, "RS-7");
  await assert.rejects(
    () => sp.parseLogoutRequest(setup.idp, "redirect", redirectMessage(forged.context)),
    /ERR_FAILED_MESSAGE_SIGNATURE_VERIFICATION/
  );

  const answer = sp.createLogoutResponse(setup.idp, parsed, "redirect", "RS-7");
  const u = new URL(answer.context);
  assert.equal(u.origin + u.pathname, "https://idp.test.local/slo");
  assert.deepEqual([...u.searchParams.keys()], ["SAMLResponse", "RelayState", "SigAlg", "Signature"]);
  assert.equal(u.searchParams.get("RelayState"), "RS-7");
  const xml = zlib.inflateRawSync(Buffer.from(u.searchParams.get("SAMLResponse"), "base64")).toString();
  assert.ok(xml.includes(`InResponseTo="${parsed.extract.request.id}"`));
  assert.ok(xml.includes('StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"'));
  assert.ok(xml.includes("<saml:Issuer>https://veiklos.knf.vu.lt/auth/saml/metadata</saml:Issuer>"));

  const { extract } = await idp.parseLogoutResponse(sp, "redirect", redirectMessage(answer.context));
  assert.equal(extract.response.inResponseTo, parsed.extract.request.id);
});







// -----------------------------------------------------------
// our LogoutRequest — SessionIndex
// -----------------------------------------------------------
//
// With the tag replacer the request is rendered from
// LOGOUT_REQUEST_TEMPLATE: the login's SessionIndex travels
// as its own element and the IdP reads it back; a login that
// carried none gets no element at all. Both forms still
// verify at the IdP, so the signature covers the rendered
// XML.
// -----------------------------------------------------------

test("logout request: SessionIndex is sent when the login had one, left out when not", async () => {
  const { idp } = fakeIdp({ encrypted: true });
  process.env.IDP_METADATA = FAKE_IDP_FILE;
  const setup = await createSamlSetup();
  const sp = setup.spFor("https://veiklos.knf.vu.lt");
  assert.ok(LOGOUT_REQUEST_TEMPLATE.includes("<samlp:SessionIndex>{SessionIndex}</samlp:SessionIndex>"));

  const withIndex = await sp.createLogoutRequest(
    setup.idp, "redirect", { logoutNameID: "_nameid-1", sessionIndex: "_session-1" }, "", logoutRequestTags
  );
  const xml = zlib.inflateRawSync(Buffer.from(new URL(withIndex.context).searchParams.get("SAMLRequest"), "base64")).toString();
  assert.ok(xml.includes("<samlp:SessionIndex>_session-1</samlp:SessionIndex>"));
  assert.ok(xml.includes('<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:transient">_nameid-1</saml:NameID>'));
  const parsed = await idp.parseLogoutRequest(sp, "redirect", redirectMessage(withIndex.context));
  assert.equal(parsed.extract.sessionIndex, "_session-1");
  assert.equal(parsed.extract.nameID, "_nameid-1");

  const without = await sp.createLogoutRequest(
    setup.idp, "redirect", { logoutNameID: "_nameid-1" }, "", logoutRequestTags
  );
  const bare = zlib.inflateRawSync(Buffer.from(new URL(without.context).searchParams.get("SAMLRequest"), "base64")).toString();
  assert.ok(!bare.includes("SessionIndex"));
  const parsedBare = await idp.parseLogoutRequest(sp, "redirect", redirectMessage(without.context));
  assert.equal(parsedBare.extract.nameID, "_nameid-1");
});
