// -----------------------------------------------------------
//  [*] Regression — components/appErrorBoundary.jsx
//
//  A healthy subtree renders through untouched; a subtree
//  that throws while rendering is replaced by the error card
//  — its text, the mail link and the reload button, which
//  reloads the window — and the error goes to console.error,
//  never into the card.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const { rerender } = render(<AppErrorBoundary><Bomb explode={false} /></AppErrorBoundary>);
    expect(screen.getByText("Viskas gerai")).toBeInTheDocument();
    expect(screen.queryByText("Įvyko netikėta klaida.")).not.toBeInTheDocument();

    rerender(<AppErrorBoundary><Bomb explode /></AppErrorBoundary>);
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
