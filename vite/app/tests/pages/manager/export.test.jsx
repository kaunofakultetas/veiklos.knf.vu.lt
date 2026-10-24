// -----------------------------------------------------------
//  [*] Regression — pages/manager/export.jsx
//
//  The manager's export page against the scripted fetch and a
//  mocked xlsx: activities and the theme tree load together
//  with the manager's X-Active-Role, the preview table renders
//  every activity, the employee filter lists each employee
//  once (name or eID — a numeric one too — Lithuanian order,
//  no eID → skipped) with a search box, each dropdown
//  announces its popup state, is named by its caption and
//  then by what it shows, and closes on Escape, the theme
//  filter narrows and resets the subtheme filter, the four
//  filters AND together, the export hands the exact header
//  and rows to aoa_to_sheet, appends "Veiklos" and writes a
//  file stamped with the local date and time, a text longer
//  than an XLSX cell holds is cut to fit, and an empty
//  selection refuses with "Nėra veiklų eksportui.", which a
//  later successful export clears.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import process from "node:process";
import { screen, within } from "@testing-library/react";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import ManagerExportPage from "@/pages/manager/export.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// The page imports xlsx by this exact path; the mock keeps
// the workbook calls inspectable and writes no file
vi.mock("xlsx/dist/xlsx.full.min.js", () => ({
  utils: {
    aoa_to_sheet: vi.fn(() => ({ sheet: true })),
    book_new: vi.fn(() => ({ SheetNames: [] })),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));


// Two themes; the second's subthemes are listed out of code
// order on purpose (6.2.10. before 6.2.9.)
const THEMES = [
  { id: 1, code: "6.1.", title: "Studijų kokybė", total_sum: "1000", pointvalue: "2.5", subthemes: [
    { id: 11, theme_id: 1, code: "6.1.1.", title: "Paskaitos", description: null, cap: "60" },
    { id: 12, theme_id: 1, code: "6.1.2.", title: "Seminarai", description: null, cap: null },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", total_sum: "500", pointvalue: "1", subthemes: [
    { id: 22, theme_id: 2, code: "6.2.10.", title: "Straipsniai", description: null, cap: "40" },
    { id: 21, theme_id: 2, code: "6.2.9.", title: "Konferencijos", description: null, cap: null },
  ] },
];

// The live catalog's shape: two theme families numbered
// alike, so their subthemes share codes; each theme's
// subthemes arrive out of code order
const FAMILIES = [
  { id: 1, code: "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.", title: "Komunikacija", total_sum: "0", pointvalue: null, subthemes: [
    { id: 11, theme_id: 1, code: "6.1.2.", title: "Renginiai", description: null, cap: null },
    { id: 12, theme_id: 1, code: "6.1.1.", title: "Straipsniai", description: null, cap: null },
  ] },
  { id: 2, code: "STUDIJŲ KOKYBĖ 6.1.", title: "Dėstymas", total_sum: "0", pointvalue: null, subthemes: [
    { id: 22, theme_id: 2, code: "6.1.2.", title: "Gerosios praktikos", description: null, cap: null },
    { id: 21, theme_id: 2, code: "6.1.1.", title: "Mentoriavimas", description: null, cap: null },
  ] },
];

// An activity with every /api/activities/all column present,
// overridable
const activity = (over) => ({
  id: 0, employee_eid: null, full_name: null,
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos",
  title: "", description: null, status: "PATEIKTA", score: null,
  rejection_comment: null, manager_comments: null, committee_comments: null,
  attachment_path: null, attachment_original_name: null,
  created_at: "2025-03-04T12:00:00Z", updated_at: "2025-03-06T08:00:00Z",
  ...over,
});

// Five activities: Jonas twice (one employee option), Yvona
// (sorts before Jonas only in Lithuanian order), an employee
// without a name (labelled by eID) and a row without an eID
// (no option at all)
const ACTIVITIES = [
  activity({ id: 1, employee_eid: "u10001", full_name: "Jonas Jonaitis", title: "Paskaitų ciklas", description: "Dešimt paskaitų", manager_comments: "Tinka" }),
  activity({ id: 2, employee_eid: "u10002", full_name: "Yvona Ylė", theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas", subtheme_id: 22, subtheme_code: "6.2.10.", subtheme_title: "Straipsniai", title: "Straipsnis", status: "ĮVERTINTA", score: "0.5", committee_comments: "Gerai", created_at: "2025-03-05T09:30:00Z" }),
  activity({ id: 3, employee_eid: "u10001", full_name: "Jonas Jonaitis", theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas", subtheme_id: 21, subtheme_code: "6.2.9.", subtheme_title: "Konferencijos", title: "Konferencija", status: "ATMESTA", rejection_comment: "Netinka" }),
  activity({ id: 4, employee_eid: "u10004", full_name: null, subtheme_id: 12, subtheme_code: "6.1.2.", subtheme_title: "Seminarai", title: "Seminaras", status: "PATVIRTINTA" }),
  activity({ id: 5, employee_eid: null, full_name: "Be Identifikatoriaus", title: "Be eID", status: "TIKSLINTI" }),
];

// The exact header row the page writes
const HEADER = [
  "Data", "Darbuotojas", "Temos kodas", "Temos pavadinimas", "Potemės kodas", "Potemės pavadinimas",
  "Veiklos pavadinimas", "Veiklos aprašymas", "Būsena", "Įvertinimas",
  "Atmetimo komentaras", "Vadybininko komentarai", "Komisijos nario komentarai",
];

// The table row whose cells contain `text`
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));

// The preview row's Data cell — the same lt-LT text the
// export writes into the first column
const shownDate = (title) => within(rowNamed(title)).getAllByRole("cell")[0].textContent;

// The filter block whose <label> reads `label` (the preview
// table's column headers use the same words, hence the
// selector); its only button is the dropdown trigger
const filterNamed = (label) => screen.getByText(label, { selector: "label" }).parentElement;

// Open a filter and tick one option
async function tick(user, label, option) {
  const box = filterNamed(label);
  if (!within(box).queryByRole("checkbox", { name: option })) await user.click(within(box).getByRole("button"));
  await user.click(within(box).getByRole("checkbox", { name: option }));
}

// Load the page with the fixture and wait for the preview;
// returns the user session
async function loadPage() {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/all", ACTIVITIES);
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ManagerExportPage);
  await screen.findByText("Paskaitų ciklas");
  return user;
}

// Forget the workbook calls of earlier tests
function resetXlsx() {
  XLSX.utils.aoa_to_sheet.mockClear();
  XLSX.utils.book_new.mockClear();
  XLSX.utils.book_append_sheet.mockClear();
  XLSX.writeFile.mockClear();
}







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Two GETs with the manager's header (Promise.all); the four
// filters show their placeholders and the preview lists every
// activity with the lt-LT date, "code — title" pairs, the
// status pill and the score or "(nėra)".
// -----------------------------------------------------------

test("loads activities and themes with X-Active-Role and renders the preview", async () => {
  await loadPage();

  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų eksportas" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Filtruotos veiklos" })).toBeInTheDocument();
  expect(requestLog().map((r) => [r.method, r.path])).toEqual([
    ["GET", "/api/activities/all"],
    ["GET", "/api/themes"],
  ]);
  expect(requestsTo("GET", "/api/activities/all")[0].headers).toEqual({ "x-active-role": "Vadybininkas" });
  expect(requestsTo("GET", "/api/themes")[0].headers).toEqual({ "x-active-role": "Vadybininkas" });

  expect(within(filterNamed("Darbuotojas")).getByRole("button")).toHaveTextContent("(visi darbuotojai)");
  expect(within(filterNamed("Tema")).getByRole("button")).toHaveTextContent("(visos temos)");
  expect(within(filterNamed("Potemė")).getByRole("button")).toHaveTextContent("(visos potemės)");
  expect(within(filterNamed("Būsena")).getByRole("button")).toHaveTextContent("(visos būsenos)");
  expect(screen.getByRole("button", { name: "Eksportuoti" })).toBeEnabled();

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Data", "Darbuotojas", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Įvertinimas",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(6);

  const row = rowNamed("Straipsnis");
  expect(shownDate("Straipsnis")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(within(row).getByText("Yvona Ylė")).toBeInTheDocument();
  expect(within(row).getByText("6.2. — Mokslas")).toBeInTheDocument();
  expect(within(row).getByText("6.2.10. — Straipsniai")).toBeInTheDocument();
  expect(within(row).getByText("ĮVERTINTA")).toHaveClass("status-pill", "status-pill--scored");
  expect(within(row).getByText("0.5")).toBeInTheDocument();
  expect(within(rowNamed("Paskaitų ciklas")).getByText("(nėra)")).toHaveClass("table-muted");
  expect(within(rowNamed("Be eID")).getByText("TIKSLINTI")).toHaveClass("status-pill--returned");
  expect(within(rowNamed("Seminaras")).getAllByRole("cell")[1]).toHaveTextContent("");
});







// -----------------------------------------------------------
// load error
// -----------------------------------------------------------
//
// The backend's error text is shown as sent; the preview is
// empty and the employee filter has nothing to offer.
// -----------------------------------------------------------

test("a failed load shows the backend's error verbatim and an empty preview", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/all", { status: 500, body: { error: "internal error" } });
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ManagerExportPage);

  expect(await screen.findByText("internal error")).toHaveClass("form-status");
  expect(screen.getByText("(Nėra veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  await user.click(within(filterNamed("Darbuotojas")).getByRole("button"));
  expect(within(filterNamed("Darbuotojas")).getByText("(nėra pasirinkimų)")).toBeInTheDocument();
});







// -----------------------------------------------------------
// employee options
// -----------------------------------------------------------
//
// One option per employee_eid, labelled by full name or the
// eID (as text even when the eID is a number), in Lithuanian
// order (Y sorts with I, before J); a row without an eID
// gives no option. The search box narrows the list
// case-insensitively.
// -----------------------------------------------------------

test("employee options are unique, named by full_name or eID and sorted lt-LT", async () => {
  const user = await loadPage();
  const box = filterNamed("Darbuotojas");

  await user.click(within(box).getByRole("button"));
  expect(within(box).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "Yvona Ylė", "Jonas Jonaitis", "u10004",
  ]);
  expect(within(box).queryByText("Be Identifikatoriaus")).not.toBeInTheDocument();
  expect(within(box).getAllByRole("checkbox").every((c) => !c.checked)).toBe(true);
});

test("the employee search narrows the options; no match says so", async () => {
  const user = await loadPage();
  const box = filterNamed("Darbuotojas");

  await user.click(within(box).getByRole("button"));
  const search = within(box).getByPlaceholderText("Ieškoti…");
  await user.type(search, "JON");
  expect(within(box).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual(["Jonas Jonaitis"]);

  await user.clear(search);
  await user.type(search, "zzz");
  expect(within(box).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(within(box).getByText("(nėra pasirinkimų)")).toBeInTheDocument();

  await user.clear(search);
  expect(within(box).getAllByRole("checkbox")).toHaveLength(3);
  expect(within(filterNamed("Tema")).queryByPlaceholderText("Ieškoti…")).not.toBeInTheDocument();
});

test("a numeric eID without a name labels its option as text and still filters", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/all", [...ACTIVITIES, activity({ id: 6, employee_eid: 10006, full_name: null, title: "Skaitinis eID" })]);
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ManagerExportPage);
  await screen.findByText("Skaitinis eID");
  const box = filterNamed("Darbuotojas");

  await user.click(within(box).getByRole("button"));
  expect(within(box).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "10006", "Yvona Ylė", "Jonas Jonaitis", "u10004",
  ]);

  await user.click(within(box).getByRole("checkbox", { name: "10006" }));
  expect(within(box).getByRole("button")).toHaveTextContent("10006");
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Skaitinis eID")).toBeInTheDocument();
});







// -----------------------------------------------------------
// dropdown accessibility
// -----------------------------------------------------------
//
// The trigger is a listbox popup button that announces
// whether the menu is open; the open menu is a group named
// after the filter's label; Escape from inside the menu
// closes it and puts focus back on the trigger, Escape on a
// closed dropdown does nothing, and clicks still toggle.
// -----------------------------------------------------------

test("the trigger announces its popup state, the menu is a group named after the filter, Escape closes it", async () => {
  const user = await loadPage();
  const box = filterNamed("Darbuotojas");
  const trigger = within(box).getByRole("button");

  expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(within(box).queryByRole("group")).not.toBeInTheDocument();

  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = within(box).getByRole("group", { name: "Darbuotojas" });
  expect(within(menu).getAllByRole("checkbox")).toHaveLength(3);

  await user.click(within(menu).getByPlaceholderText("Ieškoti…"));
  await user.keyboard("{Escape}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(within(box).queryByRole("group")).not.toBeInTheDocument();
  expect(within(box).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.click(within(filterNamed("Būsena")).getByRole("button"));
  expect(within(filterNamed("Būsena")).getByRole("button")).toHaveAttribute("aria-expanded", "true");
  expect(within(within(filterNamed("Būsena")).getByRole("group", { name: "Būsena" })).getAllByRole("checkbox")).toHaveLength(5);
  expect(within(filterNamed("Tema")).getByRole("button")).toHaveAttribute("aria-expanded", "false");
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// employee filter
// -----------------------------------------------------------
//
// One tick shows that label on the trigger and keeps only
// that employee's rows; two ticks read "2 pasirinkti";
// unticking restores.
// -----------------------------------------------------------

test("ticking employees filters the preview and labels the trigger", async () => {
  const user = await loadPage();

  await tick(user, "Darbuotojas", "Jonas Jonaitis");
  expect(within(filterNamed("Darbuotojas")).getByRole("button")).toHaveTextContent("Jonas Jonaitis");
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("Paskaitų ciklas")).toBeInTheDocument();
  expect(screen.getByText("Konferencija")).toBeInTheDocument();

  await tick(user, "Darbuotojas", "u10004");
  expect(within(filterNamed("Darbuotojas")).getByRole("button")).toHaveTextContent("2 pasirinkti");
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getByText("Seminaras")).toBeInTheDocument();

  await tick(user, "Darbuotojas", "Jonas Jonaitis");
  await tick(user, "Darbuotojas", "u10004");
  expect(within(filterNamed("Darbuotojas")).getByRole("button")).toHaveTextContent("(visi darbuotojai)");
  expect(screen.getAllByRole("row")).toHaveLength(6);
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// theme and subtheme filters
// -----------------------------------------------------------
//
// Subthemes list in code order (6.2.9. before 6.2.10.) across
// all themes; ticking a theme narrows them to its own and
// clears whatever subtheme was ticked.
// -----------------------------------------------------------

test("ticking a theme narrows the subtheme options and resets the subtheme filter", async () => {
  const user = await loadPage();

  await user.click(within(filterNamed("Potemė")).getByRole("button"));
  expect(within(filterNamed("Potemė")).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "6.1.1. — Paskaitos", "6.1.2. — Seminarai", "6.2.9. — Konferencijos", "6.2.10. — Straipsniai",
  ]);
  await user.click(within(filterNamed("Potemė")).getByRole("checkbox", { name: "6.1.1. — Paskaitos" }));
  expect(within(filterNamed("Potemė")).getByRole("button")).toHaveTextContent("6.1.1. — Paskaitos");
  expect(screen.getAllByRole("row")).toHaveLength(3);

  await tick(user, "Tema", "6.2. — Mokslas");
  expect(within(filterNamed("Tema")).getByRole("button")).toHaveTextContent("6.2. — Mokslas");
  expect(within(filterNamed("Potemė")).getByRole("button")).toHaveTextContent("(visos potemės)");
  expect(within(filterNamed("Potemė")).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "6.2.9. — Konferencijos", "6.2.10. — Straipsniai",
  ]);
  expect(within(filterNamed("Potemė")).getAllByRole("checkbox").every((c) => !c.checked)).toBe(true);
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("Straipsnis")).toBeInTheDocument();
  expect(screen.getByText("Konferencija")).toBeInTheDocument();
});







// -----------------------------------------------------------
// two families sharing subtheme codes
// -----------------------------------------------------------
//
// With no theme ticked, the subtheme options keep each
// theme's subthemes together, in the order the themes come
// and in code order within each, instead of setting the two
// families' equal codes side by side.
// -----------------------------------------------------------

test("the subtheme options keep each theme's subthemes together when two families share codes", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/all", []);
  onRequest("GET", "/api/themes", FAMILIES);
  const { user } = renderPage(ManagerExportPage);

  await user.click(within(filterNamed("Potemė")).getByRole("button"));
  await within(filterNamed("Potemė")).findAllByRole("checkbox");
  expect(within(filterNamed("Potemė")).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "6.1.1. — Straipsniai", "6.1.2. — Renginiai",
    "6.1.1. — Mentoriavimas", "6.1.2. — Gerosios praktikos",
  ]);
});







// -----------------------------------------------------------
// AND filtering
// -----------------------------------------------------------
//
// The status filter offers the five fixed statuses; ticks
// across filters intersect, and no match empties the preview.
// -----------------------------------------------------------

test("the filters AND together; the status filter offers the five statuses", async () => {
  const user = await loadPage();

  await user.click(within(filterNamed("Būsena")).getByRole("button"));
  expect(within(filterNamed("Būsena")).getAllByRole("checkbox").map((c) => c.parentElement.textContent)).toEqual([
    "PATEIKTA", "PATVIRTINTA", "ATMESTA", "TIKSLINTI", "ĮVERTINTA",
  ]);
  await user.click(within(filterNamed("Būsena")).getByRole("checkbox", { name: "ATMESTA" }));
  await tick(user, "Darbuotojas", "Jonas Jonaitis");
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Konferencija")).toBeInTheDocument();

  await tick(user, "Būsena", "PATEIKTA");
  expect(within(filterNamed("Būsena")).getByRole("button")).toHaveTextContent("2 pasirinkti");
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("Paskaitų ciklas")).toBeInTheDocument();

  await tick(user, "Tema", "6.1. — Studijų kokybė");
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("Paskaitų ciklas")).toBeInTheDocument();

  await tick(user, "Potemė", "6.1.2. — Seminarai");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("(Nėra veiklų.)")).toBeInTheDocument();
});







// -----------------------------------------------------------
// export
// -----------------------------------------------------------
//
// "Eksportuoti" hands [header, ...rows] to aoa_to_sheet —
// thirteen columns, "" for what is missing, the score as a
// number, the same lt-LT date as the preview — appends the
// sheet as "Veiklos" to a new workbook and writes a
// timestamped file; a filtered preview exports only its rows.
// -----------------------------------------------------------

test("Eksportuoti builds the sheet from the exact header and every row", async () => {
  resetXlsx();
  const user = await loadPage();

  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledTimes(1);
  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
    HEADER,
    [shownDate("Paskaitų ciklas"), "Jonas Jonaitis", "6.1.", "Studijų kokybė", "6.1.1.", "Paskaitos", "Paskaitų ciklas", "Dešimt paskaitų", "PATEIKTA", "", "", "Tinka", ""],
    [shownDate("Straipsnis"), "Yvona Ylė", "6.2.", "Mokslas", "6.2.10.", "Straipsniai", "Straipsnis", "", "ĮVERTINTA", 0.5, "", "", "Gerai"],
    [shownDate("Konferencija"), "Jonas Jonaitis", "6.2.", "Mokslas", "6.2.9.", "Konferencijos", "Konferencija", "", "ATMESTA", "", "Netinka", "", ""],
    [shownDate("Seminaras"), "", "6.1.", "Studijų kokybė", "6.1.2.", "Seminarai", "Seminaras", "", "PATVIRTINTA", "", "", "", ""],
    [shownDate("Be eID"), "Be Identifikatoriaus", "6.1.", "Studijų kokybė", "6.1.1.", "Paskaitos", "Be eID", "", "TIKSLINTI", "", "", "", ""],
  ]);
  expect(XLSX.utils.aoa_to_sheet.mock.calls[0][0][0]).toHaveLength(13);

  const workbook = XLSX.utils.book_new.mock.results[0].value;
  const worksheet = XLSX.utils.aoa_to_sheet.mock.results[0].value;
  expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(workbook, worksheet, "Veiklos");
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  expect(XLSX.writeFile.mock.calls[0][0]).toBe(workbook);
  expect(XLSX.writeFile.mock.calls[0][1]).toMatch(/^veiklos-eksportas-vadybininkas-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.xlsx$/);
  expect(screen.queryByText("Nėra veiklų eksportui.")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});

test("a filtered preview exports only its rows", async () => {
  resetXlsx();
  const user = await loadPage();

  await tick(user, "Būsena", "ĮVERTINTA");
  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(XLSX.utils.aoa_to_sheet).toHaveBeenCalledWith([
    HEADER,
    [shownDate("Straipsnis"), "Yvona Ylė", "6.2.", "Mokslas", "6.2.10.", "Straipsniai", "Straipsnis", "", "ĮVERTINTA", 0.5, "", "", "Gerai"],
  ]);
  expect(XLSX.utils.book_append_sheet).toHaveBeenCalledTimes(1);
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
});







// -----------------------------------------------------------
// a text longer than a cell holds
// -----------------------------------------------------------
//
// An XLSX cell holds at most 32,767 characters and SheetJS
// refuses to write a workbook with a longer text, while the
// backend accepts descriptions and comments far longer than
// that. The page cuts every such text to fit, ending it in
// "…", so "Eksportuoti" still yields a file instead of an
// uncaught error and no word to the manager. The mocked
// writeFile refuses the way the real one does, and the first
// test takes any escaping error so it cannot fail the run on
// its own.
// -----------------------------------------------------------

test("a text longer than a cell holds still exports, cut to fit, or the page says why it cannot", async () => {
  resetXlsx();
  const limit = 32767;

  // The real SheetJS's refusal, raised when the rows the
  // sheet was built from hold a longer text
  XLSX.writeFile.mockImplementation(() => {
    const cells = XLSX.utils.aoa_to_sheet.mock.lastCall[0].flat();
    if (cells.some((c) => typeof c === "string" && c.length > limit)) throw new Error("Text length must not exceed 32767 characters");
  });

  // An error escaping the click handler reaches the window;
  // kept here instead of surfacing as an unhandled one
  const uncaught = [];
  const takeError = (e) => {
    e.preventDefault();
    uncaught.push(e.error?.message);
  };
  window.addEventListener("error", takeError);

  try {
    signInAs("Vadybininkas");
    onRequest("GET", "/api/activities/all", [{ ...ACTIVITIES[0], description: "a".repeat(40000) }]);
    onRequest("GET", "/api/themes", THEMES);
    const { user } = renderPage(ManagerExportPage);
    await screen.findByText("Paskaitų ciklas");

    await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

    // What the manager got: a file whose text cells fit, a
    // message, or nothing but the error
    const cells = XLSX.utils.aoa_to_sheet.mock.lastCall?.[0].flat() ?? [];
    const wrote = XLSX.writeFile.mock.results.some((r) => r.type === "return") && cells.every((c) => typeof c !== "string" || c.length <= limit);
    const told = Boolean(document.querySelector(".form-status")?.textContent) || window.alert.mock.calls.length > 0;
    const outcome = wrote ? "a file" : told ? "a message" : `nothing (${uncaught.join("; ") || "no error"})`;
    expect(["a file", "a message"]).toContain(outcome);
  } finally {
    window.removeEventListener("error", takeError);
    XLSX.writeFile.mockReset();
  }
});

test("a long description and a long comment reach the sheet cut to the 32,767 characters a cell holds", async () => {
  resetXlsx();
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/all", [{ ...ACTIVITIES[0], description: "a".repeat(40000), committee_comments: "k".repeat(32768) }]);
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ManagerExportPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  const [header, row] = XLSX.utils.aoa_to_sheet.mock.calls[0][0];
  expect(header).toEqual(HEADER);
  expect(row[7]).toBe(`${"a".repeat(32766)}…`);
  expect(row[12]).toBe(`${"k".repeat(32766)}…`);
  expect(row.slice(1, 7)).toEqual(["Jonas Jonaitis", "6.1.", "Studijų kokybė", "6.1.1.", "Paskaitos", "Paskaitų ciklas"]);
  expect(row[11]).toBe("Tinka");
  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
});







// -----------------------------------------------------------
// the file name in local time
// -----------------------------------------------------------
//
// The cells carry the manager's local time, and so does the
// file name's stamp: UTC would run two or three hours behind
// in Vilnius and name an export made soon after midnight
// after the day before. The test container runs in UTC, so
// the test moves the runner's zone to Vilnius and fixes the
// clock just after midnight, then puts both back.
// -----------------------------------------------------------

test("the file name is stamped with the local date and time, as the cells are", async () => {
  resetXlsx();
  const user = await loadPage();
  const runnerZone = process.env.TZ;

  // Half past midnight in Vilnius, the day before in UTC
  process.env.TZ = "Europe/Vilnius";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T21:30:00Z"));

  try {
    await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

    expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
    expect(XLSX.writeFile.mock.calls[0][1]).toBe("veiklos-eksportas-vadybininkas-2026-10-25-00-30-00.xlsx");
  } finally {
    vi.useRealTimers();
    if (runnerZone === undefined) delete process.env.TZ;
    else process.env.TZ = runnerZone;
  }
});







// -----------------------------------------------------------
// nothing to export
// -----------------------------------------------------------
//
// An empty selection is refused with "Nėra veiklų
// eksportui." and no workbook is built.
// -----------------------------------------------------------

test("an empty selection is refused with a message and no workbook", async () => {
  resetXlsx();
  const user = await loadPage();

  await tick(user, "Darbuotojas", "u10004");
  await tick(user, "Būsena", "ATMESTA");
  expect(screen.getByText("(Nėra veiklų.)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(screen.getByText("Nėra veiklų eksportui.")).toHaveClass("form-status");
  expect(XLSX.utils.aoa_to_sheet).not.toHaveBeenCalled();
  expect(XLSX.utils.book_new).not.toHaveBeenCalled();
  expect(XLSX.utils.book_append_sheet).not.toHaveBeenCalled();
  expect(XLSX.writeFile).not.toHaveBeenCalled();
});







// -----------------------------------------------------------
// a successful export clears the refusal
// -----------------------------------------------------------
//
// "Nėra veiklų eksportui." is set when the selection is
// empty. Once the filters change and the next export writes
// its file, the refusal leaves the status line, so it does
// not read as if that export had been refused too.
// -----------------------------------------------------------

test("a successful export clears an earlier \"Nėra veiklų eksportui.\"", async () => {
  resetXlsx();
  const user = await loadPage();

  await tick(user, "Darbuotojas", "u10004");
  await tick(user, "Būsena", "ATMESTA");
  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));
  expect(screen.getByText("Nėra veiklų eksportui.")).toBeInTheDocument();

  await tick(user, "Būsena", "ATMESTA");
  await user.click(screen.getByRole("button", { name: "Eksportuoti" }));

  expect(XLSX.writeFile).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Nėra veiklų eksportui.")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// unexpected body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of the array — the
// activities' or the theme tree's, in turn — is refused with
// one message in the status line: the heading and the filters
// stay, the preview is empty, nothing blanks.
// -----------------------------------------------------------

test("a 200 whose body is not an array, for either list, shows one message and keeps the page", async () => {
  signInAs("Vadybininkas");
  // Which list answers with the object; the other is fine.
  // Wrong shapes on purpose, so neither entry is guarded
  let broken = "activities";
  onRequest("GET", "/api/activities/all", () => (broken === "activities" ? { status: 200, body: { ok: true } } : ACTIVITIES), { offContract: true });
  onRequest("GET", "/api/themes", () => (broken === "themes" ? { status: 200, body: { ok: true } } : THEMES), { offContract: true });
  const first = renderPage(ManagerExportPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų eksportas" })).toBeInTheDocument();
  expect(screen.getByText("(Nėra veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(within(filterNamed("Tema")).getByRole("button")).toHaveTextContent("(visos temos)");
  expect(requestLog()).toHaveLength(2);

  first.unmount();
  broken = "themes";
  renderPage(ManagerExportPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų eksportas" })).toBeInTheDocument();
  expect(screen.getByText("(Nėra veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Paskaitų ciklas")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(4);
});







// -----------------------------------------------------------
// accessible names
// -----------------------------------------------------------
//
// The employee filter's search box has a placeholder only,
// so it carries a name of its own.
// -----------------------------------------------------------

test("the employee filter's search box is named", async () => {
  const user = await loadPage();
  await user.click(within(filterNamed("Darbuotojas")).getByRole("button"));

  expect(within(filterNamed("Darbuotojas")).getByRole("textbox", { name: "Paieška: Darbuotojas" })).toHaveAttribute("placeholder", "Ieškoti…");
});







// -----------------------------------------------------------
// filter triggers named by their captions
// -----------------------------------------------------------
//
// Each trigger is named by its filter's caption and then by
// the summary it shows, the arrow hidden from assistive
// tech, so a screen reader names the filter before a
// placeholder or a count, and two filters with two picks
// each do not sound the same.
// -----------------------------------------------------------

test("each filter's trigger is named by its caption first", async () => {
  await loadPage();

  for (const caption of ["Darbuotojas", "Tema", "Potemė", "Būsena"]) {
    expect(within(filterNamed(caption)).getByRole("button")).toHaveAccessibleName(new RegExp(`^${caption}`));
  }
});

test("a trigger's name goes on with the summary it shows, without the arrow", async () => {
  const user = await loadPage();
  const trigger = () => within(filterNamed("Darbuotojas")).getByRole("button");
  expect(trigger()).toHaveAccessibleName("Darbuotojas (visi darbuotojai)");

  await tick(user, "Darbuotojas", "Jonas Jonaitis");
  expect(trigger()).toHaveAccessibleName("Darbuotojas Jonas Jonaitis");

  await tick(user, "Darbuotojas", "u10004");
  expect(trigger()).toHaveAccessibleName("Darbuotojas 2 pasirinkti");
  expect(within(filterNamed("Būsena")).getByRole("button")).toHaveAccessibleName("Būsena (visos būsenos)");
});
