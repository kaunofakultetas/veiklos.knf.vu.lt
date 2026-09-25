// -----------------------------------------------------------
//  [*] Regression — utils/accessLog.js
//
//  The access line's shape (path only, never the query), the
//  file mode (one file per UTC day under the directory,
//  appended, a new file when the day turns) and the stdout
//  fallback without a directory — all against fake request /
//  response objects, no server.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessLine, createAccessLog } from "../src/utils/accessLog.js";


// A request/response pair as express hands them to the
// middleware; res is an emitter so "finish" can be fired
function exchange({ method = "GET", url = "/api/themes", ip = "10.0.0.5", status = 200 } = {}) {
  const req = { method, originalUrl: url, ip };
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  return { req, res };
}

// appendFile is asynchronous — give it a moment
const flushed = () => new Promise((r) => setTimeout(r, 60));







// -----------------------------------------------------------
// the line
// -----------------------------------------------------------
//
// ISO timestamp, client, method, path, status, duration —
// and the path stops at the first "?" whatever follows it.
// -----------------------------------------------------------

test("accessLine: timestamp, client, method, path without query, status, duration", () => {
  const at = new Date("2026-09-25T10:00:00.000Z");
  const { req, res } = exchange({ url: "/api/user-roles?email=slaptas%40knf.vu.lt&x=1", status: 404 });
  assert.equal(accessLine(req, res, 12, at), "2026-09-25T10:00:00.000Z 10.0.0.5 GET /api/user-roles 404 12ms");

  const cb = exchange({ url: "/auth/saml/logout/callback?SAMLResponse=PHNhbWw&Signature=abc", method: "GET", status: 302 });
  assert.equal(accessLine(cb.req, cb.res, 3, at), "2026-09-25T10:00:00.000Z 10.0.0.5 GET /auth/saml/logout/callback 302 3ms");

  const noIp = exchange({ ip: null });
  assert.match(accessLine(noIp.req, noIp.res, 0, at), /Z - GET \/api\/themes 200 0ms$/);
});







// -----------------------------------------------------------
// file mode
// -----------------------------------------------------------
//
// Lines are appended to access-<day>.log in the directory;
// when the injected clock crosses midnight the next line
// opens the next day's file; next() is called at once, the
// line is written on "finish".
// -----------------------------------------------------------

test("file mode: daily files, appended, rolling with the day", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "veiklos-accesslog-"));
  try {
    let clock = new Date("2026-09-25T23:59:59.000Z");
    const middleware = createAccessLog({ dir, now: () => clock });

    let nextCalled = 0;
    for (const url of ["/api/themes?x=1", "/api/activities/my"]) {
      const { req, res } = exchange({ url });
      middleware(req, res, () => nextCalled++);
      res.emit("finish");
    }
    await flushed();
    assert.equal(nextCalled, 2);
    const first = fs.readFileSync(path.join(dir, "access-2026-09-25.log"), "utf8").trim().split("\n");
    assert.deepEqual(first.map((l) => l.split(" ").slice(2).join(" ")), ["GET /api/themes 200 0ms", "GET /api/activities/my 200 0ms"]);

    clock = new Date("2026-09-26T00:00:01.000Z");
    const { req, res } = exchange({ url: "/api/me", status: 401 });
    middleware(req, res, () => nextCalled++);
    res.emit("finish");
    await flushed();
    assert.equal(fs.readFileSync(path.join(dir, "access-2026-09-26.log"), "utf8").trim(), "2026-09-26T00:00:01.000Z 10.0.0.5 GET /api/me 401 0ms");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["access-2026-09-25.log", "access-2026-09-26.log"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});







// -----------------------------------------------------------
// stdout fallback
// -----------------------------------------------------------
//
// Without a directory the same line goes to console.log,
// nothing is written anywhere.
// -----------------------------------------------------------

test("without LOG_DIR the line is printed to stdout", async () => {
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(line);
  try {
    const middleware = createAccessLog({ now: () => new Date("2026-09-25T10:00:00.000Z") });
    const { req, res } = exchange({ url: "/api/health?probe=1" });
    middleware(req, res, () => {});
    res.emit("finish");
  } finally {
    console.log = original;
  }
  assert.deepEqual(printed, ["2026-09-25T10:00:00.000Z 10.0.0.5 GET /api/health 200 0ms"]);
});
