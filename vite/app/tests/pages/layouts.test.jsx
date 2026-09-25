// -----------------------------------------------------------
//  [*] Regression — the three workspace layouts and homes
//
//  pages/{manager,employee,committee}/layout.jsx and
//  index.jsx: each shell renders AppHeader (which GETs
//  /api/me) with its NavLinks — texts, hrefs, the active one
//  — the routed page in its Outlet, and the footer; each
//  static home page carries its heading, its list and the
//  support mailto link.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import ManagerLayout from "@/pages/manager/layout.jsx";
import ManagerPage from "@/pages/manager/index.jsx";
import EmployeeLayout from "@/pages/employee/layout.jsx";
import EmployeePage from "@/pages/employee/index.jsx";
import CommitteeLayout from "@/pages/committee/layout.jsx";
import CommitteePage from "@/pages/committee/index.jsx";
import { onRequest, requestsTo } from "../helpers/fakeFetch.js";
import { renderRouted, signInAs } from "../helpers/render.js";


// The /api/me answer every header fetches, the footer line
// and the support sentence shared by the three homes
const ME = { name: "Jonas Jonaitis", email: "jonas@vu.lt", eid: "u100", roles: ["Darbuotojas", "Vadybininkas", "Komisijos narys"] };
const FOOTER = `© ${new Date().getFullYear()} Goda Stungurytė, ISKS'22. Visos teisės saugomos.`;
const SUPPORT = "Susidūrus su techninėmis kliūtimis parašykite el. laišką adresu:";

// The header's nav links as [text, href, active?]
const navLinks = () =>
  within(screen.getByRole("navigation")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href"), a.classList.contains("is-active")]);

// The home page's bullet texts
const bullets = () => within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);

// A workspace subtree like App.jsx's: the layout on `base`
// with the home as index route and a stub for every child
function renderWorkspace(Layout, HomePage, base, at) {
  const user = userEvent.setup();
  const tree = (
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path={base} element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="*" element={<div>Vidinis puslapis</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
  return { user, ...render(tree) };
}







// -----------------------------------------------------------
// layouts
// -----------------------------------------------------------
//
// Each shell: the header with the user from /api/me, the
// NavLinks in order with their hrefs, the one matching the
// location marked is-active / aria-current, and the footer.
// -----------------------------------------------------------

test("ManagerLayout: four nav links, the active one, the header and the footer", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  renderRouted(ManagerLayout, { path: "/manager/*", at: "/manager/roles" });

  expect(navLinks()).toEqual([
    ["Rolių tvarkymas", "/manager/roles", true],
    ["Peržiūra", "/manager/review", false],
    ["Eksportas", "/manager/export", false],
    ["Temų tvarkymas", "/manager/themes", false],
  ]);
  expect(screen.getByRole("link", { name: "Rolių tvarkymas" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Peržiūra" })).toHaveClass("employee-nav-link");
  expect(screen.getByText(FOOTER)).toHaveClass("app-footer-inner");
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Atsijungti" })).toBeInTheDocument();
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("EmployeeLayout: three nav links, the active one, the header and the footer", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/me", ME);
  renderRouted(EmployeeLayout, { path: "/employee/*", at: "/employee/my" });

  expect(navLinks()).toEqual([
    ["Nauja veikla", "/employee/new", false],
    ["Mano veiklos", "/employee/my", true],
    ["Eksportas", "/employee/export", false],
  ]);
  expect(screen.getByRole("link", { name: "Mano veiklos" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText(FOOTER)).toHaveClass("app-footer-inner");
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("CommitteeLayout: four nav links, the active one, the header and the footer", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/me", ME);
  renderRouted(CommitteeLayout, { path: "/committee/*", at: "/committee/limits" });

  expect(navLinks()).toEqual([
    ["Įvertinti veiklas", "/committee/evaluate", false],
    ["Įvertinimai", "/committee/results", false],
    ["Skaičiuoklė", "/committee/calculate", false],
    ["Limitų nustatymas", "/committee/limits", true],
  ]);
  expect(screen.getByRole("link", { name: "Limitų nustatymas" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText(FOOTER)).toHaveClass("app-footer-inner");
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});







// -----------------------------------------------------------
// homes
// -----------------------------------------------------------
//
// Each index page inside its layout's Outlet: the h1, the
// "Šiame darbalaukyje galėsite:" list, the support sentence
// and the mailto link; a nav click swaps the Outlet content
// and moves is-active.
// -----------------------------------------------------------

test("ManagerPage at /manager: heading, four bullets, the mailto link; a nav click swaps the Outlet", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/me", ME);
  const { user } = renderWorkspace(ManagerLayout, ManagerPage, "/manager", "/manager");

  expect(screen.getByRole("heading", { level: 1, name: "Vadybininko langas" })).toHaveClass("page-title");
  expect(screen.getByRole("heading", { level: 2, name: "Šiame darbalaukyje galėsite:" })).toBeInTheDocument();
  expect(bullets()).toEqual([
    "Pridėti arba pašalinti darbuotojo teises prie sistemos.",
    "Peržiūrėti ir patvirtinti arba atmesti darbuotojų užregistruotas.",
    "Filtruoti darbuotojų veiklas ir eksportuoti jas į Excel dokumentą.",
    "Sukurti arba pašalinti naujas temas ir potemes.",
  ]);
  expect(screen.getByText(SUPPORT)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "info@knf.vu.lt" })).toHaveAttribute("href", "mailto:info@knf.vu.lt");
  expect(navLinks().map(([, , active]) => active)).toEqual([false, false, false, false]);
  await screen.findByText("Jonas Jonaitis");

  await user.click(screen.getByRole("link", { name: "Peržiūra" }));
  expect(screen.getByText("Vidinis puslapis")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 1, name: "Vadybininko langas" })).not.toBeInTheDocument();
  expect(navLinks().map(([text, , active]) => [text, active])).toEqual([
    ["Rolių tvarkymas", false], ["Peržiūra", true], ["Eksportas", false], ["Temų tvarkymas", false],
  ]);
  expect(screen.getByText(FOOTER)).toBeInTheDocument();
  expect(requestsTo("GET", "/api/me")).toHaveLength(1);
});

test("EmployeePage at /employee: heading, three bullets, the mailto link", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/me", ME);
  renderWorkspace(EmployeeLayout, EmployeePage, "/employee", "/employee");

  expect(screen.getByRole("heading", { level: 1, name: "Darbuotojo langas" })).toHaveClass("page-title");
  expect(screen.getByRole("heading", { level: 2, name: "Šiame darbalaukyje galėsite:" })).toBeInTheDocument();
  expect(bullets()).toEqual([
    "Užregistruoti veiklas, skirtas studijų kokybei gerinti.",
    "Peržiūrėti visas užregistruotas veiklas ir jų būsenas.",
    "Filtruoti savo veiklas ir eksportuoti jas į Excel dokumentą.",
  ]);
  expect(screen.getByText(SUPPORT)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "info@knf.vu.lt" })).toHaveAttribute("href", "mailto:info@knf.vu.lt");
  expect(navLinks().map(([, , active]) => active)).toEqual([false, false, false]);
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
});

test("CommitteePage at /committee: heading, four bullets, the mailto link", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/me", ME);
  renderWorkspace(CommitteeLayout, CommitteePage, "/committee", "/committee");

  expect(screen.getByRole("heading", { level: 1, name: "Komisijos nario langas" })).toHaveClass("page-title");
  expect(screen.getByRole("heading", { level: 2, name: "Šiame darbalaukyje galėsite:" })).toBeInTheDocument();
  expect(bullets()).toEqual([
    "Įvertinti veiklas, kurios buvo patvirtinos vadybininko.",
    "Peržiūrėti įvertintas veiklas ir pakoreguoti įvertinimą esant reikiamybei.",
    "Suskaičiuoti kiekvienos temos balo vertę ir įvertinti darbuotojus.",
    "Nustatyti limitus temom ir potemėm.",
  ]);
  expect(screen.getByText(SUPPORT)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "info@knf.vu.lt" })).toHaveAttribute("href", "mailto:info@knf.vu.lt");
  expect(navLinks().map(([, , active]) => active)).toEqual([false, false, false, false]);
  expect(await screen.findByText("Jonas Jonaitis")).toBeInTheDocument();
});
