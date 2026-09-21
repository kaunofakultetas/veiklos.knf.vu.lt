// -----------------------------------------------------------
//  [*] Routes — /api/roles
//
//    GET  /api/roles          — the role catalog
//    POST /api/roles/assign   — grant a role by user oid
//
//  Guarded per route by verifySamlSession alone — no role
//  check, so any signed-in user could assign roles here. The
//  frontend role admin page uses /api/user-roles (email-
//  keyed) instead.
//
//  Used by:
//    - nothing calls this at the moment
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { TBL_ROLES, TBL_USER_ROLES } from "../db/tables.js";


const router = Router();







// -----------------------------------------------------------
// GET /api/roles
// -----------------------------------------------------------
//
// The full role catalog, alphabetical. No error handling —
// a DB failure falls through to Express' default 500.
//
// Used by:
//   - nothing calls this at the moment
// -----------------------------------------------------------

router.get("/", verifySamlSession, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description
    FROM ${TBL_ROLES}
    ORDER BY name`);
  res.json(rows);
});







// -----------------------------------------------------------
// POST /api/roles/assign
// -----------------------------------------------------------
//
// Body: { user_oid, role_name }. Grants the role; re-granting
// is a no-op (ON CONFLICT DO NOTHING). 404 when the role name
// is unknown.
//
// Used by:
//   - nothing calls this at the moment — the frontend assigns
//     via POST /api/user-roles/assign (by email)
// -----------------------------------------------------------

router.post("/assign", verifySamlSession, async (req, res) => {
  const { user_oid, role_name } = req.body;
  if (!user_oid || !role_name)
    return res.status(400).json({ error: "Klaida: Vartotojo OID ir rolė yra privalomi" });

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
});


export default router;
