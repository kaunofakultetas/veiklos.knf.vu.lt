// -----------------------------------------------------------
//  [*] Utils — access log
//
//  One line per finished request — timestamp, client address,
//  method, PATH, status, duration — and nothing else: never
//  the query string (it carries staff emails on the roles
//  page and whole SAML messages on the logout callback),
//  never headers, never bodies. Lines are appended to daily
//  files <LOG_DIR>/access-YYYY-MM-DD.log — the _LOGS/backend
//  mount in compose, the one writable place on the read-only
//  rootfs — or, without LOG_DIR, printed to stdout, which is
//  what a bare `node src/index.js` and the test harness get.
// -----------------------------------------------------------

import fs from "node:fs";
import path from "node:path";







// -----------------------------------------------------------
// accessLine
// -----------------------------------------------------------
//
// accessLine(req, res, ms) → "2026-09-25T10:00:00.000Z
// 172.19.1.5 GET /api/themes 200 12ms". The path is
// originalUrl up to the first "?" (so the mount prefix is
// kept and the query is not); the address is req.ip, which
// behind the trusted ingress is the client's forwarded one.
//
// Used by:
//   - createAccessLog (below)
// -----------------------------------------------------------

export function accessLine(req, res, ms, at = new Date()) {
  const url = req.originalUrl ?? req.url ?? "";
  const pathOnly = url.split("?")[0];
  return `${at.toISOString()} ${req.ip ?? "-"} ${req.method} ${pathOnly} ${res.statusCode} ${ms}ms`;
}







// -----------------------------------------------------------
// createAccessLog
// -----------------------------------------------------------
//
// createAccessLog({ dir }) → express middleware. With dir,
// each line is appended to dir/access-<UTC day>.log (a new
// file each day, nothing to rotate); without it, console.log.
// A failed append is reported once per process on stderr and
// never affects the response. `now` is injectable for tests.
//
// Used by:
//   - index.js — the first middleware
// -----------------------------------------------------------

export function createAccessLog({ dir, now = () => new Date() } = {}) {
  let reported = false;

  const write = (line, at) => {
    if (!dir) {
      console.log(line);
      return;
    }
    const file = path.join(dir, `access-${at.toISOString().slice(0, 10)}.log`);
    fs.appendFile(file, line + "\n", (err) => {
      if (err && !reported) {
        reported = true;
        console.error(`access log: cannot write ${file}:`, err.message);
      }
    });
  };

  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const at = now();
      const ms = Number((process.hrtime.bigint() - started) / 1000000n);
      write(accessLine(req, res, ms, at), at);
    });
    next();
  };
}
