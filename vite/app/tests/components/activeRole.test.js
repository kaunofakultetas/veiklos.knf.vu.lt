// -----------------------------------------------------------
//  [*] Regression — components/activeRole.js
//
//  The active role belongs to a browser tab. A tab reads its
//  own copy (sessionStorage); the shared copy (localStorage)
//  only remembers the last choice, so a tab opened later
//  starts there. Another tab's switch rewrites the shared
//  copy and must not be seen by a tab that already has its
//  role. Both storages are wiped before every test
//  (tests/setup.js).
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { clearActiveRole, getActiveRole, setActiveRole } from "@/components/activeRole.js";







// -----------------------------------------------------------
// a tab keeps its own role
// -----------------------------------------------------------
//
// Set here, read back here — while another tab's switch,
// which lands in the shared copy, changes nothing here.
// -----------------------------------------------------------

test("a tab keeps its own role when another tab switches", () => {
  setActiveRole("Vadybininkas");
  expect(getActiveRole()).toBe("Vadybininkas");

  localStorage.setItem("activeRole", "Darbuotojas");
  expect(getActiveRole()).toBe("Vadybininkas");
});







// -----------------------------------------------------------
// a new tab starts from the last choice
// -----------------------------------------------------------
//
// A tab with no role of its own takes the last choice any
// tab made, and from then on keeps it as its own. With no
// choice at all the role is empty.
// -----------------------------------------------------------

test("a new tab starts from the last role chosen and then keeps it", () => {
  expect(getActiveRole()).toBe("");

  localStorage.setItem("activeRole", "Komisijos narys");
  expect(getActiveRole()).toBe("Komisijos narys");

  localStorage.setItem("activeRole", "Darbuotojas");
  expect(getActiveRole()).toBe("Komisijos narys");
});







// -----------------------------------------------------------
// a choice is remembered for later tabs; sign-out drops it
// -----------------------------------------------------------
//
// Choosing a role sets this tab's copy and the shared one;
// clearing (sign-out) drops both.
// -----------------------------------------------------------

test("choosing a role is remembered for later tabs; clearing drops it everywhere", () => {
  setActiveRole("Darbuotojas");
  expect(sessionStorage.getItem("activeRole")).toBe("Darbuotojas");
  expect(localStorage.getItem("activeRole")).toBe("Darbuotojas");

  clearActiveRole();
  expect(getActiveRole()).toBe("");
  expect(localStorage.getItem("activeRole")).toBeNull();
});
