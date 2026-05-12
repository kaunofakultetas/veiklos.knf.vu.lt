import * as saml from "samlify";
import * as validator from "@authenio/samlify-node-xmllint";
import { readFileSync } from "node:fs";

export const SAML_BASE_PATH = "/auth/saml";
const SP_ENTITY_ID = process.env.SP_ENTITY_ID ?? "urn:test-website";
const KEYCLOAK_METADATA_URL =
    process.env.KEYCLOAK_METADATA_URL ??
    "http://localhost:8111/realms/master/protocol/saml/descriptor";
const KEYCLOAK_PUBLIC_BASE_URL = process.env.KEYCLOAK_PUBLIC_BASE_URL;
const SP_NAME_ID_FORMAT =
    process.env.SP_NAME_ID_FORMAT ??
    "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified";
const SP_PRIVATE_KEY_PATH = process.env.SP_PRIVATE_KEY_PATH;
const SP_SIGNING_CERT_PATH = process.env.SP_SIGNING_CERT_PATH;

function readRequiredFile(path, envName) {
    if (!path) {
        throw new Error(
            `${envName} is required when IdP expects signed AuthnRequests`,
        );
    }
    return readFileSync(path, "utf8");
}

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

    const sp = saml.ServiceProvider({
        entityID: SP_ENTITY_ID,
        authnRequestsSigned: idpWantsSignedRequests,
        nameIDFormat: [SP_NAME_ID_FORMAT],
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
        spEntityId: SP_ENTITY_ID,
        spNameIdFormat: SP_NAME_ID_FORMAT,
        idpWantsSignedRequests,
    };
}
