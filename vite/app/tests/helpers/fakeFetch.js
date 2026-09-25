// -----------------------------------------------------------
//  [*] Test helpers — the scripted fetch
//
//  A stand-in for window.fetch that answers from a script the
//  test writes and records every request it sees, so a test
//  can pin the CONTRACT a page keeps with the backend: the
//  method, the path, the X-Active-Role header, the body — and
//  how the page renders what comes back. Like the backend's
//  fake pool, an unscripted request throws loudly instead of
//  hanging the page. Every request and answer also passes the
//  contract guard (helpers/contractGuard.js), and the JSON a
//  page gets back is wrapped so a read outside the contract
//  is caught.
// -----------------------------------------------------------

import { guardRequest, guardReply } from "./contractGuard.js";


// The script: [{ method, path (string or RegExp), reply,
// offContract }] in registration order; the first match
// answers
const routes = [];

// Every request made since the last reset, in order:
// { method, path, url, headers (lower-cased keys), body }
// where body is the parsed JSON, the FormData, or null
const requests = [];







// -----------------------------------------------------------
// onRequest
// -----------------------------------------------------------
//
// onRequest("GET", "/api/themes", [...])            — JSON 200
// onRequest("PATCH", /^\/api\/activities\/\d+$/,
//           { status: 400, body: { error: "…" } })  — any status
// onRequest("GET", "/api/x", (req) => reply)         — computed
// onRequest("GET", "/api/x", { ok: true },
//           { offContract: true })                  — a wrong shape
//                                                     on purpose
//                                                     (robustness
//                                                     tests), not
//                                                     guarded
//
// `reply` may be a plain JSON value (200), an envelope
// { status, body, headers } — recognised only when it holds
// nothing but those keys and a NUMERIC status or a body, so
// an activity row with its own `status` column is never
// mistaken for one — or a function of the recorded request
// returning either. `body` may also be a string or a Blob
// (attachment downloads).
//
// Used by:
//   - every page test
// -----------------------------------------------------------

export function onRequest(method, path, reply, { offContract = false } = {}) {
  routes.push({ method: method.toUpperCase(), path, reply, offContract });
}







// -----------------------------------------------------------
// requestLog
// -----------------------------------------------------------
//
// The requests seen so far, oldest first; `requestsTo(method,
// path)` narrows to one endpoint.
//
// Used by:
//   - every page test
// -----------------------------------------------------------

export function requestLog() {
  return requests.slice();
}

export function requestsTo(method, path) {
  const m = method.toUpperCase();
  return requests.filter((r) => r.method === m && (path instanceof RegExp ? path.test(r.path) : r.path === path));
}







// -----------------------------------------------------------
// resetFakeFetch / installFakeFetch
// -----------------------------------------------------------
//
// resetFakeFetch() empties script and log; installFakeFetch()
// puts the fake on window.fetch (and globalThis.fetch). Both
// run from tests/setup.js before every test; a test that
// mounts a page twice with different answers resets between
// the mounts.
//
// Used by:
//   - tests/setup.js
//   - tests/pages/employee/myActivities.test.jsx,
//     tests/pages/employee/export.test.jsx — resetFakeFetch
//     between two mounts
// -----------------------------------------------------------

export function resetFakeFetch() {
  routes.length = 0;
  requests.length = 0;
}

export function installFakeFetch() {
  globalThis.fetch = fakeFetch;
  window.fetch = fakeFetch;
}







// -----------------------------------------------------------
// isReplyEnvelope
// -----------------------------------------------------------
//
// Whether a scripted reply is the { status, body, headers }
// envelope rather than the payload itself: an object whose
// keys are only those three, carrying a numeric status or a
// body. A page's row objects carry a `status` column (the
// activity state) among many other keys, so they stay
// payloads.
//
// Used by:
//   - fakeFetch (below)
// -----------------------------------------------------------

function isReplyEnvelope(reply) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply) || reply instanceof Blob) return false;
  const keys = Object.keys(reply);
  if (!keys.length || !keys.every((k) => k === "status" || k === "body" || k === "headers")) return false;
  return typeof reply.status === "number" || "body" in reply;
}







// -----------------------------------------------------------
// fakeFetch
// -----------------------------------------------------------
//
// The window.fetch replacement: records the request, finds
// the first scripted route whose method and path match, and
// builds a Response from its reply. A JSON body gets
// application/json; a string body text/plain; a Blob is sent
// as its bytes with its own type (jsdom's Blob lacks the
// stream() undici wants, so it is read out first). No match
// → an Error naming the request, which surfaces in the
// page's catch and in the test's assertions.
//
// Used by:
//   - installFakeFetch (above)
// -----------------------------------------------------------

async function fakeFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = {};
  for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;

  let body = null;
  if (init.body instanceof FormData) body = init.body;
  else if (typeof init.body === "string") {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }

  const path = url.split("?")[0];
  const req = { method, path, url, headers, body };
  requests.push(req);
  const contract = guardRequest(req);

  const route = routes.find((r) => r.method === method && (r.path instanceof RegExp ? r.path.test(path) : r.path === path));
  if (!route) throw new Error(`fakeFetch: no script for ${method} ${url}`);

  let reply = typeof route.reply === "function" ? route.reply(req) : route.reply;
  if (reply instanceof Promise) reply = await reply;
  const isEnvelope = isReplyEnvelope(reply);
  const status = isEnvelope ? (reply.status ?? 200) : 200;
  const payload = isEnvelope ? reply.body : reply;
  const extraHeaders = isEnvelope ? (reply.headers ?? {}) : {};

  if (payload instanceof Blob) {
    guardReply(contract, status, payload, route);
    return new Response(await payload.arrayBuffer(), { status, headers: { "Content-Type": payload.type || "application/octet-stream", ...extraHeaders } });
  }
  if (typeof payload === "string") {
    guardReply(contract, status, payload, route);
    return new Response(payload, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders } });
  }
  if (payload === undefined || payload === null) {
    guardReply(contract, status, null, route);
    return new Response(null, { status, headers: extraHeaders });
  }
  // The page gets the JSON through the guard's read tracker:
  // json() hands back the wrapped object, not a fresh parse
  const tracked = guardReply(contract, status, payload, route);
  const response = new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
  response.json = async () => tracked;
  return response;
}
