// -----------------------------------------------------------
//  [*] Test helpers — rendering shorthands
//
//  Small wrappers around Testing Library's render for the two
//  shapes the pages come in: plain (most pages read only
//  localStorage and fetch) and routed (layouts and AppHeader
//  need react-router). Plain .js on purpose: a .jsx helper
//  that exports functions trips the react-refresh lint rule.
// -----------------------------------------------------------

import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";







// -----------------------------------------------------------
// signInAs
// -----------------------------------------------------------
//
// signInAs("Komisijos narys") — the active role every page
// reads from localStorage for its X-Active-Role header.
//
// Used by:
//   - every page test
// -----------------------------------------------------------

export function signInAs(role) {
  localStorage.setItem("activeRole", role);
}







// -----------------------------------------------------------
// renderPage
// -----------------------------------------------------------
//
// renderPage(LimitsPage) → { user, ...renderResult }: the
// page mounted on its own, with a user-event session ready.
//
// Used by:
//   - the page tests without routing needs
// -----------------------------------------------------------

export function renderPage(Component, props = {}) {
  const user = userEvent.setup();
  return { user, ...render(createElement(Component, props)) };
}







// -----------------------------------------------------------
// renderRouted
// -----------------------------------------------------------
//
// renderRouted(Component, { path: "/manager/*", at:
// "/manager/roles" }) → the component under a MemoryRouter
// at `at`, registered on `path` (default "*"), so NavLinks,
// Outlets and useNavigate work.
//
// Used by:
//   - the layout and AppHeader tests
// -----------------------------------------------------------

export function renderRouted(Component, { path = "*", at = "/", props = {} } = {}) {
  const user = userEvent.setup();
  const tree = createElement(
    MemoryRouter,
    { initialEntries: [at] },
    createElement(Routes, null, createElement(Route, { path, element: createElement(Component, props) }))
  );
  return { user, ...render(tree) };
}
