// -----------------------------------------------------------
//  [*] DB — the shared Postgres pool
//
//  One pg.Pool for the whole backend, connected via
//  $DATABASE_URL (points at the veiklos-db container).
//  dotenv.config() runs here too because this module is
//  imported before index.js gets to its own call.
// -----------------------------------------------------------

import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();


const { Pool } = pg;







// -----------------------------------------------------------
// pool
// -----------------------------------------------------------
//
// Every query in the backend goes through this pool. SSL is
// off — the connection never leaves the isolated docker
// network.
//
// Used by:
//   - every file in routes/, and auth/attachRoles.js
// -----------------------------------------------------------

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});
