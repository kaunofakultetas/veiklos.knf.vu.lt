// -----------------------------------------------------------
//  [*] Regression — pages/committee/limits.jsx
//
//  The limits page against the scripted fetch: the theme
//  tree is loaded with the committee's X-Active-Role, both
//  tables render current values (two decimals, "—" for
//  none), a theme total and a subtheme cap are saved with the
//  exact PATCH bodies, the row updates and the draft resets,
//  the client-side validation refuses empty and negative
//  input without a request, and backend errors are shown as
//  sent.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import LimitsPage from "@/pages/committee/limits.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Two themes: one with a total and two capped/uncapped
// subthemes, one with nothing set
const THEMES = [
  { id: 1, code: "6.1.", title: "Studijų kokybė", total_sum: "1000", subthemes: [
    { id: 11, code: "6.1.1.", title: "Paskaitos", cap: "2.5" },
    { id: 12, code: "6.1.2.", title: "Seminarai", cap: null },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", total_sum: null, subthemes: [] },
];

// The table row whose first cells name the theme / subtheme
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// One GET with the header; the theme table shows totals to
// two decimals and "—" for null; the subtheme table shows
// "code — title" pairs and caps the same way.
// -----------------------------------------------------------

test("loads the tree with X-Active-Role and renders both tables", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", THEMES);
  renderPage(LimitsPage);

  expect(await screen.findByRole("heading", { name: "Temų bendros sumos" })).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
  expect(requestsTo("GET", "/api/themes")[0].headers).toEqual({ "x-active-role": "Komisijos narys" });

  const theme1 = rowNamed("Studijų kokybė");
  expect(within(theme1).getByText("1000.00")).toBeInTheDocument();
  expect(within(rowNamed("Mokslas")).getByText("—")).toBeInTheDocument();

  const sub1 = rowNamed("6.1.1. — Paskaitos");
  expect(within(sub1).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(sub1).getByText("2.50")).toBeInTheDocument();
  expect(within(rowNamed("6.1.2. — Seminarai")).getByText("—")).toBeInTheDocument();
  expect(screen.getAllByRole("spinbutton").map((i) => i.value)).toEqual(["0", "0", "0", "0"]);
});







// -----------------------------------------------------------
// theme total
// -----------------------------------------------------------
//
// Typing a sum and saving PATCHes { total_sum } as a number
// with both headers; the current column updates, the draft
// goes back to 0, the message confirms.
// -----------------------------------------------------------

test("saves a theme total: PATCH body, updated cell, reset draft, message", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("PATCH", "/api/themes/2/total-sum", { id: 2, total_sum: 12.5 });
  const { user } = renderPage(LimitsPage);
  await screen.findByRole("heading", { name: "Temų bendros sumos" });

  const row = rowNamed("Mokslas");
  const input = within(row).getByRole("spinbutton");
  await user.clear(input);
  await user.type(input, "12.5");
  await user.click(within(row).getByRole("button", { name: "Išsaugoti" }));

  await screen.findByText("Temos suma atnaujinta.");
  const [patch] = requestsTo("PATCH", "/api/themes/2/total-sum");
  expect(patch.headers).toEqual({ "x-active-role": "Komisijos narys", "content-type": "application/json" });
  expect(patch.body).toEqual({ total_sum: 12.5 });
  expect(within(rowNamed("Mokslas")).getByText("12.50")).toBeInTheDocument();
  expect(within(rowNamed("Mokslas")).getByRole("spinbutton").value).toBe("0");
});







// -----------------------------------------------------------
// subtheme cap
// -----------------------------------------------------------
//
// The same for a cap: PATCH { cap } to the subtheme route.
// -----------------------------------------------------------

test("saves a subtheme cap: PATCH body and updated cell", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("PATCH", "/api/themes/subthemes/12/cap", { id: 12, cap: 3 });
  const { user } = renderPage(LimitsPage);
  await screen.findByRole("heading", { name: "Potemių limitai" });

  const row = rowNamed("6.1.2. — Seminarai");
  const input = within(row).getByRole("spinbutton");
  await user.clear(input);
  await user.type(input, "3");
  await user.click(within(row).getByRole("button", { name: "Išsaugoti" }));

  await screen.findByText("Ribos sėkmingai atnaujintos.");
  const [patch] = requestsTo("PATCH", "/api/themes/subthemes/12/cap");
  expect(patch.body).toEqual({ cap: 3 });
  expect(patch.headers["x-active-role"]).toBe("Komisijos narys");
  expect(within(rowNamed("6.1.2. — Seminarai")).getByText("3.00")).toBeInTheDocument();
});







// -----------------------------------------------------------
// validation
// -----------------------------------------------------------
//
// An empty or negative draft is refused on the client with
// the field's own message and no PATCH leaves the page.
// -----------------------------------------------------------

test("empty and negative drafts are refused without a request", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(LimitsPage);
  await screen.findByRole("heading", { name: "Temų bendros sumos" });

  const themeRow = rowNamed("Studijų kokybė");
  await user.clear(within(themeRow).getByRole("spinbutton"));
  await user.click(within(themeRow).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Klaida: Suma negali būti tuščia.")).toBeInTheDocument();

  await user.type(within(themeRow).getByRole("spinbutton"), "-4");
  await user.click(within(themeRow).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Klaida: Suma turi būti teigiamas skaičius.")).toBeInTheDocument();

  const subRow = rowNamed("6.1.1. — Paskaitos");
  await user.clear(within(subRow).getByRole("spinbutton"));
  await user.click(within(subRow).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Klaida: Ribos reikšmė negali būti tuščia.")).toBeInTheDocument();

  await user.type(within(subRow).getByRole("spinbutton"), "-1");
  await user.click(within(subRow).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Klaida: Ribos reikšmė turi būti teigiamas skaičius.")).toBeInTheDocument();

  expect(requestLog().filter((r) => r.method === "PATCH")).toEqual([]);
});







// -----------------------------------------------------------
// errors
// -----------------------------------------------------------
//
// The backend's error text is shown as sent, on load and on
// save; the row keeps its old value after a refused save.
// -----------------------------------------------------------

test("backend errors are shown verbatim; a refused save changes nothing", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", { status: 500, body: { error: "internal error" } });
  renderPage(LimitsPage);
  expect(await screen.findByText("internal error")).toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toHaveLength(2);
});

test("a refused PATCH shows the backend's reason and keeps the old value", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("PATCH", "/api/themes/1/total-sum", { status: 400, body: { error: "Neteisinga suma" } });
  const { user } = renderPage(LimitsPage);
  await screen.findByRole("heading", { name: "Temų bendros sumos" });

  const row = rowNamed("Studijų kokybė");
  await user.clear(within(row).getByRole("spinbutton"));
  await user.type(within(row).getByRole("spinbutton"), "7");
  await user.click(within(row).getByRole("button", { name: "Išsaugoti" }));

  expect(await screen.findByText("Neteisinga suma")).toBeInTheDocument();
  await waitFor(() => expect(within(rowNamed("Studijų kokybė")).getByRole("button", { name: "Išsaugoti" })).toBeEnabled());
  expect(within(rowNamed("Studijų kokybė")).getByText("1000.00")).toBeInTheDocument();
  expect(within(rowNamed("Studijų kokybė")).getByRole("spinbutton").value).toBe("7");
});







// -----------------------------------------------------------
// non-array body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of the tree is
// refused before it reaches state: the page keeps its h1 and
// both section headings, shows "Klaida: netikėtas serverio
// atsakymas." once and renders only the two header rows
// instead of blanking.
// -----------------------------------------------------------

test("a 200 whose body is not a list is refused with one message, not a blank page", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/themes", { status: 200, body: { ok: true } });
  renderPage(LimitsPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status--error");
  expect(screen.getByRole("heading", { level: 1, name: "Temų ir potemių limitų nustatymas" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Temų bendros sumos" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Potemių limitai" })).toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toHaveLength(2);
  expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});
