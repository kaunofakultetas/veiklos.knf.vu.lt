// -----------------------------------------------------------
//  [*] Test helpers — the API contract guard
//
//  Enforces tests/contract/api.js on every request the fake
//  fetch sees, so a page test cannot drift from the contract
//  without failing: the endpoint must be listed; a JSON body
//  may only carry the listed fields and a multipart body only
//  the listed fields in the listed order; a scripted success
//  answer must have exactly the listed fields on every object
//  (nested lists included), and a scripted error answer must
//  be { error }; and every field the page then READS from the
//  answer must be listed — an unknown read is recorded with
//  the endpoint and field, and tests/setup.js fails the test
//  on it. Robustness tests that deliberately answer with the
//  wrong shape opt out per script entry ({ offContract: true }).
// -----------------------------------------------------------

import { API } from "../contract/api.js";


// Violations recorded since the last reset — one string each
const violations = [];

// Property names read on answer objects that are not data:
// React probing children, JSON serialisation, promise
// unwrapping, plain Object.prototype traffic
const NOT_DATA = new Set([
  "then", "toJSON", "constructor", "valueOf", "toString", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__",
  "$$typeof", "key", "ref", "props", "_owner", "_store", "nodeType", "type",
  "length", "asymmetricMatch", "nodeName", "tagName", "ownerDocument", "$$isMockFunction",
]);







// -----------------------------------------------------------
// contractViolations / resetContractGuard
// -----------------------------------------------------------
//
// The violations recorded so far, and the reset tests/setup.js
// runs before every test.
//
// Used by:
//   - tests/setup.js
// -----------------------------------------------------------

export function contractViolations() {
  return violations.slice();
}

export function resetContractGuard() {
  violations.length = 0;
}







// -----------------------------------------------------------
// contractFor
// -----------------------------------------------------------
//
// contractFor("GET", "/api/activities/12/manager") → the
// contract entry and its key. Keys hold ":id"-style segments;
// the most specific match (fewest parameters) wins, as in
// express. null when nothing matches.
//
// Used by:
//   - guardRequest, guardReply (below)
// -----------------------------------------------------------

export function contractFor(method, path) {
  let best = null;
  for (const [key, entry] of Object.entries(API)) {
    const [m, pattern] = key.split(" ");
    if (m !== method.toUpperCase()) continue;
    const params = (pattern.match(/:[A-Za-z_]+/g) || []).length;
    const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]+/g, "[^/]+") + "$");
    if (re.test(path) && (!best || params < best.params)) best = { key, entry, params };
  }
  return best ? { key: best.key, entry: best.entry } : null;
}







// -----------------------------------------------------------
// guardRequest
// -----------------------------------------------------------
//
// Checks one recorded request against the contract: the
// endpoint exists; a JSON body carries only listed fields; a
// multipart body carries only listed fields, each at most
// once, in the listed relative order. Returns the contract
// match for guardReply.
//
// Used by:
//   - fakeFetch (tests/helpers/fakeFetch.js)
// -----------------------------------------------------------

export function guardRequest({ method, path, body }) {
  const match = contractFor(method, path);
  if (!match) {
    violations.push(`${method} ${path}: not in tests/contract/api.js`);
    return null;
  }
  const { key, entry } = match;
  const request = entry.request || {};

  if (body instanceof FormData) {
    const names = [...body.keys()];
    const allowed = request.form || [];
    for (const n of names) if (!allowed.includes(n)) violations.push(`${key}: multipart field "${n}" is not in the contract (${allowed.join(", ")})`);
    const positions = names.filter((n) => allowed.includes(n)).map((n) => allowed.indexOf(n));
    if (positions.some((p, i) => i > 0 && p < positions[i - 1])) violations.push(`${key}: multipart fields out of the contract's order: ${names.join(", ")}`);
    if (new Set(names).size !== names.length) violations.push(`${key}: a multipart field is sent twice: ${names.join(", ")}`);
  } else if (body && typeof body === "object") {
    if (request.empty) violations.push(`${key}: the contract says no body, one was sent`);
    const allowed = request.json || [];
    for (const k of Object.keys(body)) if (!allowed.includes(k)) violations.push(`${key}: body field "${k}" is not in the contract (${allowed.join(", ")})`);
  } else if (typeof body === "string" && body.length) {
    violations.push(`${key}: a non-JSON string body was sent`);
  }
  return match;
}







// -----------------------------------------------------------
// guardReply
// -----------------------------------------------------------
//
// Checks a scripted answer against the contract's response
// descriptor: a success answer must match its shape exactly
// ({ list: fields } → an array of objects with exactly those
// fields, { object: fields } → one such object, { none } → no
// body, { blob } → bytes or text; "field?" marks an optional
// field; `nested` describes fields that hold a list or an
// object); an error answer (4xx/5xx) with a JSON body must be
// exactly { error }. Returns the payload wrapped for read
// tracking (trackReads) when it is JSON, else the payload.
//
// Used by:
//   - fakeFetch (tests/helpers/fakeFetch.js)
// -----------------------------------------------------------

export function guardReply(match, status, payload, { offContract = false } = {}) {
  if (!match || offContract) return payload;
  const { key, entry } = match;
  const isJson = payload !== null && payload !== undefined && typeof payload !== "string" && !(payload instanceof Blob);

  if (status >= 400) {
    if (isJson) {
      const keys = Object.keys(payload);
      if (!(keys.length === 1 && keys[0] === "error" && typeof payload.error === "string")) {
        violations.push(`${key}: an error answer must be { error: string }, got keys ${keys.join(", ") || "(none)"}`);
      }
    }
    return payload;
  }

  const shape = entry.response;
  if (!shape) {
    violations.push(`${key}: the contract has no response descriptor`);
    return payload;
  }
  if (shape.none) {
    if (payload !== null && payload !== undefined) violations.push(`${key}: the contract says no body, one was scripted`);
    return payload;
  }
  if (shape.blob) {
    if (isJson) violations.push(`${key}: the contract says bytes, JSON was scripted`);
    return payload;
  }
  if (!isJson) {
    violations.push(`${key}: the contract says JSON, ${typeof payload} was scripted`);
    return payload;
  }
  checkShape(payload, shape, key, "");
  return trackReads(payload, shape, key, "");
}







// -----------------------------------------------------------
// checkShape
// -----------------------------------------------------------
//
// Recursive exact-fields check of a scripted value against a
// descriptor; every mismatch is one violation naming the
// endpoint and path inside the value.
//
// Used by:
//   - guardReply (above)
// -----------------------------------------------------------

function checkShape(value, shape, key, at) {
  const where = at || "body";
  if (shape.list) {
    if (!Array.isArray(value)) { violations.push(`${key}: ${where} must be a list`); return; }
    value.forEach((item, i) => checkObject(item, shape.list, shape.nested, key, `${where}[${i}]`));
    return;
  }
  if (shape.object) {
    checkObject(value, shape.object, shape.nested, key, where);
  }
}

function checkObject(value, fields, nested, key, where) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { violations.push(`${key}: ${where} must be an object`); return; }
  const required = fields.filter((f) => !f.endsWith("?"));
  const allowed = fields.map((f) => f.replace(/\?$/, ""));
  const keys = Object.keys(value);
  for (const k of keys) if (!allowed.includes(k)) violations.push(`${key}: ${where} has a field not in the contract: "${k}"`);
  for (const f of required) if (!keys.includes(f)) violations.push(`${key}: ${where} lacks the contract field "${f}"`);
  for (const [name, sub] of Object.entries(nested || {})) {
    if (name in value && value[name] !== null && value[name] !== undefined) checkShape(value[name], sub, key, `${where}.${name}`);
  }
}







// -----------------------------------------------------------
// trackReads
// -----------------------------------------------------------
//
// Wraps a JSON answer in proxies that let every listed field
// through (nested values wrapped with their own descriptor)
// and record a read of any other string-named field as a
// violation — the page asked the backend for something the
// contract does not promise. Arrays pass their elements
// through wrapped; symbols and the NOT_DATA names are never
// data.
//
// Used by:
//   - guardReply (above)
// -----------------------------------------------------------

function trackReads(value, shape, key, at) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const item = shape.list ? { object: shape.list, nested: shape.nested } : null;
    return new Proxy(value, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && /^\d+$/.test(prop) && item) return trackReads(v, item, key, `${at}[${prop}]`);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }
  const fields = shape.object || shape.list || [];
  const allowed = new Set(fields.map((f) => f.replace(/\?$/, "")));
  const nested = shape.nested || {};
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || NOT_DATA.has(prop)) return Reflect.get(target, prop, receiver);
      if (!allowed.has(prop)) {
        violations.push(`${key}: the page read "${prop}" on ${at || "body"}, which the contract does not list (${[...allowed].join(", ")})`);
        return undefined;
      }
      const v = Reflect.get(target, prop, receiver);
      return nested[prop] ? trackReads(v, nested[prop], key, `${at || "body"}.${prop}`) : v;
    },
  });
}
