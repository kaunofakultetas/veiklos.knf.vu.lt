// -----------------------------------------------------------
//  [*] Regression — db/pool.js
//
//  The shared pool must survive a database that goes away
//  under it. When Postgres ends a connection that sits idle
//  in the pool (the db container restarts, the network
//  drops), pg re-emits that client's error on the pool
//  itself. An 'error' event nobody listens to is thrown by
//  Node's EventEmitter, so the pool needs a listener — or
//  every such restart takes the whole backend process down
//  with it.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";







// -----------------------------------------------------------
// idle client errors
// -----------------------------------------------------------
//
// What pg does when the server terminates an idle connection
// is emit the error on the pool, with the dead client as the
// second argument. The pool has already dropped that client,
// so the error is logged and swallowed — the next query opens
// a fresh connection.
// -----------------------------------------------------------

test("an idle client's connection error is logged, not thrown", (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.map(String).join(" ")));

  const err = new Error("terminating connection due to administrator command");
  assert.doesNotThrow(() => pool.emit("error", err, {}));

  assert.equal(logged.length, 1);
  assert.match(logged[0], /terminating connection due to administrator command/);
});
