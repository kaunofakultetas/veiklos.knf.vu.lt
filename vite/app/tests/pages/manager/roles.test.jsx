// -----------------------------------------------------------
//  [*] Regression — pages/manager/roles.jsx
//
//  The role administration page against the scripted fetch:
//  /api/me on mount with no headers at all (auth is the
//  session cookie — this page sends no X-Active-Role), the
//  lookup GET with the encoded email in the query string, the
//  user / pill / dropdown rendering, assign and remove with
//  their exact POST bodies and the "app:roles-updated" window
//  event, the self-revoke confirm for a manager's own
//  Vadybininkas role, and backend errors shown verbatim with
//  the page's own fallbacks.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import RolesPage from "@/pages/manager/roles.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// The catalog as the backend orders it (by name), a looked-up
// employee, and the manager doing the editing
const ALL = ["Darbuotojas", "Komisijos narys", "Vadybininkas"];
const USER = { id: 7, email: "jonas.jonaitis@knf.vu.lt", full_name: "Jonas Jonaitis" };
const ME = { email: "vadybininke@knf.vu.lt" };

const lookup = (roles) => ({ user: USER, roles, allRoles: ALL });

// The owned-role pills in DOM order — a pill's own text is
// the role; the ✕ inside it is a separate button
const pill = (role) => screen.getByText(role, { selector: "span" });
const pillNames = () =>
  screen.getAllByText(/^(Darbuotojas|Komisijos narys|Vadybininkas)$/, { selector: "span" })
    .map((el) => el.childNodes[0].textContent);

// The values the dropdown offers
const optionValues = () => within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.value);

// Type an email and press Įkelti (the tests wait for the
// outcome themselves)
async function lookUp(user, email) {
  const input = screen.getByPlaceholderText("vardas.pavarde@knf.vu.lt");
  await user.clear(input);
  await user.type(input, email);
  await user.click(screen.getByRole("button", { name: "Įkelti" }));
}







// -----------------------------------------------------------
// mount
// -----------------------------------------------------------
//
// One GET /api/me with no headers; the heading and subtitle;
// Įkelti stays disabled until something is typed and typing
// alone sends nothing.
// -----------------------------------------------------------

test("mounts with GET /api/me and no headers; Įkelti waits for an email", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  const { user } = renderPage(RolesPage);

  expect(screen.getByRole("heading", { name: "Rolių tvarkymas" })).toBeInTheDocument();
  expect(screen.getByText("Įveskite darbuotojo el.paštą norėdami priskirti arba pašalinti roles.")).toBeInTheDocument();
  await waitFor(() => expect(requestLog()).toHaveLength(1));
  expect(requestLog()[0].method).toBe("GET");
  expect(requestLog()[0].url).toBe("/api/me");
  expect(requestLog()[0].headers).toEqual({});

  const button = screen.getByRole("button", { name: "Įkelti" });
  expect(button).toBeDisabled();
  await user.type(screen.getByPlaceholderText("vardas.pavarde@knf.vu.lt"), "j");
  expect(button).toBeEnabled();
  expect(screen.queryByText("Turimos rolės:")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// lookup
// -----------------------------------------------------------
//
// Įkelti GETs /api/user-roles?email=<encoded as typed> with
// no headers and no body; the user's name and email, one pill
// per owned role (Darbuotojas without a ✕), and the dropdown
// of the roles not yet owned with the first preselected.
// -----------------------------------------------------------

test("Įkelti GETs /api/user-roles?email=<encoded> without headers and renders the user", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(["Darbuotojas", "Vadybininkas"]));
  const { user } = renderPage(RolesPage);

  await lookUp(user, "Jonas.Jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");
  const [get] = requestsTo("GET", "/api/user-roles");
  expect(get.url).toBe("/api/user-roles?email=Jonas.Jonaitis%40knf.vu.lt");
  expect(get.headers).toEqual({});
  expect(get.body).toBeNull();

  expect(screen.getByText("Darbuotojo informacija:")).toBeInTheDocument();
  expect(screen.getByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(screen.getByText("jonas.jonaitis@knf.vu.lt")).toBeInTheDocument();
  expect(pillNames()).toEqual(["Darbuotojas", "Vadybininkas"]);
  expect(within(pill("Darbuotojas")).queryByTitle("Pašalinti")).toBeNull();
  expect(within(pill("Vadybininkas")).getByTitle("Pašalinti")).toHaveTextContent("✕");

  expect(screen.getByText("Pridėti naują rolę:")).toBeInTheDocument();
  expect(optionValues()).toEqual(["Komisijos narys"]);
  expect(screen.getByRole("combobox").value).toBe("Komisijos narys");
  expect(screen.getByRole("button", { name: "Priskirti rolę" })).toBeEnabled();
  expect(screen.queryByText("(nėra)")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// empty roles / no full name
// -----------------------------------------------------------
//
// No owned roles renders "(nėra)" and offers the whole
// catalog; a user without full_name is named by the email
// (so the email shows twice).
// -----------------------------------------------------------

test("a user without roles shows (nėra) and every role to grant; no full name falls back to the email", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", { user: { id: 8, email: "naujas@knf.vu.lt", full_name: null }, roles: [], allRoles: ALL });
  const { user } = renderPage(RolesPage);

  await lookUp(user, "naujas@knf.vu.lt");
  expect(await screen.findByText("(nėra)")).toBeInTheDocument();
  expect(screen.getAllByText("naujas@knf.vu.lt")).toHaveLength(2);
  expect(screen.queryAllByTitle("Pašalinti")).toEqual([]);
  expect(optionValues()).toEqual(["Darbuotojas", "Komisijos narys", "Vadybininkas"]);
  expect(screen.getByRole("combobox").value).toBe("Darbuotojas");
});







// -----------------------------------------------------------
// assign
// -----------------------------------------------------------
//
// Picking a role and pressing Priskirti rolę POSTs { email,
// role } with only Content-Type; the pill appears, the
// dropdown loses that role and preselects the next, the
// message names the role, "app:roles-updated" fires once and
// the user is not re-fetched.
// -----------------------------------------------------------

test("assign: POST { email, role } with Content-Type only, pill added, next role preselected, event fired", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(["Darbuotojas"]));
  onRequest("POST", "/api/user-roles/assign", { ok: true });
  const onUpdated = vi.fn();
  window.addEventListener("app:roles-updated", onUpdated);
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  expect(optionValues()).toEqual(["Komisijos narys", "Vadybininkas"]);
  expect(screen.getByRole("combobox").value).toBe("Komisijos narys");
  await user.selectOptions(screen.getByRole("combobox"), "Vadybininkas");
  await user.click(screen.getByRole("button", { name: "Priskirti rolę" }));

  await screen.findByText("Priskirta rolė: Vadybininkas");
  const [post] = requestsTo("POST", "/api/user-roles/assign");
  expect(post.headers).toEqual({ "content-type": "application/json" });
  expect(post.body).toEqual({ email: "jonas.jonaitis@knf.vu.lt", role: "Vadybininkas" });
  expect(pillNames()).toEqual(["Darbuotojas", "Vadybininkas"]);
  expect(optionValues()).toEqual(["Komisijos narys"]);
  expect(screen.getByRole("combobox").value).toBe("Komisijos narys");
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(requestsTo("GET", "/api/user-roles")).toHaveLength(1);
  window.removeEventListener("app:roles-updated", onUpdated);
});







// -----------------------------------------------------------
// assign — the last role
// -----------------------------------------------------------
//
// The new pill is sorted into place (Komisijos narys between
// Darbuotojas and Vadybininkas), and once every role is owned
// the dropdown gives way to the all-roles note.
// -----------------------------------------------------------

test("assigning the last role sorts the pill into place and shows the all-roles note", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(["Darbuotojas", "Vadybininkas"]));
  onRequest("POST", "/api/user-roles/assign", { ok: true });
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  expect(optionValues()).toEqual(["Komisijos narys"]);
  await user.click(screen.getByRole("button", { name: "Priskirti rolę" }));

  await screen.findByText("Priskirta rolė: Komisijos narys");
  expect(requestsTo("POST", "/api/user-roles/assign")[0].body).toEqual({ email: "jonas.jonaitis@knf.vu.lt", role: "Komisijos narys" });
  expect(pillNames()).toEqual(["Darbuotojas", "Komisijos narys", "Vadybininkas"]);
  expect(screen.getByText("(Darbuotojas šiuo metu turi visas roles.)")).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Priskirti rolę" })).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// remove
// -----------------------------------------------------------
//
// The ✕ on a pill POSTs { email, role } with Content-Type
// only and no confirm when the email is someone else's; the
// pill goes, the role comes back as the dropdown's selection
// (replacing the all-roles note), the message names it and
// "app:roles-updated" fires once.
// -----------------------------------------------------------

test("remove: ✕ POSTs { email, role } without a confirm, the pill goes, the role returns to the dropdown, event fired", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(ALL));
  onRequest("POST", "/api/user-roles/remove", { ok: true });
  const onUpdated = vi.fn();
  window.addEventListener("app:roles-updated", onUpdated);
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("(Darbuotojas šiuo metu turi visas roles.)");

  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));

  await screen.findByText("Pašalinta rolė: Vadybininkas");
  expect(window.confirm).not.toHaveBeenCalled();
  const [post] = requestsTo("POST", "/api/user-roles/remove");
  expect(post.headers).toEqual({ "content-type": "application/json" });
  expect(post.body).toEqual({ email: "jonas.jonaitis@knf.vu.lt", role: "Vadybininkas" });
  expect(pillNames()).toEqual(["Darbuotojas", "Komisijos narys"]);
  expect(screen.queryByText("(Darbuotojas šiuo metu turi visas roles.)")).not.toBeInTheDocument();
  expect(optionValues()).toEqual(["Vadybininkas"]);
  expect(screen.getByRole("combobox").value).toBe("Vadybininkas");
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(requestsTo("GET", "/api/user-roles")).toHaveLength(1);
  window.removeEventListener("app:roles-updated", onUpdated);
});







// -----------------------------------------------------------
// self-revoke
// -----------------------------------------------------------
//
// The /api/me email is lower-cased and compared to the typed
// email trimmed and lower-cased. Removing my own Komisijos
// narys needs no confirm; removing my own Vadybininkas asks
// the exact question — cancel sends nothing, OK POSTs the
// email as typed.
// -----------------------------------------------------------

test("self-revoke: my own Vadybininkas asks the exact confirm; cancel sends nothing, OK POSTs", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", { email: "JONAS.JONAITIS@knf.vu.lt" });
  onRequest("GET", "/api/user-roles", lookup(ALL));
  onRequest("POST", "/api/user-roles/remove", { ok: true });
  const { user } = renderPage(RolesPage);
  await lookUp(user, "Jonas.Jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  await user.click(within(pill("Komisijos narys")).getByTitle("Pašalinti"));
  await screen.findByText("Pašalinta rolė: Komisijos narys");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(requestsTo("POST", "/api/user-roles/remove")).toHaveLength(1);

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai norite sau nusiimti Vadybininko rolę?");
  expect(requestsTo("POST", "/api/user-roles/remove")).toHaveLength(1);
  expect(pillNames()).toEqual(["Darbuotojas", "Vadybininkas"]);
  expect(screen.queryByText("Pašalinta rolė: Vadybininkas")).not.toBeInTheDocument();

  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));
  await screen.findByText("Pašalinta rolė: Vadybininkas");
  expect(window.confirm).toHaveBeenCalledTimes(2);
  expect(requestsTo("POST", "/api/user-roles/remove")[1].body).toEqual({ email: "Jonas.Jonaitis@knf.vu.lt", role: "Vadybininkas" });
  expect(pillNames()).toEqual(["Darbuotojas"]);
});







// -----------------------------------------------------------
// self-revoke — /api/me refused
// -----------------------------------------------------------
//
// A refused /api/me leaves the own email empty, so removing
// Vadybininkas for that same email goes through without a
// confirm.
// -----------------------------------------------------------

test("when /api/me is refused the self-revoke confirm never triggers", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", { status: 401, body: { error: "unauthorized" } });
  onRequest("GET", "/api/user-roles", lookup(ALL));
  onRequest("POST", "/api/user-roles/remove", { ok: true });
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));
  await screen.findByText("Pašalinta rolė: Vadybininkas");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(requestsTo("POST", "/api/user-roles/remove")[0].body).toEqual({ email: "jonas.jonaitis@knf.vu.lt", role: "Vadybininkas" });
});







// -----------------------------------------------------------
// lookup errors
// -----------------------------------------------------------
//
// A refused lookup shows the backend's text, or the page's
// "Klaida: Nepavyko įkelti naudotojo." when there is none,
// and clears the previously shown user so stale roles never
// sit under a bad search.
// -----------------------------------------------------------

test("lookup errors: the backend's text, the fallback, and the previous user is cleared", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", (req) => {
    if (req.url.includes("nera")) return { status: 404, body: { error: "Klaida: Vartotojas nerastas" } };
    if (req.url.includes("blogas")) return { status: 500, body: {} };
    return lookup(["Darbuotojas"]);
  });
  const { user } = renderPage(RolesPage);

  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Jonas Jonaitis");

  await lookUp(user, "nera@knf.vu.lt");
  expect(await screen.findByText("Klaida: Vartotojas nerastas")).toBeInTheDocument();
  expect(screen.queryByText("Jonas Jonaitis")).not.toBeInTheDocument();
  expect(screen.queryByText("Turimos rolės:")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  await lookUp(user, "blogas@knf.vu.lt");
  expect(await screen.findByText("Klaida: Nepavyko įkelti naudotojo.")).toBeInTheDocument();
  expect(requestsTo("GET", "/api/user-roles").map((r) => r.url)).toEqual([
    "/api/user-roles?email=jonas.jonaitis%40knf.vu.lt",
    "/api/user-roles?email=nera%40knf.vu.lt",
    "/api/user-roles?email=blogas%40knf.vu.lt",
  ]);
});







// -----------------------------------------------------------
// assign errors
// -----------------------------------------------------------
//
// A refused assign shows the backend's reason, or "Nepavyko
// priskirti rolės." for a bodiless failure; the pills and the
// dropdown are untouched and no event fires.
// -----------------------------------------------------------

test("assign errors: the backend's reason verbatim, then the fallback; nothing changes and no event", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(["Darbuotojas"]));
  let calls = 0;
  onRequest("POST", "/api/user-roles/assign", () =>
    calls++ === 0 ? { status: 400, body: { error: "Klaida: Rolė jau priskirta" } } : { status: 500 }
  );
  const onUpdated = vi.fn();
  window.addEventListener("app:roles-updated", onUpdated);
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  await user.click(screen.getByRole("button", { name: "Priskirti rolę" }));
  expect(await screen.findByText("Klaida: Rolė jau priskirta")).toBeInTheDocument();
  expect(pillNames()).toEqual(["Darbuotojas"]);
  expect(optionValues()).toEqual(["Komisijos narys", "Vadybininkas"]);
  expect(screen.getByRole("combobox").value).toBe("Komisijos narys");

  await user.click(screen.getByRole("button", { name: "Priskirti rolę" }));
  expect(await screen.findByText("Nepavyko priskirti rolės.")).toBeInTheDocument();
  expect(pillNames()).toEqual(["Darbuotojas"]);
  expect(requestsTo("POST", "/api/user-roles/assign")).toHaveLength(2);
  expect(onUpdated).not.toHaveBeenCalled();
  window.removeEventListener("app:roles-updated", onUpdated);
});







// -----------------------------------------------------------
// remove errors
// -----------------------------------------------------------
//
// The same for remove: the reason verbatim, then "Nepavyko
// pašalinti rolės."; the pill stays and no event fires.
// -----------------------------------------------------------

test("remove errors: the backend's reason verbatim, then the fallback; the pill stays and no event", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", lookup(["Darbuotojas", "Vadybininkas"]));
  let calls = 0;
  onRequest("POST", "/api/user-roles/remove", () =>
    calls++ === 0 ? { status: 403, body: { error: "Klaida: Paskutinio vadybininko pašalinti negalima" } } : { status: 500 }
  );
  const onUpdated = vi.fn();
  window.addEventListener("app:roles-updated", onUpdated);
  const { user } = renderPage(RolesPage);
  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));
  expect(await screen.findByText("Klaida: Paskutinio vadybininko pašalinti negalima")).toBeInTheDocument();
  expect(pillNames()).toEqual(["Darbuotojas", "Vadybininkas"]);

  await user.click(within(pill("Vadybininkas")).getByTitle("Pašalinti"));
  expect(await screen.findByText("Nepavyko pašalinti rolės.")).toBeInTheDocument();
  expect(pillNames()).toEqual(["Darbuotojas", "Vadybininkas"]);
  expect(requestsTo("POST", "/api/user-roles/remove").map((r) => r.body)).toEqual([
    { email: "jonas.jonaitis@knf.vu.lt", role: "Vadybininkas" },
    { email: "jonas.jonaitis@knf.vu.lt", role: "Vadybininkas" },
  ]);
  expect(onUpdated).not.toHaveBeenCalled();
  window.removeEventListener("app:roles-updated", onUpdated);
});







// -----------------------------------------------------------
// unexpected body
// -----------------------------------------------------------
//
// A 200 whose body does not carry the two role arrays — a
// bare object, JSON null, a JSON string, or `roles` as a
// string (which used to blank the page on roles.map) — is
// refused with one message: the previously shown user is
// cleared like on any refused lookup, the heading stays, no
// pills, no dropdown, Įkelti usable again.
// -----------------------------------------------------------

test("a 200 without the two role arrays is refused with one message and clears the user", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/user-roles", (req) => {
    if (req.url.includes("objektas")) return { status: 200, body: { ok: true } };
    if (req.url.includes("nulis")) return { status: 200, body: "null" };
    if (req.url.includes("tekstas")) return { status: 200, body: "\"tekstas\"" };
    if (req.url.includes("eilute")) return { user: USER, roles: "Darbuotojas", allRoles: ALL };
    return lookup(["Darbuotojas"]);
  });
  const { user } = renderPage(RolesPage);

  await lookUp(user, "jonas.jonaitis@knf.vu.lt");
  await screen.findByText("Turimos rolės:");

  await lookUp(user, "objektas@knf.vu.lt");
  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Rolių tvarkymas" })).toBeInTheDocument();
  expect(screen.queryByText("Turimos rolės:")).not.toBeInTheDocument();
  expect(screen.queryByText("Jonas Jonaitis")).not.toBeInTheDocument();
  expect(screen.queryAllByTitle("Pašalinti")).toEqual([]);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Įkelti" })).toBeEnabled();

  // The other shapes, each after a good lookup so the message
  // seen is this lookup's own
  for (const email of ["nulis@knf.vu.lt", "tekstas@knf.vu.lt", "eilute@knf.vu.lt"]) {
    await lookUp(user, "jonas.jonaitis@knf.vu.lt");
    await screen.findByText("Turimos rolės:");
    await lookUp(user, email);
    expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toBeInTheDocument();
    expect(screen.queryByText("Turimos rolės:")).not.toBeInTheDocument();
    expect(screen.queryAllByTitle("Pašalinti")).toEqual([]);
  }
  expect(requestsTo("GET", "/api/user-roles")).toHaveLength(8);
});
