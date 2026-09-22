// -----------------------------------------------------------
//  [*] Routes — /api/roles
//
//    GET  /api/roles          — the role catalog
//    POST /api/roles/assign   — grant a role by user oid
//
//  Auth: index.js mounts the router behind verifySamlSession
//  + attachRoles, and the router adds managerOnly once for
//  every route — the caller must OWN the Vadybininkas role,
//  exactly like /api/user-roles. The frontend role admin page
//  uses /api/user-roles (email-keyed) instead.
//
//  Used by:
//    - nothing calls this at the moment
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { authorize } from "../auth/authorize.js";
import { TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";


const router = Router();

// Ownership of the manager role is enough — attachRoles has
// already filled req.user.roles by the time this runs
const managerOnly = authorize(["Vadybininkas"]);
router.use(managerOnly);







// -----------------------------------------------------------
// GET /api/roles
// -----------------------------------------------------------
//
// The full role catalog, alphabetical; a DB failure answers
// the usual 500 internal error.
//
// Used by:
//   - nothing calls this at the moment
// -----------------------------------------------------------

router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description
      FROM ${TBL_ROLES}
      ORDER BY name`);
    res.json(rows);
  } catch (e) {
    console.error("GET /api/roles", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// POST /api/roles/assign
// -----------------------------------------------------------
//
// Body: { user_oid, role_name }. Grants the role; re-granting
// is a no-op (ON CONFLICT DO NOTHING). 404 when the role name
// is unknown; a DB failure answers the usual 500.
//
// Used by:
//   - nothing calls this at the moment — the frontend assigns
//     via POST /api/user-roles/assign (by email)
// -----------------------------------------------------------

router.post("/assign", async (req, res) => {
  const { user_oid, role_name } = req.body;
  if (!user_oid || !role_name)
    return res.status(400).json({ error: "Klaida: Vartotojo OID ir rolė yra privalomi" });

  try {
    const role = await pool.query(
      `SELECT id FROM ${TBL_ROLES}
      WHERE name = $1`,
      [role_name]);
    if (!role.rowCount)
      return res.status(404).json({ error: "Klaida: Rolė nerasta" });

    await pool.query(
      `INSERT INTO ${TBL_USER_ROLES} (user_oid, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [user_oid, role.rows[0].id]
    );

    res.status(204).end();
  } catch (e) {
    console.error("POST /api/roles/assign", e);
    res.status(500).json({ error: "internal error" });
  }
});


export default router;
