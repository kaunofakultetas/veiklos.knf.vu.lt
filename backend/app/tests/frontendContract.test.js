// -----------------------------------------------------------
//  [*] Regression — the SPA ↔ backend API contract
//
//  The backend's OWN copy of what the SPA calls — every
//  endpoint each page fetches, with the method and whether it
//  sends X-Active-Role — pinned against the route table read
//  straight from the backend's code: every call has a route
//  with that method and path; every route behind an active
//  role is called WITH the header, from a page of a role the
//  route allows; and the routes nothing calls are exactly
//  the known ones, so a route that goes dead fails here.
//
//  Nothing of the frontend is read: the two sides each keep
//  their own copy of the contract — SPA_CALLS here, and the
//  page tests in vite/app/tests, which pin what each page
//  sends and what it expects back. When either side changes
//  an endpoint, BOTH copies must move, and this file names
//  the one that did not.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SAML_BASE_PATH } from "../src/utils/saml.js";


const BACKEND_SRC = new URL("../src/", import.meta.url).pathname;

// The SPA's role names, as the pages send them in
// X-Active-Role (read from localStorage "activeRole")
const EMPLOYEE = "Darbuotojas";
const MANAGER = "Vadybininkas";
const COMMITTEE = "Komisijos narys";







// -----------------------------------------------------------
// SPA_CALLS
// -----------------------------------------------------------
//
// One entry per (page, method, path) the SPA fetches. `role`
// is the workspace the page lives in — the X-Active-Role it
// sends when `activeRole` is true; null for the shared
// pieces (App.jsx, appHeader.jsx). Paths use ":p" for a
// segment the page fills in; query strings are not part of
// the route. The roles page is the one manager page that
// sends NO X-Active-Role: its routers check ownership only.
//
// Used by:
//   - the contract tests (below)
// -----------------------------------------------------------

const SPA_CALLS = [
  // App.jsx — the session probe on load
  { page: "App.jsx", role: null, method: "GET", path: "/api/session/check", activeRole: false },

  // components/appHeader.jsx — roles + name, sign-out
  { page: "components/appHeader.jsx", role: null, method: "GET", path: "/api/me", activeRole: false },
  { page: "components/appHeader.jsx", role: null, method: "POST", path: `${SAML_BASE_PATH}/logout`, activeRole: false },

  // pages/employee/newActivity.jsx
  { page: "pages/employee/newActivity.jsx", role: EMPLOYEE, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/employee/newActivity.jsx", role: EMPLOYEE, method: "POST", path: "/api/activities", activeRole: true },

  // pages/employee/myActivities.jsx
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "GET", path: "/api/activities/my", activeRole: true },
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "GET", path: "/api/activities/:p/attachment", activeRole: true },
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "PATCH", path: "/api/activities/:p", activeRole: true },
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "DELETE", path: "/api/activities/:p", activeRole: true },
  { page: "pages/employee/myActivities.jsx", role: EMPLOYEE, method: "POST", path: "/api/activities/:p/resubmit", activeRole: true },

  // pages/employee/export.jsx
  { page: "pages/employee/export.jsx", role: EMPLOYEE, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/employee/export.jsx", role: EMPLOYEE, method: "GET", path: "/api/activities/my", activeRole: true },

  // pages/manager/roles.jsx — ownership-guarded routers
  { page: "pages/manager/roles.jsx", role: MANAGER, method: "GET", path: "/api/me", activeRole: false },
  { page: "pages/manager/roles.jsx", role: MANAGER, method: "GET", path: "/api/user-roles", activeRole: false },
  { page: "pages/manager/roles.jsx", role: MANAGER, method: "POST", path: "/api/user-roles/assign", activeRole: false },
  { page: "pages/manager/roles.jsx", role: MANAGER, method: "POST", path: "/api/user-roles/remove", activeRole: false },

  // pages/manager/review.jsx
  { page: "pages/manager/review.jsx", role: MANAGER, method: "GET", path: "/api/activities/pending", activeRole: true },
  { page: "pages/manager/review.jsx", role: MANAGER, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/manager/review.jsx", role: MANAGER, method: "GET", path: "/api/activities/:p/attachment", activeRole: true },
  { page: "pages/manager/review.jsx", role: MANAGER, method: "PATCH", path: "/api/activities/:p/manager", activeRole: true },

  // pages/manager/themes.jsx — through its apiFetch wrapper
  { page: "pages/manager/themes.jsx", role: MANAGER, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/manager/themes.jsx", role: MANAGER, method: "POST", path: "/api/themes", activeRole: true },
  { page: "pages/manager/themes.jsx", role: MANAGER, method: "POST", path: "/api/themes/:p/subthemes", activeRole: true },
  { page: "pages/manager/themes.jsx", role: MANAGER, method: "DELETE", path: "/api/themes/:p", activeRole: true },
  { page: "pages/manager/themes.jsx", role: MANAGER, method: "DELETE", path: "/api/themes/subthemes/:p", activeRole: true },

  // pages/manager/export.jsx
  { page: "pages/manager/export.jsx", role: MANAGER, method: "GET", path: "/api/activities/all", activeRole: true },
  { page: "pages/manager/export.jsx", role: MANAGER, method: "GET", path: "/api/themes", activeRole: true },

  // pages/committee/evaluate.jsx
  { page: "pages/committee/evaluate.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/committee", activeRole: true },
  { page: "pages/committee/evaluate.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/:p/attachment", activeRole: true },
  { page: "pages/committee/evaluate.jsx", role: COMMITTEE, method: "PATCH", path: "/api/activities/:p/committee", activeRole: true },

  // pages/committee/results.jsx
  { page: "pages/committee/results.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/evaluated", activeRole: true },
  { page: "pages/committee/results.jsx", role: COMMITTEE, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/committee/results.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/:p/attachment", activeRole: true },
  { page: "pages/committee/results.jsx", role: COMMITTEE, method: "PATCH", path: "/api/activities/:p/committee", activeRole: true },

  // pages/committee/calculate.jsx
  { page: "pages/committee/calculate.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/evaluated/theme-totals", activeRole: true },
  { page: "pages/committee/calculate.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/evaluated/employees", activeRole: true },
  { page: "pages/committee/calculate.jsx", role: COMMITTEE, method: "GET", path: "/api/activities/evaluated/employee/:p/subthemes", activeRole: true },
  { page: "pages/committee/calculate.jsx", role: COMMITTEE, method: "PATCH", path: "/api/themes/:p/pointvalue", activeRole: true },

  // pages/committee/limits.jsx
  { page: "pages/committee/limits.jsx", role: COMMITTEE, method: "GET", path: "/api/themes", activeRole: true },
  { page: "pages/committee/limits.jsx", role: COMMITTEE, method: "PATCH", path: "/api/themes/:p/total-sum", activeRole: true },
  { page: "pages/committee/limits.jsx", role: COMMITTEE, method: "PATCH", path: "/api/themes/subthemes/:p/cap", activeRole: true },
];







// -----------------------------------------------------------
// KNOWN_UNCALLED
// -----------------------------------------------------------
//
// Backend routes the SPA does not call, on purpose: the
// health probe (nothing wired), the SAML endpoints the
// BROWSER is sent to (navigations and the IdP's own calls),
// the manager routers the roles page does not use, and the
// two theme/subtheme edit routes the themes admin has no UI
// for (their banners say so).
//
// Used by:
//   - the uncalled-routes test (below)
// -----------------------------------------------------------

const KNOWN_UNCALLED = [
  "GET /api/health",
  "GET /api/roles",
  "POST /api/roles/assign",
  "GET /api/users",
  "PATCH /api/themes/:p",
  "PATCH /api/themes/subthemes/:p",
  `GET ${SAML_BASE_PATH}/metadata`,
  `GET ${SAML_BASE_PATH}/login`,
  `POST ${SAML_BASE_PATH}/assert`,
  `GET ${SAML_BASE_PATH}/logout/callback`,
];







// -----------------------------------------------------------
// backendRoutes
// -----------------------------------------------------------
//
// The route table as index.js mounts it: every
// router.<method>("<path>", …) in routes/*.js under its mount
// prefix, plus the app-level routes, each with the active
// roles its guard demands (the guard constant named in the
// registration, resolved to requireActiveRoleIn([...])) or
// null when the route needs no X-Active-Role. Read from the
// source so a new or renamed route cannot be missed.
//
// Used by:
//   - the contract tests (below)
// -----------------------------------------------------------

function backendRoutes() {
  const index = fs.readFileSync(path.join(BACKEND_SRC, "index.js"), "utf8");
  const imports = Object.fromEntries(
    [...index.matchAll(/import\s+(\w+)\s+from\s+["']\.\/routes\/(\w+)\.js["']/g)].map((m) => [m[1], `${m[2]}.js`])
  );
  const prefixes = {};
  for (const m of index.matchAll(/app\.use\(\s*["']([^"']+)["'][^;]*?\b(\w+Router)\s*\)/g)) prefixes[imports[m[2]]] = m[1];
  assert.ok(/app\.use\(SAML_BASE_PATH, createSamlRouter\(/.test(index), "index.js mounts the SAML router at SAML_BASE_PATH");
  prefixes["saml.js"] = SAML_BASE_PATH;

  const routes = [];
  for (const m of index.matchAll(/app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], file: "index.js", activeRoles: null });
  }

  for (const [file, prefix] of Object.entries(prefixes)) {
    const src = fs.readFileSync(path.join(BACKEND_SRC, "routes", file), "utf8");
    const guards = {};
    for (const g of src.matchAll(/const\s+(\w+)\s*=\s*\[([^\]]*)\]/g)) {
      const roles = [...g[2].matchAll(/requireActiveRoleIn\(\[([^\]]*)\]\)/g)].flatMap((r) => [...r[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
      guards[g[1]] = roles.length ? roles : null;
    }
    for (const r of src.matchAll(/\b(?:router|samlRouter)\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']\s*,([\s\S]*?)(?=async\s*\(|\(\s*_?req\b|\b\w+\s*\)\s*;)/g)) {
      const args = r[3];
      let activeRoles = null;
      for (const name of args.match(/\b\w+\b/g) ?? []) if (guards[name]) activeRoles = guards[name];
      for (const inl of args.matchAll(/requireActiveRoleIn\(\[([^\]]*)\]\)/g)) activeRoles = [...inl[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
      routes.push({ method: r[1].toUpperCase(), path: prefix + (r[2] === "/" ? "" : r[2]), file: `routes/${file}`, activeRoles });
    }
  }
  return routes;
}







// -----------------------------------------------------------
// normalise / key
// -----------------------------------------------------------
//
// One spelling for a route with parameters: every ":name"
// (backend) or ":p" (SPA_CALLS) segment becomes ":p", so
// "/api/activities/:id/manager" and "/api/activities/:p/manager"
// are the same key.
//
// Used by:
//   - the contract tests (below)
// -----------------------------------------------------------

const normalise = (p) => p.replace(/:[A-Za-z_]+/g, ":p").replace(/\/+$/, "") || "/";
const key = (r) => `${r.method} ${normalise(r.path)}`;







// -----------------------------------------------------------
// the table itself
// -----------------------------------------------------------
//
// SPA_CALLS is hand-kept, so its own consistency is pinned:
// no duplicate (page, method, path), no query strings, every
// page-bound role a known one, and the shared pieces sending
// no active role.
// -----------------------------------------------------------

test("SPA_CALLS: unique entries, clean paths, known roles", () => {
  const seen = new Set();
  for (const c of SPA_CALLS) {
    const k = `${c.page} ${key(c)}`;
    assert.ok(!seen.has(k), `duplicate entry ${k}`);
    seen.add(k);
    assert.ok(!c.path.includes("?"), `${k}: query strings are not part of the route`);
    assert.ok([null, EMPLOYEE, MANAGER, COMMITTEE].includes(c.role), `${k}: unknown role ${c.role}`);
    if (c.role === null) assert.equal(c.activeRole, false, `${k}: a shared piece has no active role to send`);
  }
  assert.equal(SPA_CALLS.length, 42);
});







// -----------------------------------------------------------
// every SPA call has a route
// -----------------------------------------------------------
//
// Method + normalised path of each entry must match a backend
// route. A miss names the page and what it asks for — either
// the SPA calls something the backend never served, or a
// backend route moved without the table.
// -----------------------------------------------------------

test("every SPA call names a backend route with that method and path", () => {
  const routes = backendRoutes();
  assert.ok(routes.length >= 30, `expected the backend's routes, found ${routes.length}`);
  const table = new Map(routes.map((r) => [key(r), r]));
  const missing = SPA_CALLS.filter((c) => !table.has(key(c))).map((c) => `${c.page}: ${key(c)}`);
  assert.deepEqual(missing, [], "SPA calls with no backend route:\n  " + missing.join("\n  "));
});







// -----------------------------------------------------------
// active-role routes are called correctly
// -----------------------------------------------------------
//
// A route behind requireActiveRoleIn answers 400 without the
// header and 403 for a role it does not allow — so every SPA
// call to one must send X-Active-Role, from a page whose
// role the route accepts. And the other way round: a page
// sending the header to a route that ignores it is noted, so
// the table says what actually matters.
// -----------------------------------------------------------

test("every call to an active-role route sends X-Active-Role from a page of an allowed role", () => {
  const table = new Map(backendRoutes().map((r) => [key(r), r]));
  const problems = [];
  for (const c of SPA_CALLS) {
    const route = table.get(key(c));
    if (!route) continue;
    if (route.activeRoles) {
      if (!c.activeRole) problems.push(`${c.page}: ${key(c)} sends no X-Active-Role (route wants ${route.activeRoles.join("/")})`);
      else if (!route.activeRoles.includes(c.role)) problems.push(`${c.page}: ${key(c)} from a ${c.role} page, route allows ${route.activeRoles.join("/")}`);
    }
  }
  assert.deepEqual(problems, [], "active-role contract broken:\n  " + problems.join("\n  "));

  // GET /api/themes is the one shared read every workspace
  // calls: it must stay session-only, or two workspaces break
  assert.equal(table.get("GET /api/themes").activeRoles, null);
});







// -----------------------------------------------------------
// the uncalled routes are the known ones
// -----------------------------------------------------------
//
// Pinned both ways: a backend route nothing calls any more
// shows up here (delete it, or add it to KNOWN_UNCALLED with
// a reason), and a KNOWN_UNCALLED route the SPA has started
// using drops out of the list.
// -----------------------------------------------------------

test("backend routes the SPA never calls are exactly the known ones", () => {
  const called = new Set(SPA_CALLS.map(key));
  const uncalled = backendRoutes().map(key).filter((k) => !called.has(k)).sort();
  assert.deepEqual(uncalled, [...KNOWN_UNCALLED].map((k) => key({ method: k.split(" ")[0], path: k.split(" ")[1] })).sort());
});
