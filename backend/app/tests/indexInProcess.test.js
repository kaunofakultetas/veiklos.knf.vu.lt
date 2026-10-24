// -----------------------------------------------------------
//  [*] Regression — index.js booted in-process
//
//  The REAL index.js, started in this process over a fake
//  pool and an in-memory session store holding one signed-in
//  manager; the network listener it opens is captured so
//  after() can close it. Two things need the whole app this
//  way, mounts and parsers included.
//
//  Same-site form posts. The session cookie is SameSite=Lax,
//  which keeps it off CROSS-SITE requests only. Every
//  https://*.vu.lt page is the same site as
//  veiklos.knf.vu.lt — vu.lt is the registrable domain — so a
//  form on any VU-hosted page (a student's Node-RED endpoint,
//  a wiki page, an XSS on any VU app) is posted WITH a
//  signed-in user's cookie. The active-role routes are safe
//  from that: X-Active-Role is a header no form can send. The
//  role-admin routes take no such header, so the only thing
//  between them and a form is the body format: index.js
//  parses form-encoded bodies for the SAML routes only, so a
//  form posted to the API arrives with no fields. Were forms
//  parsed there, one visit by a signed-in manager to such a
//  page could make the attacker a manager. The form posts
//  must grant nothing, while the SPA's own JSON request from
//  the same origin still works.
//
//  The identity endpoints. /api/me and /api/session/check
//  are what the SPA builds its role state from; when the
//  role lookup fails they answer 500, never a signed-in user
//  with no roles, which would make the page forget the
//  active role.
// -----------------------------------------------------------

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import session from "express-session";
import { SESSION_COOKIE } from "../src/auth/sessionCookie.js";


// The signed-in manager's session id, the secret its cookie
// is signed with, and the account a forged form would promote
const SID = "same-site-manager";
const SECRET = "test-secret";
const ATTACKER_EID = "eid-atakuotojas";

// Every query the fake pool answered, in order
const queries = [];

// Set by a test to make every role lookup fail, as a database
// that is down would
let rolesFail = false;

// The servers index.js opened while booting — app.listen is
// the only one — so after() can close them again
const servers = [];

// Where the booted app writes its access log
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "veiklos-same-site-"));

let base = null;







// -----------------------------------------------------------
// fakeQuery
// -----------------------------------------------------------
//
// The pool every module of the booted app talks to: it
// answers the role lookups attachRoles makes for the manager,
// the user and role lookups of both assign routes, and every
// INSERT into user_roles — and records each query, so a test
// can see whether a role was really granted to the attacker.
// With rolesFail set, every role lookup throws instead.
//
// Used by:
//   - the db/pool.js module mock (below)
// -----------------------------------------------------------

async function fakeQuery(sql, params = []) {
  const flat = String(sql).replace(/\s+/g, " ").trim();
  queries.push({ sql: flat, params });

  if (rolesFail && /\bFROM roles\b|\bFROM user_roles\b/.test(flat)) {
    throw new Error("terminating connection due to administrator command");
  }

  if (/^SELECT id FROM roles WHERE name = \$1/.test(flat)) {
    return { rows: [{ id: params[0] === "Darbuotojas" ? 1 : 2 }], rowCount: 1 };
  }
  if (/FROM user_roles ur JOIN roles r/.test(flat)) {
    return { rows: [{ name: "Darbuotojas" }, { name: "Vadybininkas" }], rowCount: 2 };
  }
  if (/FROM users WHERE email = \$1/.test(flat)) {
    return { rows: [{ id: ATTACKER_EID, email: "atakuotojas@knf.vu.lt", full_name: "A" }], rowCount: 1 };
  }
  return { rows: [], rowCount: 1 };
}







// -----------------------------------------------------------
// MemoryStore
// -----------------------------------------------------------
//
// Stands in for the Postgres session store: the one session
// it knows is the signed-in manager's, as /assert would have
// stored it — the raw SAML attributes verifySamlSession maps
// to an eid and an email. Writes are accepted and forgotten.
//
// Used by:
//   - the db/sessionStore.js module mock (below)
// -----------------------------------------------------------

class MemoryStore extends session.Store {
  get(sid, cb) {
    if (sid !== SID) return cb(null, null);
    cb(null, {
      cookie: {
        originalMaxAge: 8 * 60 * 60 * 1000,
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        secure: true,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      },
      samlUser: {
        nameID: "nid-manager",
        sessionIndex: "sidx-manager",
        signedInAt: Date.now(),
        attributes: {
          eID: "eid-vadybininkas",
          "urn:oid:0.9.2342.19200300.100.1.3": "vadybininkas@knf.vu.lt",
        },
      },
    });
  }

  set(_sid, _sess, cb) {
    cb?.(null);
  }

  touch(_sid, _sess, cb) {
    cb?.(null);
  }

  destroy(_sid, cb) {
    cb?.(null);
  }
}


mock.module(new URL("../src/db/pool.js", import.meta.url).href, {
  namedExports: {
    pool: { query: fakeQuery, connect: async () => ({ query: fakeQuery, release() {} }), on() {} },
  },
});

mock.module(new URL("../src/db/sessionStore.js", import.meta.url).href, {
  namedExports: { PgSessionStore: MemoryStore },
});


before(async () => {
  process.env.PORT = "0";
  process.env.SESSION_SECRET = SECRET;
  process.env.LOG_DIR = logDir;
  process.env.IDP_METADATA = new URL("./fixtures/idp-metadata.xml", import.meta.url).pathname;
  process.env.SP_PRIVATE_KEY_PATH = new URL("./fixtures/fake-sp.key", import.meta.url).pathname;
  process.env.SP_CERT_PATH = new URL("./fixtures/fake-sp.crt", import.meta.url).pathname;

  const realListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    servers.push(this);
    return realListen.apply(this, args);
  };
  try {
    await import(new URL("../src/index.js", import.meta.url).href);
  } finally {
    http.Server.prototype.listen = realListen;
  }

  const [server] = servers;
  if (!server.listening) await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});


after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  fs.rmSync(logDir, { recursive: true, force: true });
});







// -----------------------------------------------------------
// managerCookie
// -----------------------------------------------------------
//
// The session cookie a browser holds after the manager
// signed in: the session id signed with the server's secret
// the way express-session signs it.
//
// Used by:
//   - the test (below)
// -----------------------------------------------------------

function managerCookie() {
  const sig = crypto.createHmac("sha256", SECRET).update(SID).digest("base64").replace(/=+$/, "");
  return `${SESSION_COOKIE}=${encodeURIComponent(`s:${SID}.${sig}`)}`;
}







// -----------------------------------------------------------
// role admin — a same-site form cannot grant a role
// -----------------------------------------------------------
//
// First the SPA's own request: JSON from the app's origin,
// with the manager's cookie — it reaches the handler and the
// role is granted, which also proves the harness is real.
// Then what a page on another VU host can make the manager's
// browser send: a plain HTML form post, form-encoded, from a
// same-site origin, the cookie attached. On neither
// /api/user-roles/assign nor /api/roles/assign may that grant
// the attacker anything.
// -----------------------------------------------------------

test("a same-site form post with a manager's cookie grants no role", async () => {
  const cookie = managerCookie();
  const grantedToAttacker = () =>
    queries.filter((q) => q.sql.startsWith("INSERT INTO user_roles") && q.params[0] === ATTACKER_EID);

  queries.length = 0;
  let res = await fetch(`${base}/api/user-roles/assign`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: base,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
    },
    body: JSON.stringify({ email: "atakuotojas@knf.vu.lt", role: "Komisijos narys" }),
  });
  assert.equal(res.status, 204, "the SPA's own JSON request must keep working");
  assert.equal(grantedToAttacker().length, 1, "the JSON request reached the handler");

  for (const [route, form] of [
    ["/api/user-roles/assign", "email=atakuotojas%40knf.vu.lt&role=Vadybininkas"],
    ["/api/roles/assign", `user_eid=${ATTACKER_EID}&role_name=Vadybininkas`],
  ]) {
    queries.length = 0;
    res = await fetch(base + route, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://kitas.knf.vu.lt",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
      body: form,
    });
    assert.notEqual(res.status, 204, `${route} accepted a same-site form`);
    assert.deepEqual(grantedToAttacker(), [], `${route} granted a role from a form`);
  }
});







// -----------------------------------------------------------
// the identity endpoints when roles cannot be loaded
// -----------------------------------------------------------
//
// With every role lookup failing, both endpoints the SPA
// builds its role state from answer the plain 500 — not a
// signed-in manager who suddenly owns no role.
// -----------------------------------------------------------

test("a failed role lookup answers /api/me and /api/session/check with 500, never an empty role list", async () => {
  rolesFail = true;
  try {
    for (const path of ["/api/me", "/api/session/check"]) {
      const res = await fetch(base + path, { headers: { Cookie: managerCookie() } });
      assert.equal(res.status, 500, path);
      assert.deepEqual(await res.json(), { error: "internal error" }, path);
    }
  } finally {
    rolesFail = false;
  }
});
