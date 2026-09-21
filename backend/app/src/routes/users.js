// -----------------------------------------------------------
//  [*] Routes — /api/users
//
//    GET  /api/users   — list all users, newest first
//    POST /api/users   — create a user by email + full name
//
//  Mounted in index.js behind verifySamlSession only — any
//  signed-in user can list and create users; there is no role
//  check here. Normally users are created by the SAML upsert
//  in routes/saml.js (/assert) instead, keyed by oid; rows
//  created through POST here have no oid and can't sign in.
//
//  Used by:
//    - nothing calls this at the moment — the frontend
//      manages users through /api/session and /api/user-roles
// -----------------------------------------------------------

import { Router } from 'express';
import { pool } from '../db/pool.js';
import { TBL_USERS } from '../db/tables.js';


const router = Router();







// -----------------------------------------------------------
// GET /api/users
// -----------------------------------------------------------
//
// Plain dump of the users table, newest first. No error
// handling — a DB failure falls through to Express' default
// 500.
//
// Used by:
//   - nothing calls this at the moment
// -----------------------------------------------------------

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, full_name, created_at FROM ${TBL_USERS} ORDER BY id DESC`
  );
  res.json(rows);
});







// -----------------------------------------------------------
// POST /api/users
// -----------------------------------------------------------
//
// Body: { email, full_name }. 409 on a duplicate email
// (unique-violation code 23505).
//
// Used by:
//   - nothing calls this at the moment
// -----------------------------------------------------------

router.post('/', async (req, res) => {
  const { email, full_name } = req.body;
  if (!email || !full_name) return res.status(400).json({ error: 'Klaida: Vartotojo el. paštas ir rolė yra privalomi' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${TBL_USERS} (email, full_name) VALUES ($1, $2)
       RETURNING id, email, full_name, created_at`,
      [email, full_name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Klaida. Vartotojo el. paštas jau egzistuoja' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});


export default router;
