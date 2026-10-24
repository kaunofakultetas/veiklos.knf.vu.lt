// -----------------------------------------------------------
//  [*] Utils — access log
//
//  One line per request — timestamp, client address, method,
//  PATH, status, duration, and "aborted" when the client went
//  away before the answer was complete — and nothing else:
//  never the query string (it carries staff emails on the
//  roles page and whole SAML messages on the logout
//  callback), never headers, never bodies. Lines go to daily
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
// file each day, nothing to rotate), one append at a time, so
// the file keeps the order the requests finished in; without
// it, console.log. A request is written once, when its
// response finishes or when its connection closes, whichever
// comes first — a client that goes away (a cancelled
// download, a browser that gave up waiting) never finishes,
// and its line ends in "aborted". A failed append is
// reported once per process on stderr, never affects the
// response and never holds up the lines after it. `now` is
// injectable for tests.
//
// Used by:
//   - index.js — the first middleware
// -----------------------------------------------------------

export function createAccessLog({ dir, now = () => new Date() } = {}) {
  let reported = false;

  // The last append handed out; the next line chains onto it
  let previous = Promise.resolve();

  const write = (line, at) => {
    if (!dir) {
      console.log(line);
      return;
    }
    const file = path.join(dir, `access-${at.toISOString().slice(0, 10)}.log`);
    previous = previous
      .then(() => new Promise((resolve, reject) => {
        fs.appendFile(file, line + "\n", (err) => (err ? reject(err) : resolve()));
      }))
      .catch((err) => {
        if (!reported) {
          reported = true;
          console.error(`access log: cannot write ${file}:`, err.message);
        }
      });
  };

  return (req, res, next) => {
    const started = process.hrtime.bigint();
    let written = false;
    const log = (aborted) => {
      if (written) return;
      written = true;
      const at = now();
      const ms = Number((process.hrtime.bigint() - started) / 1000000n);
      write(accessLine(req, res, ms, at) + (aborted ? " aborted" : ""), at);
    };
    res.once("finish", () => log(false));
    res.once("close", () => log(true));
    next();
  };
}
