// -----------------------------------------------------------
//  [*] Regression — pages/employee/export.jsx
//
//  The export page against the scripted fetch and a mocked
//  SheetJS: themes and the employee's activities load in
//  parallel with X-Active-Role, the preview table renders the
//  rows with status pills and "(nėra)" for a missing score,
//  the three multi-select filters narrow the rows (and the
//  theme filter narrows the subtheme options and resets the
//  subtheme picks), a filter's trigger reports aria-expanded,
//  its open menu is a group named after the filter and Escape
//  closes it, "Eksportuoti" hands the exact header row +
//  filtered rows to aoa_to_sheet, appends the sheet as
//  "Veiklos" and writes a timestamped file, an empty result
//  is refused with a message, and backend errors are shown
//  verbatim.
// -----------------------------------------------------------

import { test, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import ExportPage from "@/pages/employee/export.jsx";
import { onRequest, requestLog, resetFakeFetch } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// The page imports SheetJS by this exact path; the mock hands
// back marker objects so the sheet → book → file chain can
// be followed by identity
vi.mock("xlsx/dist/xlsx.full.min.js", () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({ marker: "sheet" })),
    book_new: vi.fn(() => ({ marker: "book" })),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

// vi.restoreAllMocks (tests/setup.js) leaves vi.fn call logs
// alone, so the SheetJS counters are cleared here per test
beforeEach(() => vi.clearAllMocks());


// Two themes whose subthemes arrive out of numeric order
// ("1.10." before "1.2.") so the option sort is visible
const THEMES = [
  { id: 1, code: "1.", title: "Studijos", subthemes: [
    { id: 11, code: "1.10.", title: "Dešimta" },
    { id: 12, code: "1.2.", title: "Antra" },
  ] },
  { id: 2, code: "2.", title: "Mokslas", subthemes: [
    { id: 21, code: "2.1.", title: "Straipsniai" },
  ] },
];

// Three activities: unscored, scored, and one scored 0 with
// no timestamp (the falsy edge cases of the score and date
// cells)
const ACTIVITIES = [
  { id: 101, theme_id: 1, subtheme_id: 11, theme_code: "1.", theme_title: "Studijos", subtheme_code: "1.10.", subtheme_title: "Dešimta",
    title: "Kursas A", description: "Aprašas A", status: "PATEIKTA", score: null, created_at: "2026-03-05T10:20:00Z" },
  { id: 102, theme_id: 2, subtheme_id: 21, theme_code: "2.", theme_title: "Mokslas", subtheme_code: "2.1.", subtheme_title: "Straipsniai",
    title: "Straipsnis B", description: null, status: "ĮVERTINTA", score: 4.5, created_at: "2026-04-01T08:00:00Z" },
  { id: 103, theme_id: 1, subtheme_id: 12, theme_code: "1.", theme_title: "Studijos", subtheme_code: "1.2.", subtheme_title: "Antra",
    title: "Seminaras C", description: "Aprašas C", status: "ATMESTA", score: 0, created_at: null },
];

// The exact column names the page writes into the workbook
const HEADER = [
  "Data",
  "Temos kodas",
  "Temos pavadinimas",
  "Potemės kodas",
  "Potemės pavadinimas",
  "Veiklos pavadinimas",
  "Veiklos aprašymas",
  "Būsena",
  "Įvertinimas",
];

// The page's lt-LT date-time, computed the same way so the
// expectation does not depend on the runner's time zone
const fmt = (iso) => new Date(iso).toLocaleString("lt-LT", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

// One multi-select filter by its label ("Tema" is also a
// column header, so the label class disambiguates), its
// trigger button, and the table row naming an activity
const filter = (label) => screen.getByText(label, { selector: ".multi-select-label" }).closest(".multi-select");
const filterTrigger = (label) => within(filter(label)).getByRole("button");
const optionLabels = (label) => within(filter(label)).getAllByRole("checkbox").map((c) => c.closest("label").textContent);
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));

const mountPage = () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("GET", "/api/activities/my", ACTIVITIES);
  return renderPage(ExportPage);
};







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Two GETs, both with the header; the preview shows every
// activity with its formatted date, "code — title" pairs, a
// status pill and the score or "(nėra)"; the filters start on
// their "(visos …)" placeholders.
// -----------------------------------------------------------

test("loads themes and activities with X-Active-Role and renders the preview table", async () => {
  mountPage();

  expect(await screen.findByRole("heading", { name: "Eksportas" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Filtruotos veiklos" })).toBeInTheDocument();
  await screen.findByText("Kursas A");
  expect(requestLog().map((r) => [r.method, r.path])).toEqual([["GET", "/api/themes"], ["GET", "/api/activities/my"]]);
  for (const r of requestLog()) expect(r.headers).toEqual({ "x-active-role": "Darbuotojas" });

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Data", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Įvertinimas",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(4);

  const a = rowNamed("Kursas A");
  expect(within(a).getByText(fmt("2026-03-05T10:20:00Z"))).toBeInTheDocument();
  expect(within(a).getByText("1. — Studijos")).toBeInTheDocument();
  expect(within(a).getByText("1.10. — Dešimta")).toBeInTheDocument();
  expect(within(a).getByText("PATEIKTA")).toHaveClass("status-pill", "status-pill--submitted");
  expect(within(a).getByText("(nėra)")).toBeInTheDocument();

  const b = rowNamed("Straipsnis B");
  expect(within(b).getByText("2.1. — Straipsniai")).toBeInTheDocument();
  expect(within(b).getByText("ĮVERTINTA")).toHaveClass("status-pill", "status-pill--scored");
  expect(within(b).getByText("4.5")).toBeInTheDocument();

  const c = rowNamed("Seminaras C");
  expect(within(c).getAllByRole("cell")[0]).toBeEmptyDOMElement();
  expect(within(c).getByText("ATMESTA")).toHaveClass("status-pill", "status-pill--rejected");
  expect(within(c).getByText("0")).toBeInTheDocument();
  expect(within(c).queryByText("(nėra)")).not.toBeInTheDocument();

  expect(filterTrigger("Tema")).toHaveTextContent("(visos temos)");
  expect(filterTrigger("Potemė")).toHaveTextContent("(visos potemės)");
  expect(filterTrigger("Būsena")).toHaveTextContent("(visos būsenos)");
  expect(screen.getByRole("button", { name: "Eksportuoti" })).toBeEnabled();
});







// -----------------------------------------------------------
// theme filter
// -----------------------------------------------------------
//
// Checking a theme keeps only its rows, names it on the
// trigger and narrows the subtheme options to that theme in
// numeric code order; a subtheme pick narrows further; a
// second theme reads "2 pasirinkta" and resets the subtheme
// picks.
// -----------------------------------------------------------

test("the theme filter narrows the rows and the subtheme options and resets subtheme picks", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(filterTrigger("Tema"));
  expect(optionLabels("Tema")).toEqual(["1. — Studijos", "2. — Mokslas"]);
  await user.click(within(filter("Tema")).getByRole("checkbox", { name: "1. — Studijos" }));
  expect(filterTrigger("Tema")).toHaveTextContent("1. — Studijos");
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.queryByText("Straipsnis B")).not.toBeInTheDocument();

  await user.click(filterTrigger("Potemė"));
  expect(optionLabels("Potemė")).toEqual(["1.2. — Antra", "1.10. — Dešimta"]);
  await user.click(within(filter("Potemė")).getByRole("checkbox", { name: "1.2. — Antra" }));
  expect(filterTrigger("Potemė")).toHaveTextContent("1.2. — Antra");
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Seminaras C")).toBeInTheDocument();

  await user.click(within(filter("Tema")).getByRole("checkbox", { name: "2. — Mokslas" }));
  expect(filterTrigger("Tema")).toHaveTextContent("2 pasirinkta");
  expect(filterTrigger("Potemė")).toHaveTextContent("(visos potemės)");
  expect(optionLabels("Potemė")).toEqual(["1.2. — Antra", "1.10. — Dešimta", "2.1. — Straipsniai"]);
  expect(within(filter("Potemė")).getAllByRole("checkbox").filter((c) => c.checked)).toEqual([]);
  expect(screen.getAllByRole("row")).toHaveLength(4);

  await user.click(within(filter("Tema")).getByRole("checkbox", { name: "1. — Studijos" }));
  await user.click(within(filter("Tema")).getByRole("checkbox", { name: "2. — Mokslas" }));
  expect(filterTrigger("Tema")).toHaveTextContent("(visos temos)");
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// status filter
// -----------------------------------------------------------
//
// The five fixed statuses; picking one keeps its rows, two
// read "2 pasirinkta", and a status nobody has empties the
// table to "(Nėra atitinkančių veiklų.)".
// -----------------------------------------------------------

test("the status filter offers the five statuses and empties the preview when nothing matches", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(filterTrigger("Būsena"));
  expect(optionLabels("Būsena")).toEqual(["PATEIKTA", "PATVIRTINTA", "ATMESTA", "TIKSLINTI", "ĮVERTINTA"]);

  await user.click(within(filter("Būsena")).getByRole("checkbox", { name: "ĮVERTINTA" }));
  expect(filterTrigger("Būsena")).toHaveTextContent("ĮVERTINTA");
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Straipsnis B")).toBeInTheDocument();

  await user.click(within(filter("Būsena")).getByRole("checkbox", { name: "TIKSLINTI" }));
  expect(filterTrigger("Būsena")).toHaveTextContent("2 pasirinkta");
  expect(screen.getAllByRole("row")).toHaveLength(2);

  await user.click(within(filter("Būsena")).getByRole("checkbox", { name: "ĮVERTINTA" }));
  expect(filterTrigger("Būsena")).toHaveTextContent("TIKSLINTI");
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// menu state
// -----------------------------------------------------------
//
// A filter's trigger is a listbox popup button whose
// aria-expanded follows the menu; the open menu is a group
// named after the filter's label, its checkboxes named by
// their option labels. Escape closes the menu from the
// trigger or from a checkbox, keeps the picks and puts focus
// back on the trigger; the trigger still toggles afterwards.
// -----------------------------------------------------------

test("the trigger reports aria-expanded and Escape closes the menu, keeping the picks", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const trigger = filterTrigger("Tema");
  expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = screen.getByRole("group", { name: "Tema" });
  expect(menu).toHaveClass("multi-select-menu");
  expect(within(menu).getAllByRole("checkbox")).toHaveLength(2);
  expect(screen.getByLabelText("1. — Studijos")).toHaveAttribute("type", "checkbox");

  await user.keyboard("{Escape}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(within(filter("Tema")).getByRole("checkbox", { name: "1. — Studijos" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveTextContent("1. — Studijos");
  expect(screen.getAllByRole("row")).toHaveLength(3);

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(within(filter("Tema")).getByRole("checkbox", { name: "1. — Studijos" })).toBeChecked();
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "Eksportuoti" })).toBeEnabled();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// export
// -----------------------------------------------------------
//
// "Eksportuoti" builds one array-of-arrays — the exact header
// row, then one row per filtered activity with the formatted
// date, codes, titles, description, status and score ("" for
// null) — appends the sheet as "Veiklos" to a new book and
// writes veiklos-eksportas-<timestamp>.xlsx.
// -----------------------------------------------------------

test("Eksportuoti writes the header row and every row into a \"Veiklos\" sheet", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledTimes(1);
  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
    HEADER,
    [fmt("2026-03-05T10:20:00Z"), "1.", "Studijos", "1.10.", "Dešimta", "Kursas A", "Aprašas A", "PATEIKTA", ""],
    [fmt("2026-04-01T08:00:00Z"), "2.", "Mokslas", "2.1.", "Straipsniai", "Straipsnis B", "", "ĮVERTINTA", 4.5],
    ["", "1.", "Studijos", "1.2.", "Antra", "Seminaras C", "Aprašas C", "ATMESTA", 0],
  ]);

  const sheet = XLSX.utils.aoa_to_sheet.mock.results[0].value;
  const book = XLSX.utils.book_new.mock.results[0].value;
  expect(XLSX.utils.book_new).toHaveBeenCalledTimes(1);
  expect(XLSX.utils.book_append_sheet).toHaveBeenCalledTimes(1);
  expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(book, sheet, "Veiklos");

  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  const [written, filename] = XLSX.writeFile.mock.calls[0];
  expect(written).toBe(book);
  expect(filename).toMatch(/^veiklos-eksportas-.*\.xlsx$/);
  expect(filename).toMatch(/^veiklos-eksportas-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.xlsx$/);
  expect(screen.queryByText("Nėra veiklų eksportui.")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});

test("the export honours the filters: only the filtered rows are written", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(filterTrigger("Būsena"));
  await user.click(within(filter("Būsena")).getByRole("checkbox", { name: "ATMESTA" }));
  expect(screen.getAllByRole("row")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
    HEADER,
    ["", "1.", "Studijos", "1.2.", "Antra", "Seminaras C", "Aprašas C", "ATMESTA", 0],
  ]);
  expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), "Veiklos");
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
});







// -----------------------------------------------------------
// nothing to export
// -----------------------------------------------------------
//
// With no filtered rows the button shows "Nėra veiklų
// eksportui." in the error status line and SheetJS is never
// touched.
// -----------------------------------------------------------

test("an empty filter result refuses the export with a message and no workbook", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(filterTrigger("Būsena"));
  await user.click(within(filter("Būsena")).getByRole("checkbox", { name: "TIKSLINTI" }));
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));
  expect(await screen.findByText("Nėra veiklų eksportui.")).toHaveClass("form-status", "form-status--error");
  expect(XLSX.utils.aoa_to_sheet).not.toHaveBeenCalled();
  expect(XLSX.utils.book_new).not.toHaveBeenCalled();
  expect(XLSX.utils.book_append_sheet).not.toHaveBeenCalled();
  expect(XLSX.writeFile).not.toHaveBeenCalled();
});







// -----------------------------------------------------------
// errors
// -----------------------------------------------------------
//
// Either GET failing shows the backend's error text verbatim;
// nothing loaded is kept (the themes are set only after both
// responses pass), so the preview is empty and the theme
// filter offers "(nėra pasirinkimų)".
// -----------------------------------------------------------

test("a failed activities load shows the error verbatim and drops the themes too", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("GET", "/api/activities/my", { status: 500, body: { error: "internal error" } });
  const { user } = renderPage(ExportPage);

  expect(await screen.findByText("internal error")).toBeInTheDocument();
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);

  await user.click(filterTrigger("Tema"));
  expect(within(filter("Tema")).getByText("(nėra pasirinkimų)")).toBeInTheDocument();
  await user.click(filterTrigger("Potemė"));
  expect(within(filter("Potemė")).getByText("(nėra pasirinkimų)")).toBeInTheDocument();
});

test("a failed theme load shows the error verbatim and keeps no activities", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", { status: 403, body: { error: "Neturite teisės" } });
  onRequest("GET", "/api/activities/my", ACTIVITIES);
  renderPage(ExportPage);

  expect(await screen.findByText("Neturite teisės")).toBeInTheDocument();
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Kursas A")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// wrong shape
// -----------------------------------------------------------
//
// A 200 whose body is not an array — from either GET in turn
// — is refused with the page's fixed message in the error
// status line instead of blanking the page on the next
// render; the preview stays empty, as after a failed GET.
// -----------------------------------------------------------

test("a non-array theme or activities reply is refused with a clear message instead of a blank page", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", { status: 200, body: { ok: true } });
  onRequest("GET", "/api/activities/my", ACTIVITIES);
  const { unmount } = renderPage(ExportPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status", "form-status--error");
  expect(screen.getByRole("heading", { name: "Eksportas" })).toBeInTheDocument();
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Kursas A")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toEqual([]);
  expect(requestLog()).toHaveLength(2);
  unmount();

  // The same page again, now with the activities misshapen
  resetFakeFetch();
  onRequest("GET", "/api/themes", THEMES);
  onRequest("GET", "/api/activities/my", { status: 200, body: { ok: true } });
  renderPage(ExportPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status", "form-status--error");
  expect(screen.getByRole("heading", { name: "Eksportas" })).toBeInTheDocument();
  expect(screen.getByText("(Nėra atitinkančių veiklų.)")).toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toEqual([]);
  expect(screen.getByRole("button", { name: "Eksportuoti" })).toBeEnabled();
  expect(requestLog()).toHaveLength(2);
});
