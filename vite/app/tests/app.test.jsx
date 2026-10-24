// -----------------------------------------------------------
//  [*] Regression — App.jsx
//
//  The SPA root against the scripted fetch: the one session
//  probe and its "Kraunama…" card, the SignIn card for a 401
//  (and for a probe that fails outright), an error in its
//  place for any other refusal, the sign-in button's hard
//  navigation, the role flow after a 200 — one role picks
//  itself, several open the picker, whose dropdown is named
//  by its caption, a stored role goes straight to its
//  workspace when the session owns it and gives way to an
//  owned one when it does not, no roles gets a card saying
//  so — the RoleRoute guard for a wrong or missing role and
//  its link home, the header taking the tab off a workspace
//  whose role was just removed, the catch-all redirect to
//  "/", a tab that keeps its own role when another tab
//  switches, and the notice that offers a fresh sign-in when
//  the session ends mid-work.
// -----------------------------------------------------------

import { test, expect, vi, afterEach } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App.jsx";
import { onRequest, requestsTo, requestLog } from "./helpers/fakeFetch.js";
import { signInAs } from "./helpers/render.js";


// The signed-in user as /api/session/check sends it, the
// /api/me answer the workspace headers fetch, and the two
// probe outcomes; session(names) is the 200 answer, whose
// roles are { name } objects
const USER = { eid: "u100", email: "jonas@vu.lt", full_name: "Jonas Jonaitis", created_at: "2025-09-01T08:00:00Z", last_login_at: "2026-09-25T07:30:00Z" };
const ME = { name: "Jonas Jonaitis", email: "jonas@vu.lt", eid: "u100", roles: ["Darbuotojas", "Vadybininkas", "Komisijos narys"] };
const SIGNED_OUT = { status: 401, body: { error: "Neprisijungta" } };
const session = (names) => ({ user: USER, roles: names.map((name) => ({ name })) });

// The App under its own BrowserRouter, with the browser at
// `at` before it mounts
function renderApp(at) {
  window.history.pushState({}, "", at);
  const user = userEvent.setup();
  return { user, ...render(<App />) };
}

// jsdom does not navigate, so a page's window.location.href
// assignment is read back from a plain stand-in, restored
// after the test
let restoreLocation = () => {};

function fakeLocation() {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const fake = { ...window.location, href: "", assign: vi.fn() };
  Object.defineProperty(window, "location", { value: fake, writable: true, configurable: true });
  restoreLocation = () => Object.defineProperty(window, "location", original);
  return fake;
}

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
});

// Lets the probe's promise chain settle and React flush it
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));







// -----------------------------------------------------------
// signed out
// -----------------------------------------------------------
//
// The loading card until the probe answers, then the SignIn
// card for a 401: logo, title, subtitle, button, footer. The
// button hard-navigates to /auth/saml/login. A probe that
// fails outright counts as signed out too.
// -----------------------------------------------------------

test("shows Kraunama… until the probe answers; a 401 renders the SignIn card", async () => {
  onRequest("GET", "/api/session/check", SIGNED_OUT);
  renderApp("/");
  expect(screen.getByText("Kraunama…")).toBeInTheDocument();

  expect(await screen.findByRole("heading", { name: "Vilniaus universiteto veiklos" })).toBeInTheDocument();
  expect(screen.getByText("Paslaugai reikalingas Jūsų tapatybės patvirtinimas.")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Vilniaus universiteto logotipas" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Prisijungti per VU bendro prisijungimo sistemą" })).toBeInTheDocument();
  expect(screen.getByText(`© ${new Date().getFullYear()} Goda Stungurytė, ISKS'22. Visos teisės saugomos.`)).toBeInTheDocument();
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(requestLog()).toEqual([expect.objectContaining({ method: "GET", path: "/api/session/check", headers: {}, body: null })]);
});

test("the sign-in button hard-navigates to /auth/saml/login", async () => {
  onRequest("GET", "/api/session/check", SIGNED_OUT);
  const { user } = renderApp("/");
  const button = await screen.findByRole("button", { name: "Prisijungti per VU bendro prisijungimo sistemą" });

  const location = fakeLocation();
  await user.click(button);
  expect(location.href).toBe("/auth/saml/login");
  expect(requestLog()).toHaveLength(1);
});

test("a probe that fails is treated as signed out", async () => {
  onRequest("GET", "/api/session/check", () => { throw new Error("network down"); });
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Vilniaus universiteto veiklos" })).toBeInTheDocument();
  expect(requestsTo("GET", "/api/session/check")).toHaveLength(1);
});







// -----------------------------------------------------------
// a refused probe
// -----------------------------------------------------------
//
// Only a 401 means signed out. Any other refusal — the 500
// the backend answers when the role lookup fails, the
// ingress's 502 while the backend restarts — says the check
// failed instead of offering the sign-in button, which would
// only lead a signed-in user back to the same answer; no
// workspace and no session notice either. A probe that fails
// outright stays signed out on purpose, as pinned above.
// -----------------------------------------------------------

test("a 5xx session probe shows an error instead of the sign-in button", async () => {
  onRequest("GET", "/api/session/check", { status: 500, body: { error: "internal error" } });
  renderApp("/");
  await settle();

  expect(screen.queryByRole("button", { name: "Prisijungti per VU bendro prisijungimo sistemą" })).not.toBeInTheDocument();
});

test("the ingress's 502 says the check failed, and nothing else is offered", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", { status: 502, body: "<html>Bad Gateway</html>" });
  renderApp("/manager");

  expect(await screen.findByText("Klaida: nepavyko patikrinti prisijungimo. Pabandykite vėliau.")).toHaveClass("card-body");
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vilniaus universiteto veiklos" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vadybininko langas" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Prisijungimo sesija baigėsi" })).not.toBeInTheDocument();
  expect(screen.queryAllByRole("button")).toEqual([]);
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// role flow
// -----------------------------------------------------------
//
// After a 200: exactly one role stores itself and opens its
// workspace (whose header then GETs /api/me); several roles
// open the picker, whose "Patvirtinti" stores the choice;
// a stored role skips both; no roles gets a card saying so.
// -----------------------------------------------------------

test("one role picks itself: activeRole stored, its workspace opened, /api/me fetched", async () => {
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  onRequest("GET", "/api/me", { ...ME, roles: ["Darbuotojas"] });
  renderApp("/");

  expect(await screen.findByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();
  expect(localStorage.getItem("activeRole")).toBe("Darbuotojas");
  expect(window.location.pathname).toBe("/employee");
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(requestsTo("GET", "/api/session/check")).toHaveLength(1);
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("several roles open the picker; Patvirtinti stores the choice and opens its workspace", async () => {
  onRequest("GET", "/api/session/check", session(["Darbuotojas", "Komisijos narys"]));
  onRequest("GET", "/api/me", ME);
  const { user } = renderApp("/");

  expect(await screen.findByRole("heading", { name: "Pasirinkite rolę" })).toBeInTheDocument();
  expect(screen.getByText("Pasirinkite rolę, su kuria tęsite veiklą sistemoje.")).toBeInTheDocument();
  const select = screen.getByRole("combobox");
  expect(within(select).getAllByRole("option").map((o) => o.value)).toEqual(["Darbuotojas", "Komisijos narys"]);
  expect(select.value).toBe("Darbuotojas");
  expect(localStorage.getItem("activeRole")).toBeNull();
  expect(window.location.pathname).toBe("/");

  await user.selectOptions(select, "Komisijos narys");
  await user.click(screen.getByRole("button", { name: "Patvirtinti" }));

  expect(await screen.findByRole("heading", { name: "Komisijos nario langas" })).toBeInTheDocument();
  expect(localStorage.getItem("activeRole")).toBe("Komisijos narys");
  expect(window.location.pathname).toBe("/committee");
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();
});

test("a stored activeRole skips the picker and opens its workspace", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas", "Vadybininkas"]));
  onRequest("GET", "/api/me", ME);
  renderApp("/");

  expect(await screen.findByRole("heading", { name: "Vadybininko langas" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/manager");
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();
  expect(localStorage.getItem("activeRole")).toBe("Vadybininkas");
});

test("a session with no roles is told so instead of waiting on the Kraunama… card", async () => {
  onRequest("GET", "/api/session/check", session([]));
  renderApp("/");
  await settle();

  expect(requestLog()).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Jūsų paskyrai nepriskirta jokia rolė." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "info@knf.vu.lt" })).toHaveAttribute("href", "mailto:info@knf.vu.lt");
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vilniaus universiteto veiklos" })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
  expect(localStorage.getItem("activeRole")).toBeNull();
});







// -----------------------------------------------------------
// the role picker's dropdown is named
// -----------------------------------------------------------
//
// The picker's dropdown is named by the "Pasirinkite rolę"
// caption above it, as the header's role switcher is named
// by its own caption, so a screen reader says what it
// chooses instead of announcing a bare drop-down.
// -----------------------------------------------------------

test("the role picker's dropdown is named by its Pasirinkite rolę caption", async () => {
  onRequest("GET", "/api/session/check", session(["Darbuotojas", "Komisijos narys"]));
  renderApp("/");
  await screen.findByRole("heading", { name: "Pasirinkite rolę" });

  expect(screen.getByRole("combobox", { name: "Pasirinkite rolę" })).toBe(screen.getByRole("combobox"));
});







// -----------------------------------------------------------
// a stored role the session does not own
// -----------------------------------------------------------
//
// A role revoked since it was stored, or one an earlier user
// of the same browser left behind, would open a workspace
// whose actions the backend refuses. HomeGate checks the
// stored role against the session's roles: one the session
// does not own gives way to the first role it does own,
// stored for the tab, whose workspace opens instead; with no
// role owned at all the stored one is dropped and the card
// says the account has none.
// -----------------------------------------------------------

test("a stored role the session does not own opens the workspace of an owned role instead", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  onRequest("GET", "/api/me", { ...ME, roles: ["Darbuotojas"] });
  renderApp("/");

  await waitFor(() => expect(window.location.pathname).toBe("/employee"));
  expect(await screen.findByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vadybininko langas" })).not.toBeInTheDocument();
  expect(localStorage.getItem("activeRole")).toBe("Darbuotojas");
});

test("of several owned roles the first one takes the place of a stored role the session does not own", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", session(["Komisijos narys", "Darbuotojas"]));
  onRequest("GET", "/api/me", { ...ME, roles: ["Komisijos narys", "Darbuotojas"] });
  renderApp("/");

  expect(await screen.findByRole("heading", { name: "Komisijos nario langas" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/committee");
  expect(sessionStorage.getItem("activeRole")).toBe("Komisijos narys");
  expect(localStorage.getItem("activeRole")).toBe("Komisijos narys");
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();

  // Only the committee header asked: the manager workspace,
  // whose header would have asked first, never opened
  await settle();
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("a stored role is dropped when the session owns no role at all, and the card says so", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", session([]));
  renderApp("/");
  await settle();

  expect(screen.getByRole("heading", { name: "Jūsų paskyrai nepriskirta jokia rolė." })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vadybininko langas" })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
  expect(sessionStorage.getItem("activeRole")).toBeNull();
  expect(localStorage.getItem("activeRole")).toBeNull();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// RoleRoute
// -----------------------------------------------------------
//
// A workspace the stored role does not allow (or no stored
// role at all) shows the "Netinkama rolė" card without
// mounting the layout; signed out, a workspace path goes
// back to "/".
// -----------------------------------------------------------

test("a workspace the stored role does not allow shows Netinkama rolė", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  renderApp("/manager/roles");

  expect(await screen.findByRole("heading", { name: "Netinkama rolė" })).toBeInTheDocument();
  expect(screen.getByText("Dabartinė aktyvi rolė:")).toBeInTheDocument();
  expect(screen.getByText("Darbuotojas").tagName).toBe("B");
  expect(window.location.pathname).toBe("/manager/roles");
  expect(requestLog()).toHaveLength(1);
});

test("a workspace with no stored role shows Netinkama rolė with (rolė nepasirinkta)", async () => {
  onRequest("GET", "/api/session/check", session(["Komisijos narys"]));
  renderApp("/committee");

  expect(await screen.findByRole("heading", { name: "Netinkama rolė" })).toBeInTheDocument();
  expect(screen.getByText("Dabartinė aktyvi rolė:")).toBeInTheDocument();
  expect(screen.getByText("(rolė nepasirinkta)")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});

test("a workspace path while signed out redirects to / and the SignIn card", async () => {
  onRequest("GET", "/api/session/check", SIGNED_OUT);
  renderApp("/employee/new");

  expect(await screen.findByRole("heading", { name: "Vilniaus universiteto veiklos" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
});







// -----------------------------------------------------------
// the Netinkama rolė card's way out
// -----------------------------------------------------------
//
// The card stands alone, without the header, its role
// switcher or Atsijungti. It is reached by the browser's
// Back after a role switch (the switch replaces only the
// current history entry, so the workspace pages before it
// stay) or by a link into another workspace, so it carries
// its own way out: "Grįžti į pradžią", a link to "/", from
// where the tab goes on to its own role's workspace.
// -----------------------------------------------------------

test("the Netinkama rolė card offers a way out, a link or a button", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  renderApp("/manager/roles");
  await screen.findByRole("heading", { name: "Netinkama rolė" });

  expect([...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")]).not.toHaveLength(0);
});

test("Grįžti į pradžią leads home, and home on to the workspace of the tab's role", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  onRequest("GET", "/api/me", { ...ME, roles: ["Darbuotojas"] });
  const { user } = renderApp("/manager/roles");
  await screen.findByRole("heading", { name: "Netinkama rolė" });

  const link = screen.getByRole("link", { name: "Grįžti į pradžią" });
  expect(link).toHaveAttribute("href", "/");
  await user.click(link);

  expect(await screen.findByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/employee");
  expect(screen.queryByRole("heading", { name: "Netinkama rolė" })).not.toBeInTheDocument();
  expect(requestsTo("GET", "/api/session/check")).toHaveLength(1);
});







// -----------------------------------------------------------
// a revoked role gives up its workspace
// -----------------------------------------------------------
//
// A manager who removes their own Vadybininkas role on the
// roles page confirms it, and the page fires
// "app:roles-updated". The header reloads the roles, moves
// the tab's role to one still owned and, as a switch by hand
// does, the tab to that role's workspace: the manager pages
// do not stay open under a role the backend refuses.
// -----------------------------------------------------------

test("removing your own manager role moves the tab to the workspace of the role left", async () => {
  signInAs("Vadybininkas");
  let owned = ["Darbuotojas", "Vadybininkas"];
  onRequest("GET", "/api/session/check", session(owned));
  onRequest("GET", "/api/me", () => ({ ...ME, roles: owned }));
  onRequest("GET", "/api/user-roles", () => ({ user: { id: 1, email: ME.email, full_name: ME.name }, roles: owned, allRoles: ["Darbuotojas", "Komisijos narys", "Vadybininkas"] }));
  onRequest("POST", "/api/user-roles/remove", () => {
    owned = ["Darbuotojas"];
    return { status: 204 };
  });
  const { user } = renderApp("/manager/roles");

  await user.type(await screen.findByLabelText("Darbuotojo el.paštas"), ME.email);
  await user.click(screen.getByRole("button", { name: "Įkelti" }));
  await user.click(await screen.findByTitle("Pašalinti"));
  expect(await screen.findByText("Pašalinta rolė: Vadybininkas")).toBeInTheDocument();

  await waitFor(() => expect(localStorage.getItem("activeRole")).toBe("Darbuotojas"));
  await waitFor(() => expect(window.location.pathname).toBe("/employee"));
  expect(await screen.findByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();
});







// -----------------------------------------------------------
// catch-all
// -----------------------------------------------------------
//
// An unknown path lands on "/", where HomeGate takes over:
// SignIn when signed out, the stored role's workspace when
// signed in.
// -----------------------------------------------------------

test("an unknown path falls back to / — the SignIn card when signed out", async () => {
  onRequest("GET", "/api/session/check", SIGNED_OUT);
  renderApp("/no/such/page");

  expect(await screen.findByRole("heading", { name: "Vilniaus universiteto veiklos" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
});

test("an unknown path falls back to / — the stored role's workspace when signed in", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/session/check", session(["Komisijos narys"]));
  onRequest("GET", "/api/me", { ...ME, roles: ["Komisijos narys"] });
  renderApp("/no/such/page");

  expect(await screen.findByRole("heading", { name: "Komisijos nario langas" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/committee");
});







// -----------------------------------------------------------
// one role per tab
// -----------------------------------------------------------
//
// Switching the role in one tab must not pull the rug from
// under another: the shared storage only remembers the last
// choice for tabs opened later. A manager tab whose user
// switched to Darbuotojas in a second tab keeps its
// workspace when it navigates, and its requests keep saying
// Vadybininkas.
// -----------------------------------------------------------

test("another tab's role switch leaves this tab's workspace and its X-Active-Role alone", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas", "Vadybininkas"]));
  onRequest("GET", "/api/me", ME);
  onRequest("GET", "/api/activities/all", []);
  onRequest("GET", "/api/themes", []);
  const { user } = renderApp("/manager");
  expect(await screen.findByRole("heading", { name: "Vadybininko langas" })).toBeInTheDocument();

  // What the other tab's switch writes to the shared storage
  localStorage.setItem("activeRole", "Darbuotojas");

  await user.click(screen.getByRole("link", { name: "Eksportas" }));
  expect(await screen.findByRole("heading", { name: "Darbuotojų veiklų eksportas" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Netinkama rolė" })).not.toBeInTheDocument();
  await settle();
  expect(requestsTo("GET", "/api/activities/all")[0].headers["x-active-role"]).toBe("Vadybininkas");
});







// -----------------------------------------------------------
// the session ends mid-work
// -----------------------------------------------------------
//
// Eight hours after sign-in the cookie is gone and every API
// call answers 401 Neprisijungta. Instead of a page that only
// shows the error, a notice explains it and offers a fresh
// sign-in in a NEW tab — this one keeps whatever was typed —
// and can be dismissed. A 401 from the probe on load is no
// such moment: that is simply signed out.
// -----------------------------------------------------------

test("a 401 while signed in offers a fresh sign-in in a new tab and keeps the page", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/session/check", session(["Darbuotojas"]));
  onRequest("GET", "/api/me", SIGNED_OUT);
  const { user } = renderApp("/employee");

  const notice = await screen.findByRole("dialog", { name: "Prisijungimo sesija baigėsi" });
  const link = within(notice).getByRole("link", { name: "Prisijungti naujame skirtuke" });
  expect(link).toHaveAttribute("href", "/auth/saml/login");
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();

  await user.click(within(notice).getByRole("button", { name: "Uždaryti" }));
  expect(screen.queryByRole("dialog", { name: "Prisijungimo sesija baigėsi" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Darbuotojo langas" })).toBeInTheDocument();
});

test("a signed-out probe is not an ended session: the SignIn card, no notice", async () => {
  onRequest("GET", "/api/session/check", SIGNED_OUT);
  renderApp("/");

  expect(await screen.findByRole("heading", { name: "Vilniaus universiteto veiklos" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Prisijungimo sesija baigėsi" })).not.toBeInTheDocument();
});
