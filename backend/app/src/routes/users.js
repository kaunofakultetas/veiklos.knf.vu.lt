// -----------------------------------------------------------
//  [*] Routes — /api/users
//
//    GET  /api/users   — list all users, newest first
//
//  Auth: index.js mounts the router behind verifySamlSession
//  + attachRoles, and the router adds managerOnly — the
//  caller must OWN the Vadybininkas role, like the other role
//  admin routers. Users are created
//  by the SAML upsert in routes/saml.js (/assert), keyed by
//  the IdP's oid — there is no create route here, a user
//  without an oid could never sign in.
//
//  Used by:
//    - nothing calls this at the moment — the frontend
//      manages users through /api/session and /api/user-roles
// -----------------------------------------------------------

import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authorize } from '../auth/authorize.js';
import { TBL_USERS } from '../db/tables.js';


const router = Router();

// Ownership of the manager role is enough — attachRoles has
// already filled req.user.roles by the time this runs
const managerOnly = authorize(["Vadybininkas"]);
router.use(managerOnly);







// -----------------------------------------------------------
// GET /api/users
// -----------------------------------------------------------
//
// Plain dump of the users table for a manager, newest first
// (by created_at — users have no serial id, the oid is the
// key). A DB failure answers the usual 500 internal error.
//
// Used by:
//   - nothing calls this at the moment
// -----------------------------------------------------------

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT oid, email, full_name, created_at FROM ${TBL_USERS} ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error("GET /api/users", e);
    res.status(500).json({ error: "internal error" });
  }
});


export default router;
