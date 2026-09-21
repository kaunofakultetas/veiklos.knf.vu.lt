// -----------------------------------------------------------
//  [*] Regression — index.js, black box
//
//  Spawns the REAL server (node src/index.js) as a child
//  process — no DB, no module mocks — twice, both against the
//  real sso.vu.lt descriptor in fixtures/:
//
//    plain — SP identity derived from the request host
//    lab   — SP_ENTITY_ID / SP_ACS_URL reusing lab.knf.vu.lt's
//            registration
//
//  Pins everything reachable without a SAML session: the
//  health probe, the session gate on /api/me, the SP metadata
//  endpoint, the boot line, the login redirect target, the
//  ACS mounts, the 404 fallthrough, the debug request
//  logging, and the
//  unauthenticated /uploads static mount (a known hole,
//  pinned as an expected failure).
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

// The real VU SSO IdP descriptor, as a file path
const VU_FIXTURE = new URL("./fixtures/vu-idp-metadata.xml", import.meta.url).pathname;

// lab.knf.vu.lt's registered identity
const LAB_ENTITY = "https://lab.knf.vu.lt";
const LAB_ACS_PATH = "/simplesaml/module.php/saml/sp/saml2-acs.php/default-sp";

// The file planted in uploads/ for the static-mount probe
const probeName = `regression-static-probe-${Date.now()}.txt`;
const probePath = path.join(appRoot, "uploads", probeName);


// One entry per spawned server: { base, child, out }
const servers = { plain: null, lab: null };







// -----------------------------------------------------------
// startServer
// -----------------------------------------------------------
//
// Spawns the server on a random high port with the given
// extra env and waits for its "API listening" line. Returns
// { base, child, out } — out.text accumulates stdout+stderr
// for log assertions.
//
// Used by:
//   - the before() hook (below), once per identity mode
// -----------------------------------------------------------

async function startServer(extraEnv) {
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
      ...extraEnv,
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

  servers.plain = await startServer({});
  servers.lab = await startServer({
    SP_ENTITY_ID: LAB_ENTITY,
    SP_ACS_URL: `${LAB_ENTITY}${LAB_ACS_PATH}`,
  });
});


after(async () => {
  fs.rmSync(probePath, { force: true });
  for (const s of Object.values(servers)) {
    if (!s) continue;
    s.child.kill("SIGTERM");
    await once(s.child, "exit").catch(() => {});
  }
});







// -----------------------------------------------------------
// health probe
// -----------------------------------------------------------
//
// The one route with no auth and no DB touch — the plain
// ok:true body from the real server.
// -----------------------------------------------------------

test("GET /api/health → 200 { ok: true }, no auth needed", async () => {
  const res = await fetch(`${servers.plain.base}/api/health`);
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
  const res = await fetch(`${servers.plain.base}/api/me`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Neprisijungta" });
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

test("plain: SP metadata carries the identity of the request host", async () => {
  const { base } = servers.plain;
  const res = await fetch(`${base}/auth/saml/metadata`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("xml"));
  const xml = await res.text();
  assert.ok(xml.includes(`entityID="${base}/auth/saml/metadata"`));
  assert.ok(xml.includes(`${base}/auth/saml/assert`));
  assert.ok(xml.includes('FriendlyName="uid" isRequired="true"'));

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
// plain — boot log + login target
// -----------------------------------------------------------
//
// The boot line names the VU IdP, the descriptor file and
// the derived identity; /login redirects straight to
// sso.vu.lt.
// -----------------------------------------------------------

test("plain: boots from the file and logs in at sso.vu.lt", async () => {
  const { base, out } = servers.plain;
  assert.ok(
    out.text.includes(`SAML IdP https://sso.vu.lt/SSO/saml2/idp/metadata.php from ${VU_FIXTURE}; SP identity derived from the request host`),
    "expected the boot line; got:\n" + out.text
  );

  const login = await fetch(`${base}/auth/saml/login`, { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.ok(
    login.headers.get("location").startsWith("https://sso.vu.lt/SSO/saml2/idp/SSOService.php?SAMLRequest="),
    "login must go to sso.vu.lt, got " + login.headers.get("location")
  );
});







// -----------------------------------------------------------
// lab overrides — boot log, identity, login target
// -----------------------------------------------------------
//
// Booted with the lab overrides: the boot line names lab's
// entity id; the SP metadata carries lab's entity id and ACS
// whatever host asked; /login still goes to sso.vu.lt.
// -----------------------------------------------------------

test("lab: boot line, pinned identity, login at sso.vu.lt", async () => {
  const { base, out } = servers.lab;
  assert.ok(
    out.text.includes(`SAML IdP https://sso.vu.lt/SSO/saml2/idp/metadata.php from ${VU_FIXTURE}; SP identity ${LAB_ENTITY}`),
    "expected the boot line; got:\n" + out.text
  );

  const xml = await (await fetch(`${base}/auth/saml/metadata`)).text();
  assert.ok(xml.includes(`entityID="${LAB_ENTITY}"`));
  assert.ok(xml.includes(`Location="${LAB_ENTITY}${LAB_ACS_PATH}"`));

  const login = await fetch(`${base}/auth/saml/login`, { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.ok(login.headers.get("location").startsWith("https://sso.vu.lt/SSO/saml2/idp/SSOService.php?SAMLRequest="));
});







// -----------------------------------------------------------
// lab overrides — both ACS mounts answer
// -----------------------------------------------------------
//
// A garbage assertion POSTed to lab's ACS path and to the
// default /auth/saml/assert both reach the assert handler
// (401 from the parser), proving the custom mount.
// -----------------------------------------------------------

test("lab: the custom ACS path and the default both reach the handler", async () => {
  const { base } = servers.lab;
  for (const p of [LAB_ACS_PATH, "/auth/saml/assert"]) {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "SAMLResponse=bm90LXhtbA%3D%3D",
    });
    assert.equal(res.status, 401, p);
    assert.ok((await res.text()).startsWith("SAML assertion parsing failed"), p);
  }
});







// -----------------------------------------------------------
// plain — no custom ACS mount
// -----------------------------------------------------------
//
// Without SP_ACS_URL lab's path is not served — it falls
// through to the 404.
// -----------------------------------------------------------

test("plain: lab's ACS path is NOT mounted", async () => {
  const res = await fetch(servers.plain.base + LAB_ACS_PATH, { method: "POST" });
  assert.equal(res.status, 404);
});







// -----------------------------------------------------------
// unknown route
// -----------------------------------------------------------
//
// Nothing is mounted at the path — express falls through to
// its default 404 handler.
// -----------------------------------------------------------

test("unknown route → express default 404", async () => {
  const res = await fetch(`${servers.plain.base}/api/definitely-not-a-route`);
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
  const { base, out } = servers.plain;
  await fetch(`${base}/api/health`);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    out.text.includes("BACKEND RECEIVED: GET /api/health"),
    "expected the BACKEND RECEIVED debug line; got:\n" + out.text
  );
});







// -----------------------------------------------------------
// BUG — open /uploads mount
// -----------------------------------------------------------
//
// A file planted in uploads/ is fetched with zero
// credentials. Desired: 401/403; shipped behavior: 200 with
// the file body.
// -----------------------------------------------------------

test(
  "BUG: /uploads serves attachments without any auth — should be 401/403",
  { todo: "known hole: express.static on /uploads has no auth; downloads are supposed to go through GET /api/activities/:id/attachment" },
  async () => {
    const res = await fetch(`${servers.plain.base}/uploads/${probeName}`);
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  }
);
