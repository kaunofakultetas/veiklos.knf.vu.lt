import { Router } from "express";
import { pool } from "../db/pool.js";
import { TBL_USERS, TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";

export default function createSamlRouter({ sp, idp }) {
    const samlRouter = Router();

    samlRouter.get("/metadata", (_req, res) => {
        res.type("application/xml").send(sp.getMetadata());
    });

    samlRouter.get("/login", async (_req, res) => {
        try {
            const { context } = await sp.createLoginRequest(idp, "redirect");
            res.redirect(context);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(500).send(`SAML login request failed: ${message}`);
        }
    });

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

            // upsert user into DB
            await pool.query(
                `INSERT INTO ${TBL_USERS} (oid, email, full_name)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (oid) DO UPDATE
                   SET email        = EXCLUDED.email,
                       full_name    = COALESCE(EXCLUDED.full_name, ${TBL_USERS}.full_name),
                       last_login_at = NOW()`,
                [oid, email, fullName]
            );

            // auto-assign Darbuotojas if user has no roles yet
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

    samlRouter.get("/logout/callback", (req, res) => {
        req.session.destroy(() => {
            res.clearCookie("connect.sid");
            res.redirect("/");
        });
    });

    return samlRouter;
}
