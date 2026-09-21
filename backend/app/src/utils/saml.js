// -----------------------------------------------------------
//  [*] Utils — SAML Service Provider setup
//
//  Builds the samlify SP/IdP pair the login flow runs on.
//  Keycloak (the stack's own IdP) publishes SAML metadata;
//  loadIdpMetadata fetches it at boot and createSamlSetup
//  derives everything else from it — including whether
//  AuthnRequests must be signed, which decides whether the
//  SP certs in certs/ are loaded at all.
//
//  The mdui/organization/contact enrichment exists for the
//  LitNET FEDI registration: the federation requires SP
//  metadata to carry display info, requested attributes and
//  a technical contact.
// -----------------------------------------------------------

import * as saml from "samlify";
import * as validator from "@authenio/samlify-node-xmllint";
import { readFileSync } from "node:fs";







// -----------------------------------------------------------
// SAML_BASE_PATH
// -----------------------------------------------------------
//
// The URL prefix the whole flow lives under; index.js mounts
// the router there and the SP entity id / ACS / SLO URLs are
// all derived from it.
//
// Used by:
//   - createSamlSetup (below), routes/saml.js
// -----------------------------------------------------------

export const SAML_BASE_PATH = "/auth/saml";

// Keycloak endpoints and SP identity — all injected via env
// in docker-compose; the fallbacks only serve local runs
const KEYCLOAK_METADATA_URL =
    process.env.KEYCLOAK_METADATA_URL ??
    "http://localhost:8111/realms/master/protocol/saml/descriptor";
const KEYCLOAK_PUBLIC_BASE_URL = process.env.KEYCLOAK_PUBLIC_BASE_URL;
const SP_NAME_ID_FORMAT =
    process.env.SP_NAME_ID_FORMAT ??
    "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";
const SP_PRIVATE_KEY_PATH = process.env.SP_PRIVATE_KEY_PATH;
const SP_SIGNING_CERT_PATH = process.env.SP_SIGNING_CERT_PATH;

// LitNET FEDI registration fields for the SP metadata
const SP_DISPLAY_NAME     = process.env.SP_DISPLAY_NAME     ?? "My Service";
const SP_DESCRIPTION      = process.env.SP_DESCRIPTION      ?? "";
const SP_PRIVACY_URL      = process.env.SP_PRIVACY_URL      ?? "";
const SP_ORG_NAME         = process.env.SP_ORG_NAME         ?? "";
const SP_ORG_DISPLAY_NAME = process.env.SP_ORG_DISPLAY_NAME ?? "";
const SP_ORG_URL          = process.env.SP_ORG_URL          ?? "";
const SP_CONTACT_EMAIL    = process.env.SP_CONTACT_EMAIL    ?? "";







// -----------------------------------------------------------
// readRequiredFile
// -----------------------------------------------------------
//
// readFileSync with a pointed error naming the env var — the
// SP key/cert are only REQUIRED when the IdP demands signed
// AuthnRequests, so the message explains why booting failed.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

function readRequiredFile(path, envName) {
    if (!path) {
        throw new Error(
            `${envName} is required when IdP expects signed AuthnRequests`,
        );
    }
    return readFileSync(path, "utf8");
}







// -----------------------------------------------------------
// loadIdpMetadata
// -----------------------------------------------------------
//
// Fetches Keycloak's IdP metadata over the docker network,
// then rewrites the INTERNAL origin (http://keycloak:8080)
// to the PUBLIC one in every URL — the browser follows the
// redirect bindings in this metadata, and it can only reach
// Keycloak through the Caddy ingress.
//
// Used by:
//   - createSamlSetup (below)
// -----------------------------------------------------------

async function loadIdpMetadata() {
    const response = await fetch(KEYCLOAK_METADATA_URL);
    if (!response.ok) {
        throw new Error(
            `Failed to load Keycloak metadata (${response.status} ${response.statusText}) from ${KEYCLOAK_METADATA_URL}`,
        );
    }

    const metadata = await response.text();
    if (!KEYCLOAK_PUBLIC_BASE_URL) {
        return metadata;
    }

    const metadataOrigin = new URL(KEYCLOAK_METADATA_URL).origin;
    const publicOrigin = new URL(KEYCLOAK_PUBLIC_BASE_URL).origin;
    if (metadataOrigin === publicOrigin) {
        return metadata;
    }

    return metadata.replaceAll(metadataOrigin, publicOrigin);
}







// -----------------------------------------------------------
// enrichSpMetadata
// -----------------------------------------------------------
//
// Injects the LitNET FEDI registration blocks into samlify's
// bare SP metadata via string surgery: mdui:UIInfo (display
// name / description / privacy), the requested attributes
// (mail required, givenName/sn optional), the organization
// and the technical contact.
//
// Used by:
//   - routes/saml.js — GET /auth/saml/metadata
// -----------------------------------------------------------

export function enrichSpMetadata(rawXml) {
    const extensions = `<Extensions>
      <mdui:UIInfo xmlns:mdui="urn:oasis:names:tc:SAML:metadata:ui">
        <mdui:DisplayName xml:lang="en">${SP_DISPLAY_NAME}</mdui:DisplayName>
        <mdui:Description xml:lang="en">${SP_DESCRIPTION}</mdui:Description>
        ${SP_PRIVACY_URL ? `<mdui:PrivacyStatementURL xml:lang="en">${SP_PRIVACY_URL}</mdui:PrivacyStatementURL>` : ""}
      </mdui:UIInfo>
    </Extensions>`;

    const attributeConsumingService = `<AttributeConsumingService index="1">
      <ServiceName xml:lang="en">${SP_DISPLAY_NAME}</ServiceName>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="mail" isRequired="true"/>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:2.5.4.42" FriendlyName="givenName" isRequired="false"/>
      <RequestedAttribute NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri" Name="urn:oid:2.5.4.4" FriendlyName="sn" isRequired="false"/>
    </AttributeConsumingService>`;

    const organization = `<Organization>
      <OrganizationName xml:lang="en">${SP_ORG_NAME}</OrganizationName>
      <OrganizationDisplayName xml:lang="en">${SP_ORG_DISPLAY_NAME}</OrganizationDisplayName>
      <OrganizationURL xml:lang="en">${SP_ORG_URL}</OrganizationURL>
    </Organization>`;

    const contactPerson = `<ContactPerson contactType="technical">
      <EmailAddress>mailto:${SP_CONTACT_EMAIL}</EmailAddress>
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
// The boot-time factory index.js awaits: fetches the IdP
// metadata, asks it whether AuthnRequests must be signed
// (only then are the SP key/cert loaded), and builds the SP
// with its entity id, POST assert endpoint and redirect
// logout endpoint all under appBaseUrl + /auth/saml.
//
// Used by:
//   - index.js — const samlSetup = await createSamlSetup(...)
// -----------------------------------------------------------

export async function createSamlSetup(appBaseUrl) {
    saml.setSchemaValidator(validator);

    const idpMetadata = await loadIdpMetadata();
    const idp = saml.IdentityProvider({
        metadata: idpMetadata,
        wantLogoutRequestSigned: true,
    });
    const idpWantsSignedRequests = idp.entityMeta.isWantAuthnRequestsSigned();
    const spPrivateKey = idpWantsSignedRequests
        ? readRequiredFile(SP_PRIVATE_KEY_PATH, "SP_PRIVATE_KEY_PATH")
        : undefined;
    const spSigningCert = idpWantsSignedRequests
        ? readRequiredFile(SP_SIGNING_CERT_PATH, "SP_SIGNING_CERT_PATH")
        : undefined;

    const spEntityId = `${appBaseUrl}${SAML_BASE_PATH}/metadata`;
    const sp = saml.ServiceProvider({
        entityID: spEntityId,
        authnRequestsSigned: idpWantsSignedRequests,
        nameIDFormat: [
            "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
            "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
        ],
        assertionConsumerService: [
            {
                Binding: saml.Constants.namespace.binding.post,
                Location: `${appBaseUrl}${SAML_BASE_PATH}/assert`,
            },
        ],
        singleLogoutService: [
            {
                Binding: saml.Constants.namespace.binding.redirect,
                Location: `${appBaseUrl}${SAML_BASE_PATH}/logout/callback`,
            },
        ],
        ...(idpWantsSignedRequests
            ? {
                  privateKey: spPrivateKey,
                  signingCert: spSigningCert,
              }
            : {}),
    });

    return {
        sp,
        idp,
        keycloakMetadataUrl: KEYCLOAK_METADATA_URL,
        keycloakPublicBaseUrl: KEYCLOAK_PUBLIC_BASE_URL,
        spEntityId,
        spNameIdFormat: SP_NAME_ID_FORMAT,
        idpWantsSignedRequests,
    };
}
