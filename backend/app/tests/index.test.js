// -----------------------------------------------------------
//  [*] Regression — index.js, black box
//
//  Spawns the REAL server (node src/index.js) as a child
//  process — no DB, no module mocks — against the real
//  sso.vu.lt descriptor in fixtures/.
//
//  Pins everything reachable without a SAML session: the
//  health probe, the session gate on /api/me and on every
//  guarded prefix as MOUNTED in index.js, the SP metadata
//  endpoint, the boot line, the login redirect target, the
//  ACS mount, the 404 fallthrough, the debug request
//  logging, that uploads/ is NOT served as static files, and
//  the JSON error handler for bodies the parser refuses.
// -----------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";


// The backend root (cwd for the children, and where uploads/
// lives)
const appRoot = new URL("..", import.meta.url).pathname;

// A throwaway SP key pair (tests/fixtures, test-only) — the
// backend refuses to boot without one
const FAKE_SP_KEY = new URL("./fixtures/fake-sp.key", import.meta.url).pathname;
const FAKE_SP_CERT = new URL("./fixtures/fake-sp.crt", import.meta.url).pathname;

// The real VU SSO IdP descriptor, as a file path
const VU_FIXTURE = new URL("./fixtures/idp-metadata.xml", import.meta.url).pathname;

// The file planted in uploads/ to prove it is not served
const probeName = `regression-static-probe-${Date.now()}.txt`;
const probePath = path.join(appRoot, "uploads", probeName);


// The spawned server: { base, child, out }
let server = null;







// -----------------------------------------------------------
// startServer
// -----------------------------------------------------------
//
// Spawns the server on a random high port and waits for its
// "API listening" line. Returns { base, child, out } —
// out.text accumulates stdout+stderr for log assertions.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

async function startServer() {
  const port = 21000 + Math.floor(Math.random() * 5000);
  const base = `http://127.0.0.1:${port}`;
  const out = { text: "" };

  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: "test-secret",
      IDP_METADATA: VU_FIXTURE,
      SP_PRIVATE_KEY_PATH: FAKE_SP_KEY,
      SP_CERT_PATH: FAKE_SP_CERT,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (out.text += d));
  child.stderr.on("data", (d) => (out.text += d));

  const deadline = Date.now() + 15_000;
  while (!out.text.includes("API listening")) {
    if (child.exitCode !== null || Date.now() > deadline) {
      throw new Error("server did not start; output:\n" + out.text);
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return { base, child, out };
}


before(async () => {
  fs.mkdirSync(path.join(appRoot, "uploads"), { recursive: true });
  fs.writeFileSync(probePath, "slaptas priedas");

  server = await startServer();
});


after(async () => {
  fs.rmSync(probePath, { force: true });
  if (!server) return;
  server.child.kill("SIGTERM");
  await once(server.child, "exit").catch(() => {});
});







// -----------------------------------------------------------
// health probe
// -----------------------------------------------------------
//
// The one route with no auth and no DB touch — the plain
// ok:true body from the real server.
// -----------------------------------------------------------

test("GET /api/health → 200 { ok: true }, no auth needed", async () => {
  const res = await fetch(`${server.base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});







// -----------------------------------------------------------
// the /api/me gate
// -----------------------------------------------------------
//
// The REAL verifySamlSession in the child process rejects a
// cookie-less call with its Lithuanian 401.
// -----------------------------------------------------------

test("GET /api/me without a session → 401 Neprisijungta", async () => {
  const res = await fetch(`${server.base}/api/me`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Neprisijungta" });
});







// -----------------------------------------------------------
// the mount-level gates
// -----------------------------------------------------------
//
// Every route that must never answer anonymously, hit on the
// REAL server with the REAL middlewares — this pins the
// index.js mounts (verifySamlSession, attachRoles) that the
// per-router tests cannot see.
// -----------------------------------------------------------

test("anonymous → 401 Neprisijungta on every guarded prefix, as mounted", async () => {
  const { base } = server;
  const cases = [
    ["GET", "/api/users"],
    ["GET", "/api/roles"],
    ["POST", "/api/roles/assign"],
    ["GET", "/api/user-roles?email=a@x"],
    ["POST", "/api/user-roles/assign"],
    ["POST", "/api/user-roles/remove"],
    ["GET", "/api/session/check"],
    ["GET", "/api/themes"],
    ["GET", "/api/activities/my"],
    ["GET", "/api/activities/pending"],
    ["GET", "/api/activities/1/attachment"],
  ];
  for (const [method, p] of cases) {
    const res = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    assert.equal(res.status, 401, `${method} ${p}`);
    assert.deepEqual(await res.json(), { error: "Neprisijungta" }, `${method} ${p}`);
  }
});







// -----------------------------------------------------------
// SP metadata — identity of the request host
// -----------------------------------------------------------
//
// The SAML SP publishes its metadata unauthenticated — the
// XML VU SSO / LitNET FEDI registers. Entity id and ACS are
// derived from the origin the request came on, so a
// different Host header yields that host's identity.
// -----------------------------------------------------------

test("SP metadata carries the identity of the request host", async () => {
  const { base } = server;
  const res = await fetch(`${base}/auth/saml/metadata`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("xml"));
  const xml = await res.text();
  assert.ok(xml.includes(`entityID="${base}/auth/saml/metadata"`));
  assert.ok(xml.includes(`${base}/auth/saml/assert`));
  assert.ok(xml.includes('Name="eID" FriendlyName="eID" isRequired="true"'));

  const other = await new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request(
      { host: u.hostname, port: u.port, path: "/auth/saml/metadata", headers: { Host: "veiklos.example" } },
      (r) => { let body = ""; r.on("data", (d) => (body += d)); r.on("end", () => resolve(body)); }
    );
    req.on("error", reject);
    req.end();
  });
  assert.ok(other.includes('entityID="http://veiklos.example/auth/saml/metadata"'));
});







// -----------------------------------------------------------
// boot log + login target
// -----------------------------------------------------------
//
// The boot line names the VU IdP, the descriptor file and
// the derived identity; /login redirects straight to
// sso.vu.lt.
// -----------------------------------------------------------

test("boots from the file and logs in at sso.vu.lt", async () => {
  const { base, out } = server;
  assert.ok(
    out.text.includes(`SAML IdP https://sso.vu.lt/saml/saml2/idp/metadata.php from ${VU_FIXTURE}; SP identity derived from the request host; SP cert SHA-256 `),
    "expected the boot line; got:\n" + out.text
  );

  const login = await fetch(`${base}/auth/saml/login`, { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.ok(
    login.headers.get("location").startsWith("https://sso.vu.lt/saml/module.php/saml/idp/singleSignOnService?SAMLRequest="),
    "login must go to sso.vu.lt, got " + login.headers.get("location")
  );
});







// -----------------------------------------------------------
// unknown route
// -----------------------------------------------------------
//
// Nothing is mounted at the path — express falls through to
// its default 404 handler.
// -----------------------------------------------------------

test("unknown route → express default 404", async () => {
  const res = await fetch(`${server.base}/api/definitely-not-a-route`);
  assert.equal(res.status, 404);
});







// -----------------------------------------------------------
// request logging
// -----------------------------------------------------------
//
// The first app.use logs every request; the health call must
// show up as BACKEND RECEIVED on the child's stdout.
// -----------------------------------------------------------

test("the debug middleware logs every request to stdout", async () => {
  const { base, out } = server;
  await fetch(`${base}/api/health`);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    out.text.includes("BACKEND RECEIVED: GET /api/health"),
    "expected the BACKEND RECEIVED debug line; got:\n" + out.text
  );
});







// -----------------------------------------------------------
// uploads/ is not served
// -----------------------------------------------------------
//
// A file planted in uploads/ is NOT reachable by URL — the
// request falls through to the 404. Attachments come only
// via the guarded GET /api/activities/:id/attachment.
// -----------------------------------------------------------

test("/uploads/<file> → 404 even for a file that exists on disk", async () => {
  const res = await fetch(`${server.base}/uploads/${probeName}`);
  assert.equal(res.status, 404);
});







// -----------------------------------------------------------
// bodies the parser refuses
// -----------------------------------------------------------
//
// A malformed JSON body is answered by our own error handler:
// 400, JSON, a Lithuanian message and no trace of the
// SyntaxError — Express's default page would print the stack.
// One over the parser's limit is a 413 the same way. A body
// that parses but is not an object is the route's problem,
// so it passes the parser and meets the session gate first.
// -----------------------------------------------------------

test("a malformed JSON body → 400 JSON without a stack trace; too large → 413", async () => {
  let res = await fetch(`${server.base}/api/user-roles/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad json",
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type"), /application\/json/);
  let text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: "Neteisingas užklausos formatas" });
  assert.ok(!/SyntaxError|\bat\s+JSON\.parse/.test(text), "no stack trace in the body");

  res = await fetch(`${server.base}/api/user-roles/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x".repeat(200 * 1024) }),
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "Užklausa per didelė" });

  res = await fetch(`${server.base}/api/user-roles/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[1,2,3]",
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Neprisijungta" });
});
