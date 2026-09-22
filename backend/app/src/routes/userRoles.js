// -----------------------------------------------------------
//  [*] Routes — /api/user-roles
//
//    GET  /api/user-roles?email=...   — a user's roles + catalog
//    POST /api/user-roles/assign      — grant a role by email
//    POST /api/user-roles/remove      — revoke a role by email
//
//  The role administration API behind the manager's roles
//  page. Users are looked up by email, case-insensitively and
//  trimmed; role names are matched exactly (trimmed).
//
//  Auth: index.js mounts the router behind verifySamlSession
//  + attachRoles, and the router itself adds managerOnly once
//  for every route — the caller must OWN the Vadybininkas
//  role; the X-Active-Role header plays no part here, unlike
//  the other routers. A manager MAY revoke their own
//  Vadybininkas role (the page confirms it first); the base
//  "Darbuotojas" role cannot be revoked at all, since
//  attachRoles re-grants it on the user's next request.
//
//  Used by:
//    - manager/roles.jsx — the whole page
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { authorize } from "../auth/authorize.js";


// The role every signed-in user gets automatically
// (auth/attachRoles.js) — revoking it would be undone on the
// next request, so it is refused up front
const BASE_ROLE = "Darbuotojas";

// Shared response texts — one wording per situation
const MSG_EMAIL_REQUIRED = "Klaida: Vartotojo el. paštas yra privalomas";
const MSG_EMAIL_ROLE_REQUIRED = "Klaida: Vartotojo el. paštas ir rolė yra privalomi";
const MSG_USER_NOT_FOUND = "Klaida: Vartotojas nerastas";
const MSG_UNKNOWN_ROLE = "Klaida: nežinoma rolė";
const MSG_BASE_ROLE = `Klaida: rolė ${BASE_ROLE} yra bazinė ir nešalinama`;


const router = Router();

// Ownership of the manager role is enough — attachRoles has
// already filled req.user.roles by the time this runs
const managerOnly = authorize(["Vadybininkas"]);
router.use(managerOnly);







// -----------------------------------------------------------
// readEmailAndRole
// -----------------------------------------------------------
//
// The { email, role } body of assign/remove, both trimmed;
// either missing → null, so the caller answers 400.
//
// Used by:
//   - POST /assign, POST /remove (below)
// -----------------------------------------------------------

function readEmailAndRole(body) {
  const email = String(body?.email ?? "").trim();
  const role = String(body?.role ?? "").trim();
  if (!email || !role) return null;
  return { email, role };
}







// -----------------------------------------------------------
// findUserByEmail
// -----------------------------------------------------------
//
// The email→user lookup every route starts with: case-
// insensitive in SQL, oid aliased as id (the shape the page
// expects). null when there is no such user.
//
// Used by:
//   - GET /, POST /assign, POST /remove (below)
// -----------------------------------------------------------

async function findUserByEmail(email) {
  const u = await pool.query(
    `SELECT oid AS id, email, full_name
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return u.rowCount ? u.rows[0] : null;
}







// -----------------------------------------------------------
// findRoleId
// -----------------------------------------------------------
//
// Role name → id, or null for a name not in the catalog.
//
// Used by:
//   - POST /assign, POST /remove (below)
// -----------------------------------------------------------

async function findRoleId(name) {
  const r = await pool.query(`SELECT id FROM roles WHERE name = $1`, [name]);
  return r.rowCount ? r.rows[0].id : null;
}







// -----------------------------------------------------------
// GET /api/user-roles
// -----------------------------------------------------------
//
// ?email=... → { user, roles, allRoles }: the user (oid
// aliased as id), the roles they own, and the full catalog so
// the UI can render assign buttons for the rest. Catalog and
// ownership come from ONE query — a LEFT JOIN of user_roles
// onto roles for this user — so the two lists can never
// disagree.
//
// Used by:
//   - manager/roles.jsx — user search
// -----------------------------------------------------------

router.get("/", async (req, res) => {
  try {
    const email = String(req.query.email ?? "").trim();
    if (!email) return res.status(400).json({ error: MSG_EMAIL_REQUIRED });

    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: MSG_USER_NOT_FOUND });

    const catalog = await pool.query(
      `SELECT r.name, ur.user_oid IS NOT NULL AS owned
         FROM roles r
         LEFT JOIN user_roles ur ON ur.role_id = r.id AND ur.user_oid = $1
        ORDER BY r.name ASC`,
      [user.id]
    );
    const allRoles = catalog.rows.map((r) => r.name);
    const roles = catalog.rows.filter((r) => r.owned).map((r) => r.name);

    res.json({ user, roles, allRoles });
  } catch (e) {
    console.error("GET /api/user-roles", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// POST /api/user-roles/assign
// -----------------------------------------------------------
//
// Body: { email, role }. Grants the role; re-granting is a
// no-op (ON CONFLICT DO NOTHING). 404 unknown user, 400
// unknown role.
//
// Used by:
//   - manager/roles.jsx — the "Priskirti" buttons
// -----------------------------------------------------------

router.post("/assign", async (req, res) => {
  try {
    const input = readEmailAndRole(req.body);
    if (!input) return res.status(400).json({ error: MSG_EMAIL_ROLE_REQUIRED });

    const user = await findUserByEmail(input.email);
    if (!user) return res.status(404).json({ error: MSG_USER_NOT_FOUND });

    const roleId = await findRoleId(input.role);
    if (roleId === null) return res.status(400).json({ error: MSG_UNKNOWN_ROLE });

    await pool.query(
      `INSERT INTO user_roles (user_oid, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [user.id, roleId]
    );

    res.sendStatus(204);
  } catch (e) {
    console.error("POST /api/user-roles/assign", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// POST /api/user-roles/remove
// -----------------------------------------------------------
//
// Body: { email, role }. Revokes the role; an unknown role
// name is treated as already-removed (204), only an unknown
// user is a 404. The base "Darbuotojas" role is refused with
// a 400 — attachRoles would hand it straight back anyway.
//
// Used by:
//   - manager/roles.jsx — the "Pašalinti" buttons
// -----------------------------------------------------------

router.post("/remove", async (req, res) => {
  try {
    const input = readEmailAndRole(req.body);
    if (!input) return res.status(400).json({ error: MSG_EMAIL_ROLE_REQUIRED });
    if (input.role === BASE_ROLE) return res.status(400).json({ error: MSG_BASE_ROLE });

    const user = await findUserByEmail(input.email);
    if (!user) return res.status(404).json({ error: MSG_USER_NOT_FOUND });

    const roleId = await findRoleId(input.role);
    if (roleId === null) return res.sendStatus(204);

    await pool.query(
      `DELETE FROM user_roles
        WHERE user_oid = $1 AND role_id = $2`,
      [user.id, roleId]
    );

    res.sendStatus(204);
  } catch (e) {
    console.error("POST /api/user-roles/remove", e);
    res.status(500).json({ error: "internal error" });
  }
});


export default router;
