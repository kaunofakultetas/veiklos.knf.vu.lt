// -----------------------------------------------------------
//  [*] Test contract — the API as the SPA knows it
//
//  The frontend's own, hand-kept copy of the backend's JSON
//  contract: for every endpoint the SPA calls, exactly which
//  fields the request carries and exactly which fields the
//  answer holds. helpers/contractGuard.js enforces it on
//  every fake-fetch exchange in the page tests: a request
//  with a field not listed here, a scripted answer whose
//  objects do not have exactly these fields, or a page
//  reading a field not listed here fails the test. The
//  backend keeps its own copy in its own suite; when an
//  endpoint changes, both copies move by hand — that is the
//  point of having two.
//
//  Descriptors:
//    request  { json: [...] }  — allowed JSON body fields
//             { form: [...] }  — multipart fields, in order
//             { query: [...] } — query-string parameters
//             { empty: true }  — a POST that sends no body
//    response { list: [...] }  — an array of objects with
//                                exactly these fields
//             { object: [...] } — one such object
//             { none: true }    — no body (204)
//             { blob: true }    — bytes (a download)
//    "field?" is optional; `nested` describes a field that
//    holds a list or an object with its own descriptor.
//    Numeric columns arrive as strings (pg NUMERIC), dates as
//    ISO strings, ids as numbers; the descriptors name fields
//    only, not types.
// -----------------------------------------------------------


// Field lists shared by several activity endpoints — one
// definition each, so a row shape is pinned once
const ACTIVITY_ROW_MY = ["id", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACTIVITY_ROW_OWN = ["id", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACTIVITY_ROW_FULL = ["id", "employee_eid", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "committee_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACTIVITY_ROW_EVALUATED = ["id", "theme_id", "subtheme_id", "title", "description", "status", "created_at", "updated_at", "rejection_comment", "manager_comments", "committee_comments", "score", "attachment_path", "attachment_original_name", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACTIVITY_ROW_PENDING = ["id", "theme_id", "subtheme_id", "title", "description", "status", "created_at", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "full_name", "theme_code", "theme_title", "subtheme_code", "subtheme_title"];
const ACTIVITY_ROW_CREATED = ["id", "employee_eid", "theme_id", "subtheme_id", "title", "description", "status", "rejection_comment", "manager_comments", "score", "attachment_path", "attachment_original_name", "created_at", "updated_at"];
const ACTIVITY_FORM = ["theme_id", "subtheme_id", "title", "description", "theme_code", "subtheme_code", "attachment"];

const SUBTHEME_ROW = ["id", "theme_id", "code", "title", "description", "cap"];







// -----------------------------------------------------------
// API
// -----------------------------------------------------------
//
// "METHOD /path" → { request?, response }. A ":id" segment
// matches any one path segment; the guard picks the most
// specific key for a request.
//
// Used by:
//   - helpers/contractGuard.js — every fake-fetch exchange
//   - contract/api.test.js — the endpoint set and the shapes
// -----------------------------------------------------------

export const API = {
  // ---- session and identity
  "GET /api/session/check": {
    response: {
      object: ["user?", "roles"],
      nested: {
        user: { object: ["eid", "email", "full_name", "created_at", "last_login_at"] },
        roles: { list: ["name"] },
      },
    },
  },
  "GET /api/me": {
    response: { object: ["name", "email", "eid", "roles"] },
  },
  "POST /auth/saml/logout": {
    request: { empty: true },
    response: { object: ["redirect"] },
  },

  // ---- themes and subthemes
  "GET /api/themes": {
    response: {
      list: ["id", "code", "title", "total_sum", "pointvalue", "subthemes"],
      nested: { subthemes: { list: SUBTHEME_ROW } },
    },
  },
  "POST /api/themes": {
    request: { json: ["code", "title"] },
    response: { object: ["id", "code", "title"] },
  },
  "POST /api/themes/:id/subthemes": {
    request: { json: ["code", "title", "description"] },
    response: { object: SUBTHEME_ROW },
  },
  "DELETE /api/themes/:id": {
    response: { none: true },
  },
  "DELETE /api/themes/subthemes/:id": {
    response: { none: true },
  },
  "PATCH /api/themes/subthemes/:id/cap": {
    request: { json: ["cap"] },
    response: { object: SUBTHEME_ROW },
  },
  "PATCH /api/themes/:id/total-sum": {
    request: { json: ["total_sum"] },
    response: { object: ["id", "code", "title", "total_sum"] },
  },
  "PATCH /api/themes/:id/pointvalue": {
    request: { json: ["pointvalue"] },
    response: { object: ["id", "code", "title", "total_sum", "pointvalue"] },
  },

  // ---- activities, the employee's own
  "POST /api/activities": {
    request: { form: ACTIVITY_FORM },
    response: { object: ACTIVITY_ROW_CREATED },
  },
  "GET /api/activities/my": {
    response: { list: ACTIVITY_ROW_MY },
  },
  "GET /api/activities/:id/attachment": {
    response: { blob: true },
  },
  "PATCH /api/activities/:id": {
    request: { form: ACTIVITY_FORM },
    response: { object: ACTIVITY_ROW_OWN },
  },
  "DELETE /api/activities/:id": {
    response: { none: true },
  },
  "POST /api/activities/:id/resubmit": {
    request: { empty: true },
    response: { object: ACTIVITY_ROW_OWN },
  },

  // ---- activities, the manager's views
  "GET /api/activities/all": {
    response: { list: ACTIVITY_ROW_FULL },
  },
  "GET /api/activities/pending": {
    response: { list: ACTIVITY_ROW_PENDING },
  },
  "PATCH /api/activities/:id/manager": {
    request: { json: ["action", "rejection_comment", "manager_comments", "theme_id", "subtheme_id"] },
    response: { object: ACTIVITY_ROW_FULL },
  },

  // ---- activities, the committee's views
  "GET /api/activities/committee": {
    response: { list: ACTIVITY_ROW_FULL },
  },
  "GET /api/activities/evaluated": {
    response: { list: ACTIVITY_ROW_EVALUATED },
  },
  "PATCH /api/activities/:id/committee": {
    request: { json: ["action", "score", "committee_comments", "theme_id", "subtheme_id"] },
    response: { object: ACTIVITY_ROW_FULL },
  },
  "GET /api/activities/evaluated/theme-totals": {
    response: { list: ["theme_id", "theme_code", "theme_title", "theme_total_sum", "theme_pointvalue", "total_score"] },
  },
  "GET /api/activities/evaluated/employees": {
    response: { list: ["eid", "full_name", "email"] },
  },
  "GET /api/activities/evaluated/employee/:eid/subthemes": {
    response: { list: ["theme_id", "theme_code", "theme_title", "subtheme_id", "subtheme_code", "subtheme_title", "total_score", "subtheme_cap", "theme_pointvalue"] },
  },

  // ---- roles administration (manager, ownership-guarded)
  "GET /api/user-roles": {
    request: { query: ["email"] },
    response: {
      object: ["user", "roles", "allRoles"],
      nested: { user: { object: ["id", "email", "full_name"] } },
    },
  },
  "POST /api/user-roles/assign": {
    request: { json: ["email", "role"] },
    response: { none: true },
  },
  "POST /api/user-roles/remove": {
    request: { json: ["email", "role"] },
    response: { none: true },
  },
};
