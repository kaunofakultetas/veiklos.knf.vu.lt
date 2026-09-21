// -----------------------------------------------------------
//  [*] Routes — /auth/saml (the login flow)
//
//    GET  /auth/saml/metadata          — the SP's own metadata
//    GET  /auth/saml/login             — redirect to Keycloak
//    POST /auth/saml/assert            — Keycloak's callback
//    GET  /auth/saml/logout            — single logout via IdP
//    GET  /auth/saml/logout/callback   — IdP's logout return
//
//  The whole browser-facing SAML flow. Unlike the other route
//  files this one exports a FACTORY — index.js builds the
//  samlify SP/IdP pair at boot (utils/saml.js) and passes it
//  in, so the routes close over it; per-route notes are plain
//  comments inside, banners stay at top level.
//
//  /assert is where a user is BORN in this system: it upserts
//  the users row from the IdP attributes and auto-grants
//  "Darbuotojas" on first sign-in — the work the old
//  /api/session/init did in the Microsoft era.
//
//  Used by:
//    - the browser — App.jsx redirects to /login, Keycloak
//      POSTs back to /assert; nothing calls these via fetch
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { TBL_USERS, TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";
import { enrichSpMetadata } from "../utils/saml.js";







// -----------------------------------------------------------
// createSamlRouter (default export)
// -----------------------------------------------------------
//
// createSamlRouter({ sp, idp }) → an express Router with the
// five routes above closed over the samlify pair.
//
// Used by:
//   - index.js — mounted at /auth/saml
// -----------------------------------------------------------

export default function createSamlRouter({ sp, idp }) {
    const samlRouter = Router();

    // GET /metadata — the SP metadata (enriched with the
    // LitNET FEDI blocks) that Keycloak / the federation
    // registers; public on purpose
    samlRouter.get("/metadata", (_req, res) => {
        res.type("application/xml").send(enrichSpMetadata(sp.getMetadata()));
    });

    // GET /login — build a (possibly signed) AuthnRequest and
    // bounce the browser to Keycloak's SSO endpoint
    samlRouter.get("/login", async (_req, res) => {
        try {
            const { context } = await sp.createLoginRequest(idp, "redirect");
            res.redirect(context);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).send(`SAML login request failed: ${message}`);
        }
    });

    // POST /assert — Keycloak posts the signed assertion here.
    // Validates it, upserts the user, auto-grants Darbuotojas
    // on first sign-in, stores the login in the session and
    // sends the browser home
    samlRouter.post("/assert", async (req, res) => {
        try {
            const { extract } = await sp.parseLoginResponse(idp, "post", req);
            const attrs = extract.attributes;
            const oid = attrs.oid;
            const email = attrs.preferred_username || attrs.email || null;
            const fullName = [attrs.firstName, attrs.lastName].filter(Boolean).join(" ") || null;

            if (!oid || !email) {
                return res.status(400).send("SAML assertion missing oid or email attributes");
            }

            // Upsert keyed by oid — email always refreshes,
            // full_name only when the IdP sent one
            await pool.query(
                `INSERT INTO ${TBL_USERS} (oid, email, full_name)
                 VALUES ($1, $2, $3)
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
            // logout; attributes feed verifySamlSession
            req.session.samlUser = {
                nameID:       extract.nameID,
                sessionIndex: extract.sessionIndex,
                attributes:   extract.attributes,
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
            res.status(401).send(`SAML assertion parsing failed: ${message}`);
        }
    });

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
            const { context } = await sp.createLogoutRequest(idp, "redirect", {
                logoutNameID: samlUser.nameID,
                sessionIndex,
            });
            res.redirect(context);
        } catch (err) {
            console.error("Logout request error:", err);
            res.redirect("/");
        }
    });

    // GET /logout/callback — Keycloak's return leg; the local
    // session is already gone, this just makes sure
    samlRouter.get("/logout/callback", (req, res) => {
        req.session.destroy(() => {
            res.clearCookie("connect.sid");
            res.redirect("/");
        });
    });

    return samlRouter;
}
