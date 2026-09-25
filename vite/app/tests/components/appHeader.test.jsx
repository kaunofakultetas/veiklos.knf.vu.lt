// -----------------------------------------------------------
//  [*] Regression — components/appHeader.jsx
//
//  The shared top bar against the scripted fetch: /api/me on
//  mount (roles as strings or { name } objects, the name with
//  its "—" fallback), the activeRole repair rules and the
//  "(nėra)" text once an answer holds no roles, the role
//  switcher only for several roles and its navigation, the
//  brand click, the "app:roles-updated" refetch, and sign-out
//  — the POST, the cleared role, and the redirect (a 2xx
//  answer's, or "/" when the answer is refused, not JSON, or
//  the request fails).
// -----------------------------------------------------------

import { test, expect, vi, afterEach } from "vitest";
import { screen, within, waitFor, fireEvent, act } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import AppHeader from "@/components/appHeader.jsx";
import { onRequest, requestsTo, requestLog } from "../helpers/fakeFetch.js";
import { renderRouted, signInAs } from "../helpers/render.js";


// The full /api/me answer: three roles
const ME = { name: "Jonas Jonaitis", email: "jonas@vu.lt", eid: "u100", roles: ["Darbuotojas", "Vadybininkas", "Komisijos narys"] };

// A nav child that prints the router's path, so a navigation
// the header triggers shows up in the DOM
function PathProbe() {
  const { pathname } = useLocation();
  return <span data-testid="path">{pathname}</span>;
}

const renderHeader = (at = "/manager") => renderRouted(AppHeader, { at, props: { children: <PathProbe /> } });
const path = () => screen.getByTestId("path").textContent;

// jsdom does not navigate, so the href sign-out assigns is
// read back from a plain stand-in, restored after the test
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

// Lets a pending fetch chain settle and React flush it
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// One bare GET /api/me; before it answers the name is "—"
// and the role block shows the stored role (or "Kraunama…");
// after it, the name and — for several roles — the switcher
// with the stored role selected. The nav children sit in
// the <nav>.
// -----------------------------------------------------------

test("loads /api/me on mount: name, the switcher for several roles, the nav children", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  renderHeader();
  expect(screen.getByText("—")).toHaveClass("app-user-name");
  expect(screen.getByText("Vadybininkas")).toHaveClass("app-role-value");

  expect(await screen.findByText("Jonas Jonaitis")).toHaveClass("app-user-name");
  expect(requestLog()).toEqual([expect.objectContaining({ method: "GET", path: "/api/me", headers: {}, body: null })]);
  const select = screen.getByRole("combobox");
  expect(select).toHaveClass("app-role-select");
  expect(select.value).toBe("Vadybininkas");
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Darbuotojas", "Vadybininkas", "Komisijos narys"]);
  expect(localStorage.getItem("activeRole")).toBe("Vadybininkas");

  expect(screen.getByText("VU KNF Veiklų registravimo sistema")).toHaveClass("app-brand");
  expect(screen.getByRole("img", { name: "VU logo" })).toHaveClass("app-logo");
  expect(screen.getByText("Prisijungta su role:")).toBeInTheDocument();
  expect(screen.getByText("Prisijungęs:")).toBeInTheDocument();
  expect(screen.getByRole("navigation")).toContainElement(screen.getByTestId("path"));
  expect(screen.getByRole("button", { name: "Atsijungti" })).toBeInTheDocument();
});

test("one role: no switcher, the role as text; { name } objects and a missing name are tolerated", async () => {
  onRequest("GET", "/api/me", { eid: "u1", roles: [{ name: "Darbuotojas" }] });
  renderHeader();
  expect(screen.getByText("Kraunama…")).toHaveClass("app-role-value");

  expect(await screen.findByText("Darbuotojas")).toHaveClass("app-role-value");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByText("—")).toHaveClass("app-user-name");
  expect(localStorage.getItem("activeRole")).toBe("Darbuotojas");
});

test("a refused /api/me leaves the stored role and the name alone", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/me", { status: 401, body: { error: "Neprisijungta" } });
  renderHeader();
  await settle();

  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
  expect(screen.getByText("Komisijos narys")).toHaveClass("app-role-value");
  expect(screen.getByText("—")).toHaveClass("app-user-name");
  expect(localStorage.getItem("activeRole")).toBe("Komisijos narys");
});







// -----------------------------------------------------------
// activeRole repair
// -----------------------------------------------------------
//
// A stored role the caller does not own becomes the first
// owned role; no roles at all removes the stored role and
// shows "(nėra)" — "Kraunama…" is only the time before
// /api/me answers, never the answer itself.
// -----------------------------------------------------------

test("a stored role the caller no longer owns is replaced by the first role", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", { ...ME, roles: ["Darbuotojas", "Komisijos narys"] });
  renderHeader();

  const select = await screen.findByRole("combobox");
  await waitFor(() => expect(select.value).toBe("Darbuotojas"));
  expect(localStorage.getItem("activeRole")).toBe("Darbuotojas");
  expect(within(select).getAllByRole("option").map((o) => o.value)).toEqual(["Darbuotojas", "Komisijos narys"]);
});

test("no roles: activeRole is removed and the bar shows (nėra); the logo then goes to /", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", { name: "Ona Onaitė", roles: [] });
  const { user } = renderHeader("/manager/roles");
  expect(screen.getByText("Vadybininkas")).toHaveClass("app-role-value");

  await screen.findByText("Ona Onaitė");
  await waitFor(() => expect(localStorage.getItem("activeRole")).toBeNull());
  expect(screen.getByText("(nėra)")).toHaveClass("app-role-value");
  expect(screen.queryByText("Vadybininkas")).not.toBeInTheDocument();
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  await user.click(screen.getByRole("img", { name: "VU logo" }));
  expect(path()).toBe("/");
});

test("no roles and nothing stored: Kraunama… only until /api/me answers, then (nėra)", async () => {
  let answer;
  onRequest("GET", "/api/me", () => new Promise((resolve) => { answer = resolve; }));
  renderHeader();
  expect(screen.getByText("Kraunama…")).toHaveClass("app-role-value");
  expect(screen.queryByText("(nėra)")).not.toBeInTheDocument();

  await act(async () => { answer({ name: "Ona Onaitė", roles: [] }); });
  expect(await screen.findByText("(nėra)")).toHaveClass("app-role-value");
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(localStorage.getItem("activeRole")).toBeNull();
});







// -----------------------------------------------------------
// navigation
// -----------------------------------------------------------
//
// Changing the switcher stores the role and navigates to its
// workspace; the brand goes to the active role's workspace.
// -----------------------------------------------------------

test("switching the role stores it and navigates to that workspace", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  const { user } = renderHeader("/manager/roles");
  const select = await screen.findByRole("combobox");
  expect(path()).toBe("/manager/roles");

  await user.selectOptions(select, "Komisijos narys");
  expect(localStorage.getItem("activeRole")).toBe("Komisijos narys");
  expect(select.value).toBe("Komisijos narys");
  expect(path()).toBe("/committee");

  await user.selectOptions(select, "Darbuotojas");
  expect(path()).toBe("/employee");

  await user.selectOptions(select, "Vadybininkas");
  expect(path()).toBe("/manager");
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("the brand goes to the active role's workspace", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/me", ME);
  const { user } = renderHeader("/employee/new");
  await screen.findByText("Jonas Jonaitis");

  await user.click(screen.getByText("VU KNF Veiklų registravimo sistema"));
  expect(path()).toBe("/employee");
});







// -----------------------------------------------------------
// app:roles-updated
// -----------------------------------------------------------
//
// The window event refetches /api/me and the switcher follows
// the new roles; unmounting removes the listener.
// -----------------------------------------------------------

test("app:roles-updated refetches /api/me and refreshes the switcher; unmount stops listening", async () => {
  signInAs("Vadybininkas");
  let calls = 0;
  onRequest("GET", "/api/me", () => (++calls === 1 ? { ...ME, roles: ["Vadybininkas"] } : ME));
  const { unmount } = renderHeader();
  expect(await screen.findByText("Vadybininkas")).toHaveClass("app-role-value");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  fireEvent(window, new Event("app:roles-updated"));
  const select = await screen.findByRole("combobox");
  expect(within(select).getAllByRole("option").map((o) => o.value)).toEqual(["Darbuotojas", "Vadybininkas", "Komisijos narys"]);
  expect(select.value).toBe("Vadybininkas");
  expect(requestsTo("GET", "/api/me")).toHaveLength(2);

  unmount();
  fireEvent(window, new Event("app:roles-updated"));
  await settle();
  expect(requestsTo("GET", "/api/me")).toHaveLength(2);
});







// -----------------------------------------------------------
// sign-out
// -----------------------------------------------------------
//
// "Atsijungti" removes the stored role, POSTs
// /auth/saml/logout with no headers or body, and hard-
// navigates to the redirect a 2xx answer carries — or to "/"
// when the answer is refused (even with a redirect in its
// body), is not JSON, or the request fails.
// -----------------------------------------------------------

test("Atsijungti clears activeRole, POSTs /auth/saml/logout and goes where a 2xx answer says", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("POST", "/auth/saml/logout", { redirect: "https://sso.vu.lt/logout?id=abc" });
  const { user } = renderHeader();
  await screen.findByText("Jonas Jonaitis");

  const location = fakeLocation();
  await user.click(screen.getByRole("button", { name: "Atsijungti" }));
  await waitFor(() => expect(location.href).toBe("https://sso.vu.lt/logout?id=abc"));
  expect(localStorage.getItem("activeRole")).toBeNull();
  const [post] = requestsTo("POST", "/auth/saml/logout");
  expect(post.headers).toEqual({});
  expect(post.body).toBeNull();
  expect(location.assign).not.toHaveBeenCalled();
});

test("a refused logout answer lands on / even when its body carries a redirect", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("POST", "/auth/saml/logout", { status: 500, body: { redirect: "https://sso.vu.lt/logout?id=abc" } });
  const { user } = renderHeader();
  await screen.findByText("Jonas Jonaitis");

  const location = fakeLocation();
  await user.click(screen.getByRole("button", { name: "Atsijungti" }));
  await waitFor(() => expect(location.href).toBe("/"));
  expect(localStorage.getItem("activeRole")).toBeNull();
  expect(requestsTo("POST", "/auth/saml/logout")).toHaveLength(1);
  expect(location.assign).not.toHaveBeenCalled();
});

test("a non-JSON logout answer lands on /", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("POST", "/auth/saml/logout", "Bye");
  const { user } = renderHeader();
  await screen.findByText("Jonas Jonaitis");

  const location = fakeLocation();
  await user.click(screen.getByRole("button", { name: "Atsijungti" }));
  await waitFor(() => expect(location.href).toBe("/"));
  expect(localStorage.getItem("activeRole")).toBeNull();
  expect(requestsTo("POST", "/auth/saml/logout")).toHaveLength(1);
});

test("a failed logout request lands on /", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  onRequest("POST", "/auth/saml/logout", () => { throw new Error("network down"); });
  const { user } = renderHeader();
  await screen.findByText("Jonas Jonaitis");

  const location = fakeLocation();
  await user.click(screen.getByRole("button", { name: "Atsijungti" }));
  await waitFor(() => expect(location.href).toBe("/"));
  expect(localStorage.getItem("activeRole")).toBeNull();
  expect(requestsTo("POST", "/auth/saml/logout")).toHaveLength(1);
});
