// -----------------------------------------------------------
//  [*] Routes — /auth/saml (the login flow)
//
//    GET  /auth/saml/metadata          — the SP's own metadata
//    GET  /auth/saml/login             — redirect to VU SSO
//    POST /auth/saml/assert            — VU SSO's callback
//    POST /auth/saml/logout            — single logout via IdP
//    GET  /auth/saml/logout/callback   — IdP's logout return,
//                                        and IdP-initiated logout
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
//  "Darbuotojas" on first sign-in. Users are keyed by VU's
//  eID — a login without it is refused. Attributes are
//  read through mapSamlAttributes, so VU SSO's OIDs (or their
//  friendly names) both work. The login's SessionIndex and
//  NameID are filed against the session
//  (auth/samlSessionIndex.js) so an IdP-initiated logout —
//  which arrives without the cookie — can still end it.
//
//  Used by:
//    - the browser — App.jsx redirects to /login, VU SSO
//      POSTs back to /assert and talks to /logout/callback
//    - components/appHeader.jsx — fetch POST /logout, then a
//      navigation to the URL it answers with
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { TBL_USERS, TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";
import { enrichSpMetadata, logoutOctetString, logoutRequestTags, mapSamlAttributes } from "../utils/saml.js";
import { rememberSamlSession, forgetSamlSession, samlSessionIdFor } from "../auth/samlSessionIndex.js";







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
            const { extract } = await spOf(req).parseLoginResponse(idp, "post", req);

            const { spEntityId } = identityFor(originOf(req));
            const audiences = [].concat(extract.audience ?? []);
            if (!audiences.includes(spEntityId)) {
                return res.status(401).send("SAML assertion audience mismatch");
            }

            const attributes = extract.attributes || {};
            const { eid, email, name: fullName } = mapSamlAttributes(attributes);

            // The attribute NAMES (never the values) are logged and
            // echoed, so a release policy that sends the identity
            // under names we don't map is diagnosable from the
            // error alone
            if (!eid || !email) {
                const received = Object.keys(attributes);
                console.error("SAML assert: missing eID/mail; attributes received:", received.join(", ") || "(none)");
                return res.status(400).send(
                    `SAML assertion missing eID or mail attributes (received: ${received.join(", ") || "none"})`
                );
            }

            // Upsert keyed by eid — email always refreshes,
            // full_name only when the IdP sent one; last_login_at
            // is stamped on the first login too, not only on
            // returning ones
            await pool.query(
                `INSERT INTO ${TBL_USERS} (eid, email, full_name, last_login_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (eid) DO UPDATE
                   SET email        = EXCLUDED.email,
                       full_name    = COALESCE(EXCLUDED.full_name, ${TBL_USERS}.full_name),
                       last_login_at = NOW()`,
                [eid, email, fullName]
            );

            // First sign-in: grant the employee role so the
            // user has a workspace at all; looked up by its
            // Lithuanian name — renaming the role in the DB
            // breaks this silently
            const { rows: existing } = await pool.query(
                `SELECT 1 FROM ${TBL_USER_ROLES} WHERE user_eid = $1 LIMIT 1`,
                [eid]
            );
            if (existing.length === 0) {
                const { rows: defaultRole } = await pool.query(
                    `SELECT id FROM ${TBL_ROLES} WHERE name = $1`,
                    ["Darbuotojas"]
                );
                if (defaultRole.length > 0) {
                    await pool.query(
                        `INSERT INTO ${TBL_USER_ROLES} (user_eid, role_id)
                         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [eid, defaultRole[0].id]
                    );
                }
            }

            // The login gets a FRESH session id: the one the
            // browser held while anonymous must not carry over
            // into the signed-in session (session fixation)
            req.session.regenerate((regenerateErr) => {
                if (regenerateErr) {
                    console.error("Session regenerate error:", regenerateErr);
                    return res.status(500).send("Session save failed");
                }

                // nameID + sessionIndex are kept for single
                // logout; the RAW attributes feed
                // verifySamlSession, which maps them the same way
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
                    // Filed under the NEW id for as long as the
                    // cookie lives, so an IdP-initiated logout can
                    // find this session without the cookie
                    rememberSamlSession(
                        { sessionIndex: extract.sessionIndex, nameID: extract.nameID },
                        req.sessionID,
                        req.session.cookie?.maxAge ?? undefined
                    );
                    res.redirect("/");
                });
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A DB error after a valid assertion is ours, not the
            // IdP's — say so instead of blaming the assertion
            if (error?.code && /^[0-9A-Z]{5}$/.test(error.code)) {
                console.error("SAML assert: DB error after a valid assertion:", error);
                return res.status(500).send("Login failed on our side; the assertion was fine");
            }
            const detail = failedStatusDetail(req.body?.SAMLResponse);
            console.error("SAML assert failed:", message, detail ? `— IdP says: ${detail}` : "");
            res.status(401).send(`SAML assertion parsing failed: ${message}${detail ? ` — IdP says: ${detail}` : ""}`);
        }
    };
    samlRouter.post("/assert", assert);

    // Drop the local session and its cookie; resolves once the
    // store has forgotten it
    const endLocalSession = (req, res) =>
        new Promise((resolve) => {
            req.session.destroy(() => {
                res.clearCookie("connect.sid");
                resolve();
            });
        });

    // POST /logout — drop the local session FIRST, then build
    // the IdP logout and answer its URL as JSON { redirect }
    // for the SPA to navigate to; no session, or any IdP
    // failure, answers "/" so the browser still lands signed
    // out. A POST because a cross-site request cannot carry
    // the SameSite=Lax cookie — no other page can sign a user
    // out. JSON + navigation rather than a form POST with a
    // 302: Chromium enforces the CSP form-action rule on the
    // redirect to the IdP that would follow a form submission
    samlRouter.post("/logout", async (req, res) => {
        const samlUser = req.session?.samlUser;
        if (samlUser) forgetSamlSession(samlUser);
        await endLocalSession(req, res);

        if (!samlUser) {
            return res.json({ redirect: "/" });
        }

        try {
            const sessionIndex = samlUser.sessionIndex?.sessionIndex ?? samlUser.sessionIndex;
            // The template with SessionIndex (utils/saml.js) is
            // only used when a tag replacer is passed along
            const { context } = await spOf(req).createLogoutRequest(
                idp,
                "redirect",
                { logoutNameID: samlUser.nameID, sessionIndex },
                "",
                logoutRequestTags
            );
            res.json({ redirect: context });
        } catch (err) {
            console.error("Logout request error:", err);
            res.json({ redirect: "/" });
        }
    });

    // GET /logout/callback — our SingleLogoutService endpoint
    // (redirect binding), reached in two situations:
    //
    //   SAMLResponse — the return leg of OUR logout: the IdP
    //     confirms it ended its session. Ours is already gone,
    //     so a bad or non-Success response is only logged
    //   SAMLRequest  — an IdP-INITIATED logout: the user signed
    //     out of another VU service and the IdP is telling
    //     every SP in that session — from an iframe on
    //     sso.vu.lt, so the SameSite=Lax cookie is NOT sent and
    //     req.session is a blank. The login's own session is
    //     found by the request's SessionIndex / NameID in the
    //     session index and ended through the store; then we
    //     answer with a signed LogoutResponse (InResponseTo +
    //     the IdP's RelayState) — without it the IdP's logout
    //     chain stalls on us. A request that fails verification
    //     is refused and changes nothing, so a forged link
    //     cannot log anyone out
    //
    // Both messages are signed by VU; samlify verifies them
    // against the IdP certificate (wantLogout*Signed on the SP)
    // over the raw query string (logoutOctetString)
    samlRouter.get("/logout/callback", async (req, res) => {
        const sp = spOf(req);
        const message = { query: req.query, octetString: logoutOctetString(req) };

        if (req.query.SAMLRequest) {
            let parsed;
            try {
                parsed = await sp.parseLogoutRequest(idp, "redirect", message);
            } catch (err) {
                console.error("SAML logout request rejected:", err);
                return res.status(400).send("Invalid SAML logout request");
            }

            const ids = { sessionIndex: parsed.extract?.sessionIndex, nameID: parsed.extract?.nameID };
            const sid = samlSessionIdFor(ids);
            if (sid && req.sessionStore) {
                await new Promise((resolve) => req.sessionStore.destroy(sid, () => resolve()));
            }
            forgetSamlSession(ids);
            await endLocalSession(req, res);

            try {
                const relayState = typeof req.query.RelayState === "string" ? req.query.RelayState : "";
                const { context } = sp.createLogoutResponse(idp, parsed, "redirect", relayState);
                return res.redirect(context);
            } catch (err) {
                console.error("SAML logout response error:", err);
                return res.redirect("/");
            }
        }

        if (req.query.SAMLResponse) {
            try {
                await sp.parseLogoutResponse(idp, "redirect", message);
                console.log("SAML logout: IdP confirmed the logout");
            } catch (err) {
                console.error("SAML logout: IdP response not accepted:", err);
            }
        }

        await endLocalSession(req, res);
        res.redirect("/");
    });

    return samlRouter;
}
