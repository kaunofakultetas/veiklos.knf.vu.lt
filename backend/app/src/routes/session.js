// -----------------------------------------------------------
//  [*] Routes — /api/session
//
//    GET /api/session/check   — the SPA's "am I signed in"
//
//  Since the VU SSO (SAML) migration this router only probes
//  the session. The user upsert and Darbuotojas auto-grant
//  that the old /init did now live in the SAML /assert
//  callback (routes/saml.js).
//
//  Used by:
//    - App.jsx — on load, to route the user by session state
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { attachRoles } from "../auth/attachRoles.js";
import { TBL_USERS } from "../db/tables.js";


const router = Router();







// -----------------------------------------------------------
// GET /api/session/check
// -----------------------------------------------------------
//
// 401 Neprisijungta without a session; otherwise the user row
// re-read from the DB by the session's oid, plus the roles
// (from attachRoles) as { name } objects — the shape App.jsx
// expects. An oid missing from the users table still answers
// 200, with user undefined.
//
// Used by:
//   - App.jsx — the session probe on every load
// -----------------------------------------------------------

router.get("/check", verifySamlSession, attachRoles, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT oid, email, full_name, created_at, last_login_at FROM ${TBL_USERS} WHERE oid = $1`,
      [req.user.oid]
    );
    res.json({
      user,
      roles: req.user.roles.map((name) => ({ name })),
    });
  } catch (e) {
    console.error("session/check error:", e);
    res.status(500).json({ error: "internal error" });
  }
});


export default router;
