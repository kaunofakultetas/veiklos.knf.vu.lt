// -----------------------------------------------------------
//  [*] Regression — utils/saml.js (SP setup + attribute map)
//
//  Drives createSamlSetup against the real sso.vu.lt
//  descriptor checked into fixtures/ (as a file and, via a
//  stub server, as a URL). Pins the per-origin SP identity,
//  the lab-registration overrides, the mandatory SP key pair
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
import path from "node:path";
import { once } from "node:events";
import * as saml from "samlify";
import {
  SAML_BASE_PATH,
  SP_INFO,
  ATTRIBUTE_ALIASES,
  mapSamlAttributes,
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

// lab.knf.vu.lt's registered identity — what the overrides
// reuse when the app is hosted on that domain
const LAB_ENTITY = "https://lab.knf.vu.lt";
const LAB_ACS = "https://lab.knf.vu.lt/simplesaml/module.php/saml/sp/saml2-acs.php/default-sp";

// Every env key createSamlSetup / enrichSpMetadata read —
// wiped before each test so nothing leaks between tests
const SAML_ENV = [
  "IDP_METADATA", "SP_ENTITY_ID", "SP_ACS_URL", "SP_PRIVATE_KEY_PATH", "SP_CERT_PATH",
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
  // The key pair is mandatory — every test starts with one
  process.env.SP_PRIVATE_KEY_PATH = FAKE_SP_KEY;
  process.env.SP_CERT_PATH = FAKE_SP_CERT;
  stubWantsSigned = false;
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

  const loginResponseFor = async (sp, { audience, attributes }) => {
    const now = new Date();
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
  assert.equal(setup.idpWantsSignedRequests, false);
  assert.match(setup.spCertFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

  const sp = setup.spFor("https://veiklos.knf.vu.lt");
  const md = sp.getMetadata();
  assert.ok(md.includes('entityID="https://veiklos.knf.vu.lt/auth/saml/metadata"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/assert"'));
  assert.ok(md.includes('Location="https://veiklos.knf.vu.lt/auth/saml/logout/callback"'));

  // What VU registers: our certificate for signing AND
  // encryption, and the flag that makes the IdP sign
  // assertions. AuthnRequests stay unsigned because VU's
  // descriptor does not ask for them (samlify follows the
  // IdP's WantAuthnRequestsSigned and refuses a mismatch)
  const certBody = fs.readFileSync(FAKE_SP_CERT, "utf8").replace(/-----[^-]+-----|\s/g, "");
  assert.ok(md.includes('use="signing"') && md.includes('use="encryption"'));
  assert.equal(md.split(certBody).length - 1, 2, "the SP certificate appears once per use");
  assert.ok(md.includes('AuthnRequestsSigned="false"') && md.includes('WantAssertionsSigned="true"'));

  const { context } = await sp.createLoginRequest(setup.idp, "redirect");
  assert.ok(
    context.startsWith("https://sso.vu.lt/saml/module.php/saml/idp/singleSignOnService?"),
    "login must redirect to the VU IdP, got " + context
  );
  assert.ok(!context.includes("&Signature="), "no signature while the IdP does not want one");
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
