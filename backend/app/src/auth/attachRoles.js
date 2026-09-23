// -----------------------------------------------------------
//  [*] Auth — role loading middleware
//
//  Fills req.user.roles with the caller's role names from the
//  DB. Every call also upserts the "Darbuotojas" role for the
//  caller, so simply signing in makes you an employee — the
//  same auto-grant routes/session.js does on /init.
//
//  Fails open: on any error (or a missing eid) roles becomes
//  [] and the request continues — the role guards downstream
//  then reject with 403 rather than this middleware with 500.
// -----------------------------------------------------------

import { pool } from "../db/pool.js";







// -----------------------------------------------------------
// attachRoles
// -----------------------------------------------------------
//
// Express middleware; expects verifySamlSession to have set
// req.user. Identity key is eid with sub as fallback — the
// same pair every route handler uses.
//
// Used by:
//   - index.js — GET /api/me and the /api/user-roles mount
//   - guard arrays in routes/activities.js, routes/themes.js
//   - routes/session.js — GET /api/session/check
// -----------------------------------------------------------

export async function attachRoles(req, res, next) {
  try {
    const eid = req.user?.eid || req.user?.sub;

    if (!eid) {
      req.user.roles = [];
      return next();
    }

    // The employee role is looked up by its Lithuanian name —
    // renaming the role in the DB silently breaks auto-grant
    const roleRes = await pool.query(
      `SELECT id FROM roles WHERE name = $1`,
      ["Darbuotojas"]
    );

    if (roleRes.rowCount === 0) {
      req.user.roles = [];
      return next();
    }

    const employeeRoleId = roleRes.rows[0].id;

    // Auto-grant "Darbuotojas" on every request; ON CONFLICT
    // makes it a no-op after the first time
    await pool.query(
      `
      INSERT INTO user_roles (user_eid, role_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [eid, employeeRoleId]
    );

    const rolesRes = await pool.query(
      `
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_eid = $1
      ORDER BY r.name
      `,
      [eid]
    );

    req.user.roles = rolesRes.rows.map(r => r.name);

    return next();
  } catch (err) {
      console.error("attachRoles error:", err);
      req.user.roles = [];
      return next();
  }
}
