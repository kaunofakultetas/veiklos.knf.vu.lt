// -----------------------------------------------------------
//  [*] Regression — pages/committee/calculate.jsx
//
//  The calculator against the scripted fetch: theme totals
//  and employees load together with X-Active-Role, the totals
//  table (null → 0), the theme <select> filling the read-only
//  sums, the "Skaičiuoti" disabled rules, the PATCH with the
//  rounded point value and the result box that fills only
//  after a save, the employee picker (search, no-match text,
//  label fallbacks, the search box named by aria-label) → the
//  subthemes GET, the results table math (score × point,
//  caps, "—" rows, "Iš viso"), the empty states and error
//  messages verbatim, and the status box: plain form-status
//  for the saved confirmation, form-status--error for errors.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import CalculatePage from "@/pages/committee/calculate.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Three themes: a computable pair (1000 / 30), one with no
// evaluated score, one with no budget
const THEMES = [
  { theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė", theme_total_sum: "1000", theme_pointvalue: null, total_score: "30" },
  { theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas", theme_total_sum: "500", theme_pointvalue: "12.5", total_score: null },
  { theme_id: 3, theme_code: "6.3.", theme_title: "Sklaida", theme_total_sum: null, theme_pointvalue: null, total_score: "8" },
];

// Three employees: full name, email only, eid only
const EMPLOYEES = [
  { eid: "e1", full_name: "Ona Onaitė", email: "ona@vu.lt" },
  { eid: "e2", full_name: null, email: "petras@vu.lt" },
  { eid: "e3", full_name: null, email: null },
];

// One employee's rows: uncapped (4 × 25 = 100), capped
// (10 × 25 = 250 → 60), no point value (—), cap 0 = no cap
// (2 × 1.5 = 3) → Iš viso 163
const SUBTHEMES = [
  { theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė", subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos", total_score: "4", subtheme_cap: null, theme_pointvalue: "25" },
  { theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė", subtheme_id: 12, subtheme_code: "6.1.2.", subtheme_title: "Seminarai", total_score: "10", subtheme_cap: "60", theme_pointvalue: "25" },
  { theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas", subtheme_id: 21, subtheme_code: "6.2.1.", subtheme_title: "Straipsniai", total_score: "3", subtheme_cap: "50", theme_pointvalue: null },
  { theme_id: 3, theme_code: "6.3.", theme_title: "Sklaida", subtheme_id: 31, subtheme_code: "6.3.1.", subtheme_title: "Renginiai", total_score: "2", subtheme_cap: "0", theme_pointvalue: "1.5" },
];

const ROLE = { "x-active-role": "Komisijos narys" };

// The page with both mount requests scripted and answered
async function renderLoaded(themes = THEMES, employees = EMPLOYEES) {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated/theme-totals", themes);
  onRequest("GET", "/api/activities/evaluated/employees", employees);
  const result = renderPage(CalculatePage);
  await waitFor(() => expect(screen.queryByText("Kraunama temų informacija…")).not.toBeInTheDocument());
  return result;
}

// The table whose header row carries `header`, its body rows
// as cell texts
const tableWith = (header) => screen.getAllByRole("table").find((t) => within(t).queryByRole("columnheader", { name: header }));
const bodyRows = (table) => within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

const themeSelect = () => screen.getByLabelText("Pasirinkite temą");
const calcButton = () => screen.getByRole("button", { name: /Skaičiuoti|Saugoma…/ });
const resultBox = (container) => container.querySelector(".calc-result-box");
const pickerTrigger = () => screen.getByRole("button", { name: /\(nepasirinktas\)|Ona Onaitė|petras@vu.lt|^e3/ });
const pickerOptions = (container) => Array.from(container.querySelectorAll(".app-select-option")).map((b) => b.textContent);







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Both loading texts first, then the two GETs (one header
// each) and the totals table with null scores as 0; the
// calculator and the picker start blank and disabled.
// -----------------------------------------------------------

test("loads totals and employees together with X-Active-Role and renders the totals table", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated/theme-totals", THEMES);
  onRequest("GET", "/api/activities/evaluated/employees", EMPLOYEES);
  const { container } = renderPage(CalculatePage);
  expect(screen.getByText("Kraunama temų informacija…")).toBeInTheDocument();
  expect(screen.getByText("Kraunami darbuotojai…")).toBeInTheDocument();

  const table = await screen.findByRole("table");
  expect(requestLog().map((r) => [r.method, r.path, r.headers])).toEqual([
    ["GET", "/api/activities/evaluated/theme-totals", ROLE],
    ["GET", "/api/activities/evaluated/employees", ROLE],
  ]);
  expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Tema", "Pavadinimas", "Bendra balų suma"]);
  expect(bodyRows(table)).toEqual([
    ["6.1.", "Studijų kokybė", "30"],
    ["6.2.", "Mokslas", "0"],
    ["6.3.", "Sklaida", "8"],
  ]);

  expect(screen.getByRole("heading", { name: "Skaičiuoklė", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Temų balų suvestinė" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Darbuotojo veiklos pagal temas ir potemes" })).toBeInTheDocument();
  expect(themeSelect()).toHaveValue("");
  expect(screen.getAllByPlaceholderText("-").map((i) => [i.value, i.readOnly])).toEqual([["", true], ["", true]]);
  expect(calcButton()).toBeDisabled();
  expect(resultBox(container)).toHaveTextContent("—");
  expect(screen.getByText("Pasirinkite darbuotoją")).toBeInTheDocument();
  expect(pickerTrigger()).toHaveTextContent("(nepasirinktas)");
  expect(screen.queryByText("Veiklų lentelė pasirinktam darbuotojui")).not.toBeInTheDocument();
  expect(screen.queryByText("Kraunama temų informacija…")).not.toBeInTheDocument();
  expect(screen.queryByText("Kraunami darbuotojai…")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// theme select
// -----------------------------------------------------------
//
// The labelled <select> lists "(nepasirinkta)" and
// "code — title" per theme; a pick fills the two read-only
// sums (Number, 0 for null); "Skaičiuoti" is enabled only
// when both are positive.
// -----------------------------------------------------------

test("picking a theme fills the read-only sums; Skaičiuoti is enabled only for a computable pair", async () => {
  const { user } = await renderLoaded();
  const select = themeSelect();
  expect(select).toHaveAttribute("id", "calc-theme-select");
  expect(within(select).getAllByRole("option").map((o) => [o.value, o.textContent])).toEqual([
    ["", "(nepasirinkta)"],
    ["1", "6.1. — Studijų kokybė"],
    ["2", "6.2. — Mokslas"],
    ["3", "6.3. — Sklaida"],
  ]);
  const [budget, scores] = screen.getAllByPlaceholderText("-");
  expect(screen.getByText("Temai nustatyta bendra suma:")).toBeInTheDocument();
  expect(screen.getByText("Bendra temos balų suma:")).toBeInTheDocument();

  await user.selectOptions(select, "1");
  expect(budget).toHaveValue("1000");
  expect(scores).toHaveValue("30");
  expect(calcButton()).toBeEnabled();

  await user.selectOptions(select, "2");
  expect(budget).toHaveValue("500");
  expect(scores).toHaveValue("0");
  expect(calcButton()).toBeDisabled();

  await user.selectOptions(select, "3");
  expect(budget).toHaveValue("0");
  expect(scores).toHaveValue("8");
  expect(calcButton()).toBeDisabled();

  await user.selectOptions(select, "");
  expect(budget).toHaveValue("");
  expect(scores).toHaveValue("");
  expect(calcButton()).toBeDisabled();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// save
// -----------------------------------------------------------
//
// "Skaičiuoti" PATCHes { pointvalue } rounded to two decimals
// with both headers, confirms in the plain form-status box,
// and only then fills the "1 balo vertė:" box; picking
// another theme blanks it again. While the PATCH is pending
// the button reads "Saugoma…" and is disabled. A refused
// PATCH shows the backend's reason (or "status statusText"
// without a JSON body) in the form-status--error box.
// -----------------------------------------------------------

test("Skaičiuoti PATCHes the rounded point value and shows it only after the save", async () => {
  onRequest("PATCH", "/api/themes/1/pointvalue", { id: 1, pointvalue: 33.33 });
  const { user, container } = await renderLoaded();
  await user.selectOptions(themeSelect(), "1");
  expect(resultBox(container)).toHaveTextContent("—");

  await user.click(calcButton());
  const saved = await screen.findByText("1 balo vertė išsaugota.");
  expect(saved).toHaveClass("form-status");
  expect(saved).not.toHaveClass("form-status--error");
  const [patch] = requestsTo("PATCH", "/api/themes/1/pointvalue");
  expect(patch.headers).toEqual({ ...ROLE, "content-type": "application/json" });
  expect(patch.body).toEqual({ pointvalue: 33.33 });
  expect(screen.getByText("1 balo vertė:")).toBeInTheDocument();
  expect(resultBox(container)).toHaveTextContent("33.33");
  expect(calcButton()).toBeEnabled();

  await user.selectOptions(themeSelect(), "2");
  expect(resultBox(container)).toHaveTextContent("—");
  await user.selectOptions(themeSelect(), "1");
  expect(resultBox(container)).toHaveTextContent("—");
  expect(requestsTo("PATCH", "/api/themes/1/pointvalue")).toHaveLength(1);
});

test("while the PATCH is pending the button reads Saugoma… and is disabled", async () => {
  let release;
  onRequest("PATCH", "/api/themes/1/pointvalue", () => new Promise((resolve) => { release = () => resolve({ id: 1, pointvalue: 33.33 }); }));
  const { user } = await renderLoaded();
  await user.selectOptions(themeSelect(), "1");

  await user.click(calcButton());
  expect(await screen.findByRole("button", { name: "Saugoma…" })).toBeDisabled();
  expect(screen.queryByText("1 balo vertė išsaugota.")).not.toBeInTheDocument();

  release();
  await screen.findByText("1 balo vertė išsaugota.");
  expect(screen.getByRole("button", { name: "Skaičiuoti" })).toBeEnabled();
});

test("a refused PATCH shows the backend's reason in the error box and leaves the result blank", async () => {
  let attempt = 0;
  onRequest("PATCH", "/api/themes/1/pointvalue", () => (++attempt === 1
    ? { status: 403, body: { error: "Neturite teisės keisti balo vertės" } }
    : { status: 500, body: "boom" }));
  const { user, container } = await renderLoaded();
  await user.selectOptions(themeSelect(), "1");

  await user.click(calcButton());
  expect(await screen.findByText("Neturite teisės keisti balo vertės")).toHaveClass("form-status", "form-status--error");
  expect(resultBox(container)).toHaveTextContent("—");
  expect(calcButton()).toBeEnabled();

  await user.click(calcButton());
  expect(await screen.findByText("500")).toHaveClass("form-status", "form-status--error");
  expect(resultBox(container)).toHaveTextContent("—");
  expect(requestsTo("PATCH", "/api/themes/1/pointvalue")).toHaveLength(2);
});







// -----------------------------------------------------------
// load errors and empty states
// -----------------------------------------------------------
//
// Either GET refused → its reason verbatim and BOTH panels
// empty (the other answer is discarded); two empty answers →
// the two empty texts and no error.
// -----------------------------------------------------------

test("a refused theme-totals load shows the backend's reason and both empty states", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated/theme-totals", { status: 500, body: { error: "internal error" } });
  onRequest("GET", "/api/activities/evaluated/employees", EMPLOYEES);
  renderPage(CalculatePage);

  expect(await screen.findByText("internal error")).toHaveClass("form-status--error");
  expect(screen.getByText("Šiuo metu nėra įvertintų temų.")).toHaveClass("employee-empty");
  expect(screen.getByText("Nerasta darbuotojų.")).toHaveClass("employee-empty");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(within(themeSelect()).getAllByRole("option").map((o) => o.textContent)).toEqual(["(nepasirinkta)"]);
});

test("a refused employees load discards the loaded themes too", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated/theme-totals", THEMES);
  onRequest("GET", "/api/activities/evaluated/employees", { status: 403, body: { error: "Neturite teisės" } });
  renderPage(CalculatePage);

  expect(await screen.findByText("Neturite teisės")).toBeInTheDocument();
  expect(screen.getByText("Šiuo metu nėra įvertintų temų.")).toBeInTheDocument();
  expect(screen.getByText("Nerasta darbuotojų.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("empty answers show the two empty states without an error", async () => {
  await renderLoaded([], []);

  expect(screen.getByText("Šiuo metu nėra įvertintų temų.")).toBeInTheDocument();
  expect(screen.getByText("Nerasta darbuotojų.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /\(nepasirinktas\)/ })).not.toBeInTheDocument();
  expect(within(themeSelect()).getAllByRole("option")).toHaveLength(1);
  expect(calcButton()).toBeDisabled();
  expect(document.querySelector(".form-status")).toBeNull();
});







// -----------------------------------------------------------
// employee picker
// -----------------------------------------------------------
//
// The trigger opens the list with the search box (named
// "Ieškoti darbuotojo" through aria-label); labels fall back
// full_name → email → eid; the search filters
// case-insensitively and reports no match; a pick closes
// the list, clears the search, shows the label and GETs the
// employee's subthemes with the header.
// -----------------------------------------------------------

test("the picker: labels, search, no-match text; a pick GETs the subthemes and shows the label", async () => {
  onRequest("GET", "/api/activities/evaluated/employee/e2/subthemes", []);
  const { user, container } = await renderLoaded();
  expect(pickerOptions(container)).toEqual([]);

  await user.click(pickerTrigger());
  const search = screen.getByPlaceholderText("Ieškoti darbuotojo...");
  expect(screen.getByLabelText("Ieškoti darbuotojo")).toBe(search);
  expect(pickerOptions(container)).toEqual(["Ona Onaitė", "petras@vu.lt", "e3"]);

  await user.type(search, "PET");
  expect(pickerOptions(container)).toEqual(["petras@vu.lt"]);
  expect(screen.queryByText("(nėra atitinkančių darbuotojų)")).not.toBeInTheDocument();

  await user.clear(search);
  await user.type(search, "zzz");
  expect(pickerOptions(container)).toEqual([]);
  expect(screen.getByText("(nėra atitinkančių darbuotojų)")).toHaveClass("multi-select-empty");

  await user.clear(search);
  await user.type(search, "petras");
  await user.click(screen.getByRole("button", { name: "petras@vu.lt" }));
  expect(screen.queryByPlaceholderText("Ieškoti darbuotojo...")).not.toBeInTheDocument();
  expect(pickerTrigger()).toHaveTextContent("petras@vu.lt");

  expect(await screen.findByText("Šis darbuotojas neturi įvertintų veiklų.")).toHaveClass("employee-empty");
  expect(screen.getByRole("heading", { name: "Veiklų lentelė pasirinktam darbuotojui" })).toBeInTheDocument();
  const [get] = requestsTo("GET", "/api/activities/evaluated/employee/e2/subthemes");
  expect(get.headers).toEqual(ROLE);
  expect(requestLog()).toHaveLength(3);

  await user.click(pickerTrigger());
  expect(screen.getByPlaceholderText("Ieškoti darbuotojo...")).toHaveValue("");
  expect(pickerOptions(container)).toEqual(["Ona Onaitė", "petras@vu.lt", "e3"]);
});







// -----------------------------------------------------------
// results table
// -----------------------------------------------------------
//
// Per row: score × the stored point value, clamped to the
// cap when cap > 0 (0 or null = no cap); a row whose raw
// product is 0 shows "—" and is left out of "Iš viso". A
// refused subthemes load shows its reason verbatim.
// -----------------------------------------------------------

test("the results table: score × point, caps, dashes for zero rows, Iš viso", async () => {
  onRequest("GET", "/api/activities/evaluated/employee/e1/subthemes", SUBTHEMES);
  const { user } = await renderLoaded();

  await user.click(pickerTrigger());
  await user.click(screen.getByRole("button", { name: "Ona Onaitė" }));
  await screen.findByText("Iš viso: 163.00");
  const [get] = requestsTo("GET", "/api/activities/evaluated/employee/e1/subthemes");
  expect(get.headers).toEqual(ROLE);

  const table = tableWith("Rezultatas");
  expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Tema", "Potemė", "Balų suma", "1 balo vertė", "Rezultatas"]);
  expect(bodyRows(table)).toEqual([
    ["6.1. — Studijų kokybė", "6.1.1. — Paskaitos", "4", "25.00", "100.00"],
    ["6.1. — Studijų kokybė", "6.1.2. — Seminarai", "10", "25.00", "60.00"],
    ["6.2. — Mokslas", "6.2.1. — Straipsniai", "3", "—", "—"],
    ["6.3. — Sklaida", "6.3.1. — Renginiai", "2", "1.50", "3.00"],
  ]);
  expect(bodyRows(tableWith("Bendra balų suma"))).toHaveLength(3);
});

test("a refused subthemes load shows the backend's reason", async () => {
  let release;
  onRequest("GET", "/api/activities/evaluated/employee/e3/subthemes", () => new Promise((resolve) => {
    release = () => resolve({ status: 404, body: { error: "Darbuotojas nerastas" } });
  }));
  const { user } = await renderLoaded();

  await user.click(pickerTrigger());
  await user.click(screen.getByRole("button", { name: "e3" }));
  expect(await screen.findByText("Kraunama…")).toHaveClass("employee-muted");
  expect(pickerTrigger()).toHaveTextContent("e3");

  release();
  expect(await screen.findByText("Darbuotojas nerastas")).toHaveClass("form-status--error");
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(screen.getByText("Šis darbuotojas neturi įvertintų veiklų.")).toBeInTheDocument();
  expect(screen.queryByText(/Iš viso:/)).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// non-array body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of a list — the
// theme totals, the employees or the picked employee's
// subthemes, each in turn — is refused before it reaches
// state: the page keeps its h1 and empty states, shows
// "Klaida: netikėtas serverio atsakymas." once and renders
// no rows for that list instead of blanking.
// -----------------------------------------------------------

test("a 200 whose body is not a list — any of the three — is refused with one message, not a blank page", async () => {
  signInAs("Komisijos narys");
  // `bad` names the mount list that answers { ok: true } this
  // time; the other one is intact
  let bad = "";
  const listOr = (path, list) => () => (bad === path ? { status: 200, body: { ok: true } } : list);
  onRequest("GET", "/api/activities/evaluated/theme-totals", listOr("/api/activities/evaluated/theme-totals", THEMES));
  onRequest("GET", "/api/activities/evaluated/employees", listOr("/api/activities/evaluated/employees", EMPLOYEES));
  onRequest("GET", "/api/activities/evaluated/employee/e1/subthemes", { status: 200, body: { ok: true } });

  for (const path of ["/api/activities/evaluated/theme-totals", "/api/activities/evaluated/employees"]) {
    bad = path;
    const { unmount } = renderPage(CalculatePage);
    expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status--error");
    expect(screen.getByRole("heading", { name: "Skaičiuoklė", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Šiuo metu nėra įvertintų temų.")).toBeInTheDocument();
    expect(screen.getByText("Nerasta darbuotojų.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(themeSelect()).getAllByRole("option")).toHaveLength(1);
    unmount();
  }

  // Both mount lists intact, the picked employee's list is
  // not: the message, the employee's empty state, the totals
  // table untouched
  bad = "";
  const { user } = renderPage(CalculatePage);
  await screen.findByRole("table");
  await user.click(pickerTrigger());
  await user.click(screen.getByRole("button", { name: "Ona Onaitė" }));

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status--error");
  expect(screen.getByRole("heading", { name: "Skaičiuoklė", level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Šis darbuotojas neturi įvertintų veiklų.")).toHaveClass("employee-empty");
  expect(screen.queryByText(/Iš viso:/)).not.toBeInTheDocument();
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(bodyRows(tableWith("Bendra balų suma"))).toHaveLength(3);
  expect(requestsTo("GET", "/api/activities/evaluated/employee/e1/subthemes")).toHaveLength(1);
  expect(requestLog()).toHaveLength(7);
});
