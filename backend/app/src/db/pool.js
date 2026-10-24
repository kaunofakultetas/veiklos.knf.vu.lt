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
// network. When Postgres ends a connection that sits idle in
// the pool (the db container restarts, the network drops), pg
// emits that client's error on the pool itself; an 'error'
// event nobody hears is thrown and would end the whole
// process, so it is logged here instead. The pool has already
// dropped the dead client and the next query opens a fresh
// connection.
//
// Used by:
//   - every file in routes/, auth/attachRoles.js and
//     db/sessionStore.js (through index.js)
// -----------------------------------------------------------

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pool.on("error", (err) => {
  console.error("db pool: idle connection lost:", err.message);
});

// A client checked out for a transaction is no longer heard
// by the pool: pg-pool drops its idle listener at checkout,
// and an 'error' pg emits on a connection that dies under a
// query would be thrown and end the process. Every client
// gets a listener of its own when it is created, so the
// failure reaches the route only as its query's rejection
pool.on("connect", (client) => {
  client.on("error", (err) => {
    console.error("db pool: connection lost:", err.message);
  });
});
