// -----------------------------------------------------------
//  [*] Regression — utils/accessLog.js
//
//  The access line's shape (path only, never the query), the
//  file mode (one file per UTC day under the directory,
//  appended, a new file when the day turns) and the stdout
//  fallback without a directory, and one line for a request
//  whose client went away — all against fake request /
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

// The lines of a log file once it holds `count` of them: the
// appends go one after another, so under the full suite's
// load the last line can take a while; after two seconds it
// gives up and returns what is there
async function linesIn(file, count) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    if (lines.length >= count || Date.now() > deadline) return lines;
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The duration is real elapsed time — 0 ms alone, sometimes 1
// under the full suite's load — so lines written through the
// middleware are compared with it replaced by "<n>ms", after
// checking it is a whole number of milliseconds
const DURATION = / \d+ms$/;
const withoutDuration = (line) => {
  assert.match(line, DURATION);
  return line.replace(DURATION, " <n>ms");
};







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
    assert.equal(nextCalled, 2);
    const first = await linesIn(path.join(dir, "access-2026-09-25.log"), 2);
    assert.deepEqual(first.map((l) => withoutDuration(l.split(" ").slice(2).join(" "))), ["GET /api/themes 200 <n>ms", "GET /api/activities/my 200 <n>ms"]);

    clock = new Date("2026-09-26T00:00:01.000Z");
    const { req, res } = exchange({ url: "/api/me", status: 401 });
    middleware(req, res, () => nextCalled++);
    res.emit("finish");
    const second = await linesIn(path.join(dir, "access-2026-09-26.log"), 1);
    assert.deepEqual(second.map(withoutDuration), ["2026-09-26T00:00:01.000Z 10.0.0.5 GET /api/me 401 <n>ms"]);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["access-2026-09-25.log", "access-2026-09-26.log"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});







// -----------------------------------------------------------
// file mode — one append at a time
// -----------------------------------------------------------
//
// Two appends started together can complete in either order,
// so the lines of two requests finishing at once could land
// swapped. A line is handed to the file only once the append
// before it has completed, so the file keeps the order the
// requests finished in. appendFile is replaced here, so the
// test decides when each append completes.
// -----------------------------------------------------------

test("file mode: a line waits for the append before it, so the file keeps the finish order", async (t) => {
  const appended = [];
  const pending = [];
  t.mock.method(fs, "appendFile", (file, data, cb) => {
    appended.push(data);
    pending.push(cb);
  });
  const middleware = createAccessLog({ dir: os.tmpdir(), now: () => new Date("2026-09-25T10:00:00.000Z") });
  const settled = () => new Promise((r) => setImmediate(r));

  for (const url of ["/api/themes", "/api/activities/my"]) {
    const { req, res } = exchange({ url });
    middleware(req, res, () => {});
    res.emit("finish");
  }
  await settled();
  assert.equal(appended.length, 1, "the second line waits for the first append");

  pending.shift()(null);
  await settled();
  assert.equal(appended.length, 2);
  assert.match(appended[0], / GET \/api\/themes 200 /);
  assert.match(appended[1], / GET \/api\/activities\/my 200 /);
  pending.shift()(null);
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
  assert.deepEqual(printed.map(withoutDuration), ["2026-09-25T10:00:00.000Z 10.0.0.5 GET /api/health 200 <n>ms"]);
});







// -----------------------------------------------------------
// a request the client gave up on
// -----------------------------------------------------------
//
// index.js promises every request as one line, and a
// response whose client went away (a cancelled attachment
// download, a browser that gave up on a slow query) never
// finishes, it only closes. Such a request still leaves
// exactly one line, and a finished one, which closes after
// finishing, does not leave two.
// -----------------------------------------------------------

test("a request whose client went away still leaves one line; a finished one exactly one", async (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  const middleware = createAccessLog();

  const gone = exchange({ url: "/api/activities/10/attachment" });
  middleware(gone.req, gone.res, () => {});
  gone.res.emit("close");

  const done = exchange({ url: "/api/themes" });
  middleware(done.req, done.res, () => {});
  done.res.emit("finish");
  done.res.emit("close");

  await flushed();
  assert.equal(lines.filter((l) => l.includes(" /api/activities/10/attachment ")).length, 1, "the abandoned request");
  assert.equal(lines.filter((l) => l.includes(" /api/themes ")).length, 1, "the finished request");
});
