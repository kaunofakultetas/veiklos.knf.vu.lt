// -----------------------------------------------------------
//  [*] Regression — App.jsx
//
//  The SPA root against the scripted fetch: the one session
//  probe and its "Kraunama…" card, the SignIn card for a 401
//  (and for a probe that fails), the sign-in button's hard
//  navigation, the role flow after a 200 — one role picks
//  itself, several open the picker, a stored role goes
//  straight to its workspace, no roles stays on the loading
//  card — the RoleRoute guard for a wrong or missing role,
//  and the catch-all redirect to "/".
// -----------------------------------------------------------

import { test, expect, vi, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App.jsx";
import { onRequest, requestsTo, requestLog } from "./helpers/fakeFetch.js";
import { signInAs } from "./helpers/render.js";


// The signed-in user, the /api/me answer the workspace
// headers fetch, and the two probe outcomes
const USER = { eid: "u100", name: "Jonas Jonaitis", email: "jonas@vu.lt" };
const ME = { name: "Jonas Jonaitis", email: "jonas@vu.lt", eid: "u100", roles: ["Darbuotojas", "Vadybininkas", "Komisijos narys"] };
const SIGNED_OUT = { status: 401, body: { error: "Neprisijungta" } };
const session = (roles) => ({ user: USER, roles });

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
  expect(screen.getByText(`© ${new Date().getFullYear()} ISKS'22 Goda Stungurytė. Visos teisės saugomos.`)).toBeInTheDocument();
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
// role flow
// -----------------------------------------------------------
//
// After a 200: exactly one role stores itself and opens its
// workspace (whose header then GETs /api/me); several roles
// open the picker, whose "Patvirtinti" stores the choice;
// a stored role skips both; no roles stays on "Kraunama…".
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
  onRequest("GET", "/api/session/check", session([{ name: "Darbuotojas" }, { name: "Komisijos narys" }]));
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

test("a session with no roles stays on the Kraunama… card", async () => {
  onRequest("GET", "/api/session/check", session([]));
  renderApp("/");
  await settle();

  expect(requestLog()).toHaveLength(1);
  expect(screen.getByText("Kraunama…")).toBeInTheDocument();
  expect(screen.queryByText("Pasirinkite rolę")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Vilniaus universiteto veiklos" })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
  expect(localStorage.getItem("activeRole")).toBeNull();
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
