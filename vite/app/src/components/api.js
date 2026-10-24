// -----------------------------------------------------------
//  [*] Components — the backend API client
//
//  Every page talks to the backend the same way: the tab's
//  active role in an X-Active-Role header (the session-only
//  routes opt out), a JSON body announced as such — a
//  FormData one is announced by the browser itself — and an
//  answer that is either what the page asked for or a
//  refusal whose `error` text the page shows. A refusal
//  becomes a thrown Error carrying the backend's text, else
//  the caller's fallback, else the HTTP status. A call that
//  gets no answer at all — offline, or the backend out of
//  reach — throws the caller's fallback, else the client's
//  own Lithuanian sentence saying the server could not be
//  reached, never the browser's English error. The backend
//  starts most of its texts with "Klaida:", as does that
//  sentence, so a page that wraps one in a "Klaida: …"
//  sentence of its own takes reasonOf it, or the word would
//  show twice.
//
//  Split into:
//
//    UNREACHABLE        — the text for a call with no answer
//    request            — the one fetch and the refusal check
//    apiJson            — a call answered with JSON
//    apiJsonAll         — several at once, refusals in order
//    apiSend            — a call answered with no body
//    downloadAttachment — an activity's file, saved
//    reasonOf           — a refusal's text without "Klaida:"
// -----------------------------------------------------------

import { getActiveRole } from "./activeRole.js";


// What a call that got no answer at all throws when its
// caller passed no fallback of its own
const UNREACHABLE = "Klaida: nepavyko susisiekti su serveriu.";







// -----------------------------------------------------------
// request
// -----------------------------------------------------------
//
// The fetch every helper below makes. Options: method (GET by
// default), json (a body sent as JSON) or form (a FormData
// body, whose multipart Content-Type the browser sets),
// activeRole (false for the routes the session alone
// guards) and fallback (the text for a refusal without one
// of its own, and for a call that got no answer). Resolves
// to the Response when it is a 2xx and throws the refusal
// otherwise: the backend's text, else the fallback, else the
// HTTP status — a refusal's body that is not JSON counts as
// one without a text. When fetch itself fails it throws the
// fallback, else UNREACHABLE, with the browser's own error
// kept as the cause.
//
// Used by:
//   - apiJson, apiSend, downloadAttachment (below)
// -----------------------------------------------------------

async function request(path, { method = "GET", json, form, activeRole = true, fallback } = {}) {
  const headers = {};
  if (activeRole) headers["X-Active-Role"] = getActiveRole();

  let body;
  if (form !== undefined) {
    body = form;
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  // No answer at all: the browser's own error is English and
  // names nothing a user could act on
  let res;
  try {
    res = await fetch(path, { method, headers, body });
  } catch (e) {
    throw new Error(fallback || UNREACHABLE, { cause: e });
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || fallback || `${res.status} ${res.statusText}`);
  }
  return res;
}







// -----------------------------------------------------------
// apiJson
// -----------------------------------------------------------
//
// A call whose answer the page reads: resolves to the parsed
// JSON — {} when a 2xx body is not JSON, so the page's own
// shape checks refuse it — and throws a refusal, or the text
// for no answer at all. Options as for request.
//
// Used by:
//   - apiJsonAll (below)
//   - employee/newActivity.jsx, employee/myActivities.jsx,
//     manager/review.jsx, manager/themes.jsx,
//     manager/roles.jsx, committee/evaluate.jsx,
//     committee/results.jsx, committee/limits.jsx,
//     committee/calculate.jsx — loads, and the saves whose
//     answer the page reads
//   - components/appHeader.jsx — /api/me
// -----------------------------------------------------------

export async function apiJson(path, options) {
  const res = await request(path, options);
  return res.json().catch(() => ({}));
}







// -----------------------------------------------------------
// apiJsonAll
// -----------------------------------------------------------
//
// Several apiJson calls started together, given as
// [path, options] pairs. Resolves to their answers in the
// order listed; when more than one is refused, the first one
// listed is what throws, even if it answered last — the order
// a page checks its loads in, so the message it shows does
// not depend on which answer happened to arrive first.
//
// Used by:
//   - employee/myActivities.jsx, employee/export.jsx,
//     manager/review.jsx, manager/export.jsx,
//     committee/results.jsx, committee/calculate.jsx — the
//     page's first load
// -----------------------------------------------------------

export async function apiJsonAll(calls) {
  const settled = await Promise.allSettled(calls.map(([path, options]) => apiJson(path, options)));
  const refused = settled.find((s) => s.status === "rejected");
  if (refused) throw refused.reason;
  return settled.map((s) => s.value);
}







// -----------------------------------------------------------
// apiSend
// -----------------------------------------------------------
//
// A call whose answer the page does not read — a 204 from a
// delete or a role change, or a save the page then shows from
// its own state: resolves once the backend has said yes,
// throws a refusal, or the text for no answer at all.
// Options as for request.
//
// Used by:
//   - employee/newActivity.jsx — submitting an activity
//   - employee/myActivities.jsx — deleting an activity
//   - manager/themes.jsx — creating and deleting themes and
//     subthemes
//   - manager/roles.jsx — granting and revoking a role
//   - committee/limits.jsx — saving a cap or a theme's sum
//   - committee/calculate.jsx — saving a point value
// -----------------------------------------------------------

export async function apiSend(path, options) {
  await request(path, options);
}







// -----------------------------------------------------------
// downloadAttachment
// -----------------------------------------------------------
//
// Saves an activity's attached file in the browser: fetched
// with the role header (which a plain link could not carry),
// handed to a temporary link under its original name —
// "priedas" when there is none — and the object URL let go
// again. Throws a refusal, the backend's "no attachment"
// included, or the text for no answer at all.
//
// Used by:
//   - employee/myActivities.jsx, manager/review.jsx,
//     committee/evaluate.jsx, committee/results.jsx — the
//     attachment buttons
// -----------------------------------------------------------

export async function downloadAttachment(activity) {
  const res = await request(`/api/activities/${activity.id}/attachment`);
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = activity.attachment_original_name || "priedas";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}







// -----------------------------------------------------------
// reasonOf
// -----------------------------------------------------------
//
// A refusal's text without the "Klaida:" the backend puts in
// front of most of its texts, for a page that wraps the
// reason in its own "Klaida: …" sentence. A text without the
// word is returned as it is.
//
// Used by:
//   - employee/myActivities.jsx, employee/newActivity.jsx,
//     manager/review.jsx, committee/evaluate.jsx,
//     committee/results.jsx — their composed error lines
// -----------------------------------------------------------

export function reasonOf(error) {
  return String(error?.message ?? error).replace(/^Klaida:\s*/, "");
}
