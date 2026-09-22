// -----------------------------------------------------------
//  [*] Utils — SAML Service Provider setup
//
//  Builds the samlify SP/IdP pair the login flow runs on,
//  against VU SSO (https://sso.vu.lt, a SimpleSAMLphp IdP
//  registered with LitNET FEDI). Its public metadata lives in
//  _SAML/ and reaches the container via IDP_METADATA — a file
//  path (/app/certs/prod/idp-metadata.xml) or an http(s) URL.
//
//  The SP identity is derived from the origin each request
//  arrives on (scheme + Host as forwarded by the ingress), so
//  the app answers under any domain name — entity id
//  <origin>/auth/saml/metadata, ACS <origin>/auth/saml/assert.
//  One samlify SP is built per origin and memoized. Whatever
//  domain the app is hosted on, ITS metadata URL is what gets
//  registered with VU SSO.
//
//  The SP always carries a key pair (SP_PRIVATE_KEY_PATH /
//  SP_CERT_PATH, made by generateSamlKeys.sh): VU SSO
//  encrypts assertions with the certificate it finds in our
//  metadata, so the key decrypts them — a plaintext assertion
//  is refused — and the same pair signs every message we
//  send: AuthnRequests and logout messages alike. VU's IdP
//  validates the signature on everything it receives
//  (SimpleSAMLphp's redirect.validate) although its descriptor
//  never says WantAuthnRequestsSigned — see
//  requireSignedRequests. The certificate is what VU
//  registers; rotating it means re-registering.
//
//  The mdui/organization/contact enrichment exists for the
//  LitNET FEDI registration: the federation requires SP
//  metadata to carry display info, requested attributes and
//  a technical contact.
//
//  Config is read on every call (readConfig), not at import
//  — so tests can vary it in one process.
// -----------------------------------------------------------

import * as saml from "samlify";
import * as validator from "@authenio/samlify-node-xmllint";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";







// -----------------------------------------------------------
// SAML_BASE_PATH
// -----------------------------------------------------------
//
// The URL prefix the whole flow lives under; index.js mounts
// the router there and the default SP entity id / ACS / SLO
// URLs are all derived from it.
//
// Used by:
//   - createSamlSetup (below), routes/saml.js, index.js
// -----------------------------------------------------------

export const SAML_BASE_PATH = "/auth/saml";







// -----------------------------------------------------------
// SP_INFO
// -----------------------------------------------------------
//
// What the SP says about itself in its metadata — the
// display/organization/contact blocks LitNET FEDI requires
// for registration. Fixed facts about this system, so they
// live here rather than in env. privacyUrl "" omits the
// PrivacyStatementURL element.
//
// Used by:
//   - enrichSpMetadata (below)
// -----------------------------------------------------------

export const SP_INFO = {
  displayName:    "Veiklų registravimo sistema",
  description:    "Vilniaus Universiteto Kauno Fakulteto akademinių darbuotojų veiklų, skirtų studijų kokybei gerinti, registravimo informacinė sistema",
  privacyUrl:     "",
  orgName:        "Vilnius University Kaunas Faculty",
  orgDisplayName: "Vilnius University Kaunas Faculty",
  orgUrl:         "https://www.knf.vu.lt",
  contactEmail:   "admin@knf.vu.lt",
};







// -----------------------------------------------------------
// ATTRIBUTE_ALIASES
// -----------------------------------------------------------
//
// Every name each identity field may arrive under, in
// priority order: the OIDs VU SSO releases (uid, mail,
// givenName, sn), then their friendly names in case the IdP
// is ever configured to send those instead.
//
// Used by:
//   - mapSamlAttributes (below)
// -----------------------------------------------------------

export const ATTRIBUTE_ALIASES = {
  oid:       ["urn:oid:0.9.2342.19200300.100.1.1", "uid"],
  email:     ["urn:oid:0.9.2342.19200300.100.1.3", "mail"],
  firstName: ["urn:oid:2.5.4.42", "givenName"],
  lastName:  ["urn:oid:2.5.4.4", "sn"],
};







// -----------------------------------------------------------
// readConfig
// -----------------------------------------------------------
//
// One snapshot of every SAML-related env var. Called per
// setup, never cached. IDP_METADATA is the only required one
// — without it there is no IdP to talk to.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

function readConfig() {
  const env = process.env;
  return {
    idpMetadata:        env.IDP_METADATA || "",
    spNameIdFormat:     env.SP_NAME_ID_FORMAT ??
                          "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
    spPrivateKeyPath:   env.SP_PRIVATE_KEY_PATH,
    spCertPath:         env.SP_CERT_PATH,
  };
}







// -----------------------------------------------------------
// firstValue
// -----------------------------------------------------------
//
// samlify hands an attribute over as a string when the
// assertion carried one AttributeValue and as an array when
// it carried several — normalize to the first non-empty
// string, or null.
//
// Used by:
//   - mapSamlAttributes (below)
// -----------------------------------------------------------

function firstValue(value) {
  const v = Array.isArray(value) ? value.find((x) => x !== undefined && x !== null && x !== "") : value;
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}







// -----------------------------------------------------------
// mapSamlAttributes
// -----------------------------------------------------------
//
// The app's identity: { oid, email, firstName, lastName,
// name } from a raw samlify attribute bag (see
// ATTRIBUTE_ALIASES). oid is VU's uid — the stable username,
// NOT the NameID, which VU SSO issues as transient. Missing
// fields come back null; name is firstName + lastName with
// missing parts dropped, null when both are missing.
//
// Used by:
//   - routes/saml.js — POST /assert (the user upsert)
//   - auth/verifySamlSession.js — every guarded request
// -----------------------------------------------------------

export function mapSamlAttributes(attrs) {
  const bag = attrs || {};
  const pick = (field) => {
    for (const key of ATTRIBUTE_ALIASES[field]) {
      const v = firstValue(bag[key]);
      if (v !== null) return v;
    }
    return null;
  };

  const firstName = pick("firstName");
  const lastName = pick("lastName");
  const name = [firstName, lastName].filter(Boolean).join(" ") || null;

  return { oid: pick("oid"), email: pick("email"), firstName, lastName, name };
}







// -----------------------------------------------------------
// readRequiredFile
// -----------------------------------------------------------
//
// readFileSync with a pointed error naming the env var, so a
// missing SP key/cert explains itself at boot.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

function readRequiredFile(path, envName) {
  if (!path) {
    throw new Error(
      `${envName} is required: the SP key pair VU SSO encrypts for (see generateSamlKeys.sh)`,
    );
  }
  return readFileSync(path, "utf8");
}







// -----------------------------------------------------------
// loadIdpMetadata
// -----------------------------------------------------------
//
// The IdP's EntityDescriptor XML from IDP_METADATA: fetched
// when it is an http(s) URL, read as a file otherwise. The
// XML is used verbatim. Returns { xml, source } — source for
// the boot log.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

async function loadIdpMetadata(cfg) {
  if (!cfg.idpMetadata) {
    throw new Error(
      "IDP_METADATA is required: a file path or URL of the VU SSO IdP metadata (see _SAML/)",
    );
  }

  if (/^https?:\/\//i.test(cfg.idpMetadata)) {
    const response = await fetch(cfg.idpMetadata);
    if (!response.ok) {
      throw new Error(
        `Failed to load IdP metadata (${response.status} ${response.statusText}) from ${cfg.idpMetadata}`,
      );
    }
    return { xml: await response.text(), source: cfg.idpMetadata };
  }

  return { xml: readFileSync(cfg.idpMetadata, "utf8"), source: cfg.idpMetadata };
}







// -----------------------------------------------------------
// requireSignedRequests
// -----------------------------------------------------------
//
// The loaded IdP descriptor with WantAuthnRequestsSigned
// forced to "true" on its IDPSSODescriptor. samlify signs an
// AuthnRequest only when the IdP's descriptor asks for it
// (and refuses a mismatch), while VU's IdP demands signed
// messages without saying so in its metadata — the login
// died there with "Validation of received messages enabled,
// but no signature found". samlify never checks the
// descriptor's own signature, so the edit is safe.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

function requireSignedRequests(idpXml) {
  return idpXml.replace(
    /<(md:)?IDPSSODescriptor\b([^>]*?)(\s+WantAuthnRequestsSigned="[^"]*")?([^>]*)>/,
    '<$1IDPSSODescriptor$2 WantAuthnRequestsSigned="true"$4>'
  );
}







// -----------------------------------------------------------
// enrichSpMetadata
// -----------------------------------------------------------
//
// Injects the LitNET FEDI registration blocks (SP_INFO) into
// samlify's bare SP metadata via string surgery: mdui:UIInfo
// (display name / description / privacy), the requested
// attributes (uid + mail required, givenName/sn optional —
// the four VU SSO releases), the organization and the
// technical contact.
//
// Used by:
//   - routes/saml.js — GET /auth/saml/metadata
// -----------------------------------------------------------

export function enrichSpMetadata(rawXml) {
  const cfg = SP_INFO;

  const extensions = `<Extensions>
      <mdui:UIInfo xmlns:mdui="urn:oasis:names:tc:SAML:metadata:ui">
        <mdui:DisplayName xml:lang="en">${cfg.displayName}</mdui:DisplayName>
        <mdui:Description xml:lang="en">${cfg.description}</mdui:Description>
        ${cfg.privacyUrl ? `<mdui:PrivacyStatementURL xml:lang="en">${cfg.privacyUrl}</mdui:PrivacyStatementURL>` : ""}
      </mdui:UIInfo>
    </Extensions>`;

  const attributeConsumingService = `<AttributeConsumingService index="1">
      <ServiceName xml:lang="en">${cfg.displayName}</ServiceName>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:0.9.2342.19200300.100.1.1" FriendlyName="uid" isRequired="true"/>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="mail" isRequired="true"/>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:2.5.4.42" FriendlyName="givenName" isRequired="false"/>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:2.5.4.4" FriendlyName="sn" isRequired="false"/>
    </AttributeConsumingService>`;

  const organization = `<Organization>
      <OrganizationName xml:lang="en">${cfg.orgName}</OrganizationName>
      <OrganizationDisplayName xml:lang="en">${cfg.orgDisplayName}</OrganizationDisplayName>
      <OrganizationURL xml:lang="en">${cfg.orgUrl}</OrganizationURL>
    </Organization>`;

  const contactPerson = `<ContactPerson contactType="technical">
      <EmailAddress>mailto:${cfg.contactEmail}</EmailAddress>
    </ContactPerson>`;

  return rawXml
    .replace(/(<SPSSODescriptor[^>]*>)/, `$1${extensions}`)
    .replace("</SPSSODescriptor>", `${attributeConsumingService}</SPSSODescriptor>`)
    .replace("</EntityDescriptor>", `${organization}${contactPerson}</EntityDescriptor>`);
}







// -----------------------------------------------------------
// createSamlSetup
// -----------------------------------------------------------
//
// The boot-time factory index.js awaits: loads the IdP
// metadata and the SP key pair, and returns
//
//   idp             — the samlify IdentityProvider
//   spCertFingerprint — SHA-256 of the SP certificate, for
//                     the boot log / VU's registration form
//   identityFor(o)  — { spEntityId, acsUrl } for origin o
//                     (o + /auth/saml/{metadata,assert})
//   spFor(o)        — the samlify ServiceProvider for origin
//                     o, built on first use and memoized
//
// Used by:
//   - index.js — const samlSetup = await createSamlSetup()
// -----------------------------------------------------------

export async function createSamlSetup() {
  const cfg = readConfig();
  saml.setSchemaValidator(validator);

  const { xml: idpMetadata, source: idpSource } = await loadIdpMetadata(cfg);
  // isAssertionEncrypted here describes the IdP: samlify reads
  // it from the SENDER when deciding to decrypt, so without it
  // an encrypted response is judged unsigned and refused
  const idp = saml.IdentityProvider({
    metadata: requireSignedRequests(idpMetadata),
    isAssertionEncrypted: true,
    wantLogoutRequestSigned: true,
  });
  const spPrivateKey = readRequiredFile(cfg.spPrivateKeyPath, "SP_PRIVATE_KEY_PATH");
  const spCert = readRequiredFile(cfg.spCertPath, "SP_CERT_PATH");
  const spCertFingerprint = new X509Certificate(spCert).fingerprint256;

  const identityFor = (origin) => ({
    spEntityId: `${origin}${SAML_BASE_PATH}/metadata`,
    acsUrl: `${origin}${SAML_BASE_PATH}/assert`,
  });

  // One SP per origin
  const sps = new Map();
  const spFor = (origin) => {
    let sp = sps.get(origin);
    if (sp) return sp;

    const { spEntityId, acsUrl } = identityFor(origin);
    sp = saml.ServiceProvider({
      entityID: spEntityId,
      // Our side of the VU SSO contract: every request
      // signed, signed assertions expected, assertions
      // encrypted for the certificate we publish
      authnRequestsSigned: true,
      wantAssertionsSigned: true,
      isAssertionEncrypted: true,
      privateKey: spPrivateKey,
      signingCert: spCert,
      encPrivateKey: spPrivateKey,
      encryptCert: spCert,
      nameIDFormat: [
        "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
        "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
      ],
      assertionConsumerService: [
        {
          Binding: saml.Constants.namespace.binding.post,
          Location: acsUrl,
        },
      ],
      singleLogoutService: [
        {
          Binding: saml.Constants.namespace.binding.redirect,
          Location: `${origin}${SAML_BASE_PATH}/logout/callback`,
        },
      ],
    });
    sps.set(origin, sp);
    return sp;
  };

  return {
    idp,
    identityFor,
    spFor,
    idpSource,
    idpEntityId: idp.entityMeta.getEntityID(),
    spCertFingerprint,
    spNameIdFormat: cfg.spNameIdFormat,
  };
}
