// -----------------------------------------------------------
//  [*] Routes — /auth/saml (the login flow)
//
//    GET  /auth/saml/metadata          — the SP's own metadata
//    GET  /auth/saml/login             — redirect to VU SSO
//    POST /auth/saml/assert            — VU SSO's callback
//    GET  /auth/saml/logout            — single logout via IdP
//    GET  /auth/saml/logout/callback   — IdP's logout return
//
//  The whole browser-facing SAML flow. Unlike the other route
//  files this one exports a FACTORY — index.js builds the
//  SAML setup at boot (utils/saml.js) and passes it in, so
//  the routes close over it; per-route notes are plain
//  comments inside, banners stay at top level. The SP used
//  for a request is the one for the origin it arrived on, so
//  the app works under any domain name.
//
//  /assert is where a user is BORN in this system: it upserts
//  the users row from the IdP attributes and auto-grants
//  "Darbuotojas" on first sign-in. Attributes are
//  read through mapSamlAttributes, so VU SSO's OIDs (or their
//  friendly names) both work.
//
//  Used by:
//    - the browser — App.jsx redirects to /login, VU SSO
//      POSTs back to /assert; nothing calls these via fetch
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { TBL_USERS, TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";
import { enrichSpMetadata, mapSamlAttributes, withNestedNameIds } from "../utils/saml.js";







// -----------------------------------------------------------
// failedStatusDetail
// -----------------------------------------------------------
//
// The IdP's own explanation of a non-Success response: the
// StatusMessage (and any nested StatusCode) read straight
// out of the posted SAMLResponse. samlify reports only the
// status codes ("ERR_FAILED_STATUS ... Responder"), which is
// useless for finding out what went wrong on VU's side —
// the message next to them names the reason. null when
// there is nothing to read.
//
// Used by:
//   - POST /assert (below) — the failure log line and 401
// -----------------------------------------------------------

function failedStatusDetail(samlResponseB64) {
    if (!samlResponseB64) return null;
    let xml;
    try {
        xml = Buffer.from(String(samlResponseB64), "base64").toString("utf8");
    } catch {
        return null;
    }
    const message = /<(?:\w+:)?StatusMessage>([^<]*)<\//.exec(xml)?.[1]?.trim();
    const codes = [...xml.matchAll(/<(?:\w+:)?StatusCode Value="([^"]+)"/g)].map((m) => m[1]);
    const parts = [];
    if (message) parts.push(message);
    if (codes.length > 1) parts.push(`(${codes.join(" → ")})`);
    return parts.length ? parts.join(" ") : null;
}







// -----------------------------------------------------------
// createSamlRouter (default export)
// -----------------------------------------------------------
//
// createSamlRouter({ setup }) → an express Router with the
// five routes above closed over the SAML setup, plus
// router.assert — the bare /assert handler.
//
// Used by:
//   - index.js — mounted at /auth/saml
// -----------------------------------------------------------

export default function createSamlRouter({ setup }) {
    const { idp, spFor, identityFor } = setup;
    const samlRouter = Router();

    // The SP for the origin this request arrived on. Behind
    // the Caddy ingress req.protocol honours X-Forwarded-Proto
    // (index.js trusts the proxy) and Host passes through
    const originOf = (req) => `${req.protocol}://${req.get("host")}`;
    const spOf = (req) => spFor(originOf(req));

    // GET /metadata — the SP metadata (enriched with the
    // LitNET FEDI blocks) that VU SSO / the federation
    // registers; public on purpose
    samlRouter.get("/metadata", (req, res) => {
        res.type("application/xml").send(enrichSpMetadata(spOf(req).getMetadata()));
    });

    // GET /login — build a (possibly signed) AuthnRequest and
    // bounce the browser to the IdP's SSO endpoint
    samlRouter.get("/login", async (req, res) => {
        try {
            const { context } = await spOf(req).createLoginRequest(idp, "redirect");
            res.redirect(context);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).send(`SAML login request failed: ${message}`);
        }
    });

    // POST /assert — the IdP posts the encrypted, signed
    // assertion here. samlify checks signature, issuer and
    // validity window; the audience is checked here because
    // samlify does not — an assertion minted for another SP
    // must not log anyone in. Then: upsert the user,
    // auto-grant Darbuotojas on first sign-in, store the login
    // in the session and send the browser home
    const assert = async (req, res) => {
        try {
            const { samlContent, extract } = await spOf(req).parseLoginResponse(idp, "post", req);

            const { spEntityId } = identityFor(originOf(req));
            const audiences = [].concat(extract.audience ?? []);
            if (!audiences.includes(spEntityId)) {
                return res.status(401).send("SAML assertion audience mismatch");
            }

            // Nested-NameID attributes (eduPersonTargetedID) come
            // back empty from samlify — filled from the assertion
            const attributes = await withNestedNameIds(spOf(req), extract.attributes, samlContent);
            const { oid, email, name: fullName } = mapSamlAttributes(attributes);

            // The attribute NAMES (never the values) are logged and
            // echoed, so a release policy that sends the identity
            // under names we don't map is diagnosable from the
            // error alone
            if (!oid || !email) {
                const received = Object.keys(attributes);
                console.error("SAML assert: missing oid/email; attributes received:", received.join(", ") || "(none)");
                return res.status(400).send(
                    `SAML assertion missing oid or email attributes (received: ${received.join(", ") || "none"})`
                );
            }

            // Upsert keyed by oid — email always refreshes,
            // full_name only when the IdP sent one; last_login_at
            // is stamped on the first login too, not only on
            // returning ones
            await pool.query(
                `INSERT INTO ${TBL_USERS} (oid, email, full_name, last_login_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (oid) DO UPDATE
                   SET email        = EXCLUDED.email,
                       full_name    = COALESCE(EXCLUDED.full_name, ${TBL_USERS}.full_name),
                       last_login_at = NOW()`,
                [oid, email, fullName]
            );

            // First sign-in: grant the employee role so the
            // user has a workspace at all; looked up by its
            // Lithuanian name — renaming the role in the DB
            // breaks this silently
            const { rows: existing } = await pool.query(
                `SELECT 1 FROM ${TBL_USER_ROLES} WHERE user_oid = $1 LIMIT 1`,
                [oid]
            );
            if (existing.length === 0) {
                const { rows: defaultRole } = await pool.query(
                    `SELECT id FROM ${TBL_ROLES} WHERE name = $1`,
                    ["Darbuotojas"]
                );
                if (defaultRole.length > 0) {
                    await pool.query(
                        `INSERT INTO ${TBL_USER_ROLES} (user_oid, role_id)
                         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [oid, defaultRole[0].id]
                    );
                }
            }

            // nameID + sessionIndex are kept for single
            // logout; the RAW attributes feed verifySamlSession,
            // which maps them the same way
            req.session.samlUser = {
                nameID:       extract.nameID,
                sessionIndex: extract.sessionIndex,
                attributes,
            };

            req.session.save((err) => {
                if (err) {
                    console.error("Session save error:", err);
                    return res.status(500).send("Session save failed");
                }
res.redirect("/");
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const detail = failedStatusDetail(req.body?.SAMLResponse);
            console.error("SAML assert failed:", message, detail ? `— IdP says: ${detail}` : "");
            res.status(401).send(`SAML assertion parsing failed: ${message}${detail ? ` — IdP says: ${detail}` : ""}`);
        }
    };
    samlRouter.post("/assert", assert);

    // GET /logout — drop the local session FIRST, then try to
    // log the IdP session out too; any IdP failure still ends
    // with a signed-out browser at "/"
    samlRouter.get("/logout", async (req, res) => {
        const samlUser = req.session?.samlUser;
        await new Promise(resolve => req.session.destroy(resolve));
        res.clearCookie("connect.sid");

        if (!samlUser) {
            return res.redirect("/");
        }

        try {
            const sessionIndex = samlUser.sessionIndex?.sessionIndex ?? samlUser.sessionIndex;
            const { context } = await spOf(req).createLogoutRequest(idp, "redirect", {
                logoutNameID: samlUser.nameID,
                sessionIndex,
            });
            res.redirect(context);
        } catch (err) {
            console.error("Logout request error:", err);
            res.redirect("/");
        }
    });

    // GET /logout/callback — the IdP's return leg; the local
    // session is already gone, this just makes sure
    samlRouter.get("/logout/callback", (req, res) => {
        req.session.destroy(() => {
            res.clearCookie("connect.sid");
            res.redirect("/");
        });
    });

    return samlRouter;
}
