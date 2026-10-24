// -----------------------------------------------------------
//  [*] Auth — role loading middlewares
//
//  Fill req.user.roles with the caller's role names from the
//  DB. Every load also upserts the "Darbuotojas" role for the
//  caller, so simply signing in makes you an employee — the
//  same auto-grant the SAML /assert callback
//  (routes/saml.js) does on first sign-in.
//
//  Two flavours, differing only in what a failed lookup does.
//  attachRoles fails open: on any error roles becomes [] and
//  the request continues, so the role guards downstream
//  reject with 403 rather than this middleware with 500.
//  attachRolesStrict answers the 500 itself — it serves the
//  two endpoints the SPA builds its role state from, where an
//  empty list would read as "this user has no roles" and make
//  the page forget the active role.
// -----------------------------------------------------------

import { pool } from "../db/pool.js";







// -----------------------------------------------------------
// loadRoles
// -----------------------------------------------------------
//
// The caller's role names, alphabetical, after making sure
// they hold "Darbuotojas" (ON CONFLICT makes that a no-op
// after the first time). The employee role is looked up by
// its Lithuanian name — renaming it in the DB silently breaks
// the auto-grant, and then only the roles already held come
// back. A DB error is thrown to the caller.
//
// Used by:
//   - attachRoles, attachRolesStrict (below)
// -----------------------------------------------------------

async function loadRoles(eid) {
  const roleRes = await pool.query(
    `SELECT id FROM roles WHERE name = $1`,
    ["Darbuotojas"]
  );

  if (roleRes.rowCount === 0) return [];

  const employeeRoleId = roleRes.rows[0].id;

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

  return rolesRes.rows.map(r => r.name);
}







// -----------------------------------------------------------
// attachRoles
// -----------------------------------------------------------
//
// Express middleware; expects verifySamlSession to have set
// req.user. Identity key is eid with sub as fallback — the
// same pair every route handler uses. No eid, or a lookup
// that fails, leaves roles [] and continues.
//
// Used by:
//   - index.js — the /api/users, /api/roles and
//     /api/user-roles mounts
//   - guard arrays in routes/activities.js, routes/themes.js
// -----------------------------------------------------------

export async function attachRoles(req, res, next) {
  const eid = req.user?.eid || req.user?.sub;
  if (!eid) {
    req.user.roles = [];
    return next();
  }

  try {
    req.user.roles = await loadRoles(eid);
  } catch (err) {
    console.error("attachRoles error:", err);
    req.user.roles = [];
  }
  return next();
}







// -----------------------------------------------------------
// attachRolesStrict
// -----------------------------------------------------------
//
// attachRoles for the endpoints that report the caller's
// roles to the SPA: a lookup that fails answers 500 internal
// error and the request stops, so the page keeps the role it
// has instead of being told the user owns none. No eid still
// continues with roles [].
//
// Used by:
//   - index.js — GET /api/me
//   - routes/session.js — GET /api/session/check
// -----------------------------------------------------------

export async function attachRolesStrict(req, res, next) {
  const eid = req.user?.eid || req.user?.sub;
  if (!eid) {
    req.user.roles = [];
    return next();
  }

  try {
    req.user.roles = await loadRoles(eid);
  } catch (err) {
    console.error("attachRolesStrict error:", err);
    return res.status(500).json({ error: "internal error" });
  }
  return next();
}
