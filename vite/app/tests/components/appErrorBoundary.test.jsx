// -----------------------------------------------------------
//  [*] Regression — components/appErrorBoundary.jsx
//
//  A healthy subtree renders through untouched; a subtree
//  that throws while rendering is replaced by the error card
//  — its text, the mail link and the reload button, which
//  reloads the window — and the error goes to console.error,
//  never into the card. Leaving the broken page clears the
//  card: its "Grįžti į pradžią" link, or Back and Forward,
//  render the other page. The boundary reads the router's
//  location, so it is rendered inside one.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";
import AppErrorBoundary from "@/components/appErrorBoundary.jsx";


// A child that throws on render when told to
function Bomb({ explode }) {
  if (explode) throw new Error("secret internals: themes.map is not a function");
  return <p>Viskas gerai</p>;
}







// -----------------------------------------------------------
// the boundary
// -----------------------------------------------------------
//
// Children render normally; a render error swaps in the card
// with no trace of the error text; the button reloads.
// -----------------------------------------------------------

test("renders children until one throws, then the card; reload button reloads", async () => {
  const user = userEvent.setup();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const original = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", { value: { ...window.location, reload: vi.fn() }, writable: true, configurable: true });

  try {
    const inRouter = (explode) => <MemoryRouter><AppErrorBoundary><Bomb explode={explode} /></AppErrorBoundary></MemoryRouter>;
    const { rerender } = render(inRouter(false));
    expect(screen.getByText("Viskas gerai")).toBeInTheDocument();
    expect(screen.queryByText("Įvyko netikėta klaida.")).not.toBeInTheDocument();

    rerender(inRouter(true));
    expect(screen.getByRole("heading", { name: "Įvyko netikėta klaida." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "info@knf.vu.lt" })).toHaveAttribute("href", "mailto:info@knf.vu.lt");
    expect(document.body.textContent).not.toContain("secret internals");
    expect(errors.mock.calls.some((c) => String(c[0]).includes("Puslapio atvaizduoti nepavyko"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "Perkrauti puslapį" }));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(window, "location", original);
  }
});







// -----------------------------------------------------------
// leaving the broken page
// -----------------------------------------------------------
//
// The card lasts only as long as the page it broke on: its
// "Grįžti į pradžią" link renders home, and a browser history
// step to another page renders that page — without a reload,
// which would bring a crash tied to the page straight back.
// -----------------------------------------------------------

test("the card's way home, or Back and Forward to another page, render that page again", async () => {
  const user = userEvent.setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const routes = (
    <BrowserRouter>
      <AppErrorBoundary>
        <Routes>
          <Route path="/" element={<p>Pradžia</p>} />
          <Route path="/sugedes" element={<Bomb explode />} />
          <Route path="/kitas" element={<p>Kitas puslapis</p>} />
        </Routes>
      </AppErrorBoundary>
    </BrowserRouter>
  );

  try {
    window.history.pushState({}, "", "/sugedes");
    const { unmount } = render(routes);
    expect(screen.getByRole("heading", { name: "Įvyko netikėta klaida." })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Grįžti į pradžią" }));
    expect(screen.getByText("Pradžia")).toBeInTheDocument();
    unmount();

    window.history.pushState({}, "", "/sugedes");
    render(routes);
    expect(screen.getByRole("heading", { name: "Įvyko netikėta klaida." })).toBeInTheDocument();
    await act(async () => {
      window.history.pushState({}, "", "/kitas");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("Kitas puslapis")).toBeInTheDocument();
    expect(screen.queryByText("Įvyko netikėta klaida.")).not.toBeInTheDocument();
  } finally {
    window.history.pushState({}, "", "/");
  }
});
