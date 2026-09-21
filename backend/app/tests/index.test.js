// -----------------------------------------------------------
//  [*] Regression — index.js, black box
//
//  Spawns the REAL server (node src/index.js) as a child
//  process — no DB, no module mocks. The new index.js boots
//  by fetching Keycloak's SAML IdP metadata, so the test
//  first starts a tiny stub HTTP server serving minimal IdP
//  metadata and points KEYCLOAK_METADATA_URL at it.
//
//  Pins everything reachable without a SAML session: the
//  health probe, the session gate on /api/me, the SP metadata
//  endpoint, the 404 fallthrough, the debug request logging,
//  and the unauthenticated /uploads static mount (a known
//  hole, pinned as an expected failure).
// -----------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";


// The backend root (cwd for the child, and where uploads/
// lives)
const appRoot = new URL("..", import.meta.url).pathname;

// A random high port per run — the child binds it for real
const PORT = 21000 + Math.floor(Math.random() * 5000);
const base = `http://127.0.0.1:${PORT}`;

// The file planted in uploads/ for the static-mount probe
const probeName = `regression-static-probe-${Date.now()}.txt`;
const probePath = path.join(appRoot, "uploads", probeName);

// Minimal SAML IdP metadata — just enough for samlify to
// build the IdentityProvider at boot (no signing demanded,
// so no SP keys are needed either)
const IDP_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://test-idp/metadata">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="http://test-idp/sso"/>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="http://test-idp/slo"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

let idpStub;
let child;
let stdout = "";







// -----------------------------------------------------------
// startIdpStub
// -----------------------------------------------------------
//
// One-endpoint HTTP server answering every request with the
// fake IdP metadata; its ephemeral port feeds
// KEYCLOAK_METADATA_URL.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

async function startIdpStub() {
  idpStub = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/xml");
    res.end(IDP_METADATA);
  });
  idpStub.listen(0, "127.0.0.1");
  await once(idpStub, "listening");
  return `http://127.0.0.1:${idpStub.address().port}/metadata`;
}







// -----------------------------------------------------------
// startServer
// -----------------------------------------------------------
//
// Spawns the server with the stubbed Keycloak URL and waits
// for its "API listening" line. No DB — none of the routes
// exercised here touch it.
//
// Used by:
//   - the before() hook (below)
// -----------------------------------------------------------

async function startServer(metadataUrl) {
  child = spawn(process.execPath, ["src/index.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_BASE_URL: base,
      SESSION_SECRET: "test-secret",
      KEYCLOAK_METADATA_URL: metadataUrl,
      KEYCLOAK_PUBLIC_BASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stdout += d));

  const deadline = Date.now() + 15_000;
  while (!stdout.includes("API listening")) {
    if (child.exitCode !== null || Date.now() > deadline) {
      throw new Error("server did not start; output:\n" + stdout);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}


before(async () => {
  fs.mkdirSync(path.join(appRoot, "uploads"), { recursive: true });
  fs.writeFileSync(probePath, "slaptas priedas");
  const metadataUrl = await startIdpStub();
  await startServer(metadataUrl);
});


after(async () => {
  fs.rmSync(probePath, { force: true });
  if (child) {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
  }
  if (idpStub) idpStub.close();
});







// -----------------------------------------------------------
// health probe
// -----------------------------------------------------------
//
// The one route with no auth and no DB touch — the plain
// ok:true body from the real server.
// -----------------------------------------------------------

test("GET /api/health → 200 { ok: true }, no auth needed", async () => {
  const res = await fetch(`${base}/api/health`);
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
  const res = await fetch(`${base}/api/me`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Neprisijungta" });
});







// -----------------------------------------------------------
// SP metadata
// -----------------------------------------------------------
//
// The SAML SP publishes its metadata unauthenticated — the
// XML the IdP (or LitNET FEDI) registers. Pins the content
// type and the enriched EntityDescriptor.
// -----------------------------------------------------------

test("GET /auth/saml/metadata → XML with an EntityDescriptor", async () => {
  const res = await fetch(`${base}/auth/saml/metadata`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type").includes("xml"));
  const xml = await res.text();
  assert.ok(xml.includes("EntityDescriptor"));
  assert.ok(xml.includes(`${base}/auth/saml/assert`));
});







// -----------------------------------------------------------
// unknown route
// -----------------------------------------------------------
//
// Nothing is mounted at the path — express falls through to
// its default 404 handler.
// -----------------------------------------------------------

test("unknown route → express default 404", async () => {
  const res = await fetch(`${base}/api/definitely-not-a-route`);
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
  await fetch(`${base}/api/health`);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    stdout.includes("BACKEND RECEIVED: GET /api/health"),
    "expected the BACKEND RECEIVED debug line; got:\n" + stdout
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
    const res = await fetch(`${base}/uploads/${probeName}`);
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  }
);
