// -----------------------------------------------------------
//  [*] Regression — pages/manager/export.jsx
//
//  The manager's export page against the scripted fetch and a
//  mocked xlsx: activities and the theme tree load together
//  with the manager's X-Active-Role, the preview table renders
//  every activity, the employee filter lists each employee
//  once (name or eID — a numeric one too — Lithuanian order,
//  no eID → skipped) with a search box, each dropdown
//  announces its popup state and closes on Escape, the theme
//  filter narrows and resets the subtheme filter, the four
//  filters AND together, the export hands the exact header
//  and rows to aoa_to_sheet, appends "Veiklos" and writes a
//  timestamped file, and an empty selection refuses with
//  "Nėra veiklų eksportui.".
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
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
  { id: 1, code: "6.1.", title: "Studijų kokybė", subthemes: [
    { id: 11, code: "6.1.1.", title: "Paskaitos" },
    { id: 12, code: "6.1.2.", title: "Seminarai" },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", subthemes: [
    { id: 22, code: "6.2.10.", title: "Straipsniai" },
    { id: 21, code: "6.2.9.", title: "Konferencijos" },
  ] },
];

// An activity with every export column present, overridable
const activity = (over) => ({
  id: 0, employee_eid: null, full_name: null,
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos",
  title: "", description: null, status: "PATEIKTA", score: null,
  rejection_comment: null, manager_comments: null, committee_comments: null,
  created_at: "2025-03-04T12:00:00Z",
  ...over,
});

// Five activities: Jonas twice (one employee option), Yvona
// (sorts before Jonas only in Lithuanian order), an employee
// without a name (labelled by eID) and a row without an eID
// (no option at all)
const ACTIVITIES = [
  activity({ id: 1, employee_eid: "u10001", full_name: "Jonas Jonaitis", title: "Paskaitų ciklas", description: "Dešimt paskaitų", manager_comments: "Tinka" }),
  activity({ id: 2, employee_eid: "u10002", full_name: "Yvona Ylė", theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas", subtheme_id: 22, subtheme_code: "6.2.10.", subtheme_title: "Straipsniai", title: "Straipsnis", status: "ĮVERTINTA", score: 0.5, committee_comments: "Gerai", created_at: "2025-03-05T09:30:00Z" }),
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
  // Which list answers with the object; the other is fine
  let broken = "activities";
  onRequest("GET", "/api/activities/all", () => (broken === "activities" ? { status: 200, body: { ok: true } } : ACTIVITIES));
  onRequest("GET", "/api/themes", () => (broken === "themes" ? { status: 200, body: { ok: true } } : THEMES));
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
