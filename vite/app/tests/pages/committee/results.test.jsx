// -----------------------------------------------------------
//  [*] Regression — pages/committee/results.jsx
//
//  The ĮVERTINTA list against the scripted fetch: the list
//  and the theme tree load together with the committee's
//  X-Active-Role, the table shows scores ("(nėra)" for none),
//  "Peržiūrėti" opens the modal, "Pervertinti" arms the
//  theme/subtheme selects (a theme change preselects its
//  first code-ordered subtheme) and the people count, the
//  save PATCHes { action: "score", …, theme_id, subtheme_id }
//  and patches the row and the modal in place, validation
//  refuses empty and negative counts without a request, and
//  backend errors are shown as "Klaida: …".
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import ResultsPage from "@/pages/committee/results.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Three themes: two subthemes each for the first two (the
// second's listed out of code order on purpose), none for the
// third
const THEMES = [
  { id: 1, code: "6.1.", title: "Studijų kokybė", subthemes: [
    { id: 11, code: "6.1.1.", title: "Paskaitos" },
    { id: 12, code: "6.1.2.", title: "Seminarai" },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", subthemes: [
    { id: 22, code: "6.2.10.", title: "Straipsniai" },
    { id: 21, code: "6.2.9.", title: "Konferencijos" },
  ] },
  { id: 3, code: "6.3.", title: "Kita", subthemes: [] },
];

// Two evaluated activities: one scored with every optional
// field filled, one without a score or any of them
const ACT5 = {
  id: 5, full_name: "Jonas Jonaitis",
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 12, subtheme_code: "6.1.2.", subtheme_title: "Seminarai",
  title: "Seminaras apie X", description: "Trys seminarai studentams",
  status: "ĮVERTINTA", score: 0.5, committee_comments: "Gerai", manager_comments: "Tinka",
  attachment_path: "uploads/5.pdf", attachment_original_name: "ataskaita.pdf",
  created_at: "2025-03-04T12:00:00Z",
};
const ACT6 = {
  id: 6, full_name: "Rasa Šukienė",
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos",
  title: "Paskaitų ciklas", description: null,
  status: "ĮVERTINTA", score: null, committee_comments: null, manager_comments: null,
  attachment_path: null, attachment_original_name: null,
  created_at: "2025-03-05T09:30:00Z",
};
const EVALUATED = [ACT5, ACT6];

// An activity reply must be wrapped: the row's own `status`
// ("ĮVERTINTA") would otherwise be read as the HTTP status
const ok = (body) => ({ status: 200, body });

// The table row whose cells contain `text`
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));

// The open modal (its h3 sits directly inside it)
const modal = () => screen.getByRole("heading", { level: 3, name: "Įvertintos veiklos rezultatas" }).parentElement;

// The modal field whose label reads `label`; while its
// AppSelect is closed the field's only button is the trigger
const fieldNamed = (label) => within(modal()).getByText(label, { selector: ".employee-modal-label" }).parentElement;

// Open the field's AppSelect and click the option `option`
async function pick(user, label, option) {
  await user.click(within(fieldNamed(label)).getByRole("button"));
  await user.click(within(fieldNamed(label)).getByRole("button", { name: option }));
}

// Load the page, open one row's modal and arm re-scoring;
// returns the user session
async function openRescoring(activity) {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", EVALUATED);
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ResultsPage);
  await screen.findByText(activity.title);
  await user.click(within(rowNamed(activity.title)).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "Pervertinti" }));
  return user;
}







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Two GETs with the header (Promise.all); a row per activity
// with the scored pill, the score or "(nėra)", and a
// "Peržiūrėti" button.
// -----------------------------------------------------------

test("loads the list and the themes with X-Active-Role and renders scores", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", EVALUATED);
  onRequest("GET", "/api/themes", THEMES);
  renderPage(ResultsPage);

  expect(screen.getByRole("heading", { name: "Įvertinimai" })).toBeInTheDocument();
  expect(await screen.findByText("Seminaras apie X")).toBeInTheDocument();
  expect(requestLog().map((r) => [r.method, r.path])).toEqual([
    ["GET", "/api/activities/evaluated"],
    ["GET", "/api/themes"],
  ]);
  expect(requestsTo("GET", "/api/activities/evaluated")[0].headers).toEqual({ "x-active-role": "Komisijos narys" });
  expect(requestsTo("GET", "/api/themes")[0].headers).toEqual({ "x-active-role": "Komisijos narys" });

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Darbuotojas", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Įvertinimas", "Veiksmai",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(3);

  const scored = rowNamed("Seminaras apie X");
  expect(within(scored).getByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(within(scored).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(scored).getByText("6.1.2. — Seminarai")).toBeInTheDocument();
  expect(within(scored).getByText("ĮVERTINTA")).toHaveClass("status-pill", "status-pill--scored");
  expect(within(scored).getByText("0.5")).toBeInTheDocument();
  expect(within(scored).getByRole("button", { name: "Peržiūrėti" })).toBeInTheDocument();
  expect(within(rowNamed("Paskaitų ciklas")).getByText("(nėra)")).toHaveClass("table-muted");
});







// -----------------------------------------------------------
// empty
// -----------------------------------------------------------
//
// No evaluated activities → the muted empty line, no table.
// -----------------------------------------------------------

test("an empty list shows the empty state and no table", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", []);
  onRequest("GET", "/api/themes", THEMES);
  renderPage(ResultsPage);

  expect(await screen.findByText("(Šiuo metu nėra įvertintų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// load error
// -----------------------------------------------------------
//
// The backend's error text is shown as sent (no prefix).
// -----------------------------------------------------------

test("a failed load shows the backend's error verbatim", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", { status: 500, body: { error: "internal error" } });
  onRequest("GET", "/api/themes", THEMES);
  renderPage(ResultsPage);

  expect(await screen.findByText("internal error")).toHaveClass("form-status--error");
  expect(screen.getByText("(Šiuo metu nėra įvertintų veiklų.)")).toBeInTheDocument();
});







// -----------------------------------------------------------
// modal
// -----------------------------------------------------------
//
// "Peržiūrėti" opens the read-only review: theme pair as
// text, details, attachment button, comments box read-only
// with the saved comment, the score; placeholders for a bare
// row; "Uždaryti" closes it.
// -----------------------------------------------------------

test("Peržiūrėti opens the read-only modal; placeholders for missing fields; Uždaryti closes", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", EVALUATED);
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(ResultsPage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal();
  expect(within(m).getByText("Jonas Jonaitis", { selector: "strong" })).toBeInTheDocument();
  expect(m).toHaveTextContent(/Sukurta: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  expect(within(m).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(m).getByText("6.1.2. — Seminarai")).toBeInTheDocument();
  expect(within(m).getByText("Seminaras apie X")).toBeInTheDocument();
  expect(within(m).getByText("Trys seminarai studentams")).toBeInTheDocument();
  expect(within(m).getByText("ĮVERTINTA")).toHaveClass("status-pill--scored");
  expect(within(m).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled();
  expect(within(m).getByText("Tinka")).toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox")).toHaveValue("Gerai");
  expect(within(m).getByText("0.5")).toBeInTheDocument();
  expect(within(m).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Uždaryti" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Pervertinti" })).toBeInTheDocument();

  await user.click(within(m).getByRole("button", { name: "Uždaryti" }));
  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const bare = modal();
  expect(within(bare).getByText("(nenurodyta)")).toBeInTheDocument();
  expect(within(bare).getByText("(nėra priedo)")).toBeInTheDocument();
  expect(within(bare).getAllByText("(nėra)")).toHaveLength(2);
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// re-scoring mode
// -----------------------------------------------------------
//
// "Pervertinti" swaps the theme pair for two AppSelects
// seeded with the row's ids, unlocks the comments and adds
// the people count; the read-only score previews 1/n.
// -----------------------------------------------------------

test("Pervertinti arms re-scoring: seeded selects, writable comments, score = 1/n preview", async () => {
  const user = await openRescoring(ACT5);
  const m = modal();

  expect(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" })).toBeEnabled();
  expect(within(fieldNamed("Tema")).getByRole("button")).toHaveTextContent("6.1. — Studijų kokybė");
  expect(within(fieldNamed("Potemė")).getByRole("button")).toHaveTextContent("6.1.2. — Seminarai");
  expect(within(m).getByRole("textbox")).not.toHaveAttribute("readonly");
  expect(within(m).getAllByText("Veiklos vykdytojų kiekis")).toHaveLength(1);

  const [people, score] = within(m).getAllByRole("spinbutton");
  expect(people).toHaveValue(null);
  expect(score).toHaveAttribute("readonly");
  expect(score).toHaveValue(0.5);

  await user.type(people, "3");
  expect(score).toHaveValue(0.33);
  await user.clear(people);
  await user.type(people, "0");
  expect(score).toHaveValue(0);
  await user.clear(people);
  await user.type(people, "1");
  expect(score).toHaveValue(1);

  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// theme change
// -----------------------------------------------------------
//
// Picking another theme preselects its first subtheme in
// code order (6.2.9. before 6.2.10., whatever the tree's
// order) and lists them sorted; a subtheme can then be picked
// on its own. A theme without subthemes shows "(potemių
// nėra)".
// -----------------------------------------------------------

test("changing the theme preselects the first code-ordered subtheme; a subtheme can be picked", async () => {
  const user = await openRescoring(ACT5);

  await pick(user, "Tema", "6.2. — Mokslas");
  expect(within(fieldNamed("Tema")).getByRole("button")).toHaveTextContent("6.2. — Mokslas");
  expect(within(fieldNamed("Potemė")).getByRole("button")).toHaveTextContent("6.2.9. — Konferencijos");

  await user.click(within(fieldNamed("Potemė")).getByRole("button"));
  expect(within(fieldNamed("Potemė")).getAllByRole("button").slice(1).map((b) => b.textContent)).toEqual([
    "6.2.9. — Konferencijos", "6.2.10. — Straipsniai",
  ]);
  await user.click(within(fieldNamed("Potemė")).getByRole("button", { name: "6.2.10. — Straipsniai" }));
  expect(within(fieldNamed("Potemė")).getByRole("button")).toHaveTextContent("6.2.10. — Straipsniai");

  await pick(user, "Tema", "6.3. — Kita");
  expect(within(fieldNamed("Potemė")).getByText("(potemių nėra)")).toBeInTheDocument();
  expect(within(fieldNamed("Potemė")).queryByRole("button")).not.toBeInTheDocument();

  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// validation
// -----------------------------------------------------------
//
// An empty count is refused with the shipped truncated line
// (the same words as the field's label), a negative one with
// the full sentence; no PATCH leaves the page.
// -----------------------------------------------------------

test("empty and negative people counts are refused without a request", async () => {
  const user = await openRescoring(ACT5);
  const m = modal();

  await user.click(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" }));
  await waitFor(() => expect(screen.getAllByText("Veiklos vykdytojų kiekis")).toHaveLength(2));
  expect(screen.getAllByText("Veiklos vykdytojų kiekis").some((el) => el.classList.contains("form-status--error"))).toBe(true);

  const [people] = within(m).getAllByRole("spinbutton");
  await user.type(people, "-2");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" }));
  expect(await screen.findByText("Veiklos vykdytojų kiekis turi būti 0 arba teigiamas skaičius.")).toHaveClass("form-status--error");

  expect(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" })).toBeEnabled();
  expect(requestLog().filter((r) => r.method === "PATCH")).toEqual([]);
});







// -----------------------------------------------------------
// save
// -----------------------------------------------------------
//
// "Išsaugoti įvertinimą" PATCHes { action: "score", score,
// committee_comments, theme_id, subtheme_id } as numbers with
// both headers; the reply replaces the row and the modal,
// which drops back to view mode still open; a theme without
// subthemes sends subtheme_id null.
// -----------------------------------------------------------

test("saving a re-score: PATCH body with theme ids, row and modal patched in place, message", async () => {
  const saved = {
    ...ACT5,
    theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas",
    subtheme_id: 22, subtheme_code: "6.2.10.", subtheme_title: "Straipsniai",
    score: 0.5, committee_comments: "Labai gerai",
  };
  onRequest("PATCH", "/api/activities/5/committee", ok(saved));
  const user = await openRescoring(ACT5);

  await pick(user, "Tema", "6.2. — Mokslas");
  await pick(user, "Potemė", "6.2.10. — Straipsniai");
  await user.clear(within(modal()).getByRole("textbox"));
  await user.type(within(modal()).getByRole("textbox"), "Labai gerai");
  await user.type(within(modal()).getAllByRole("spinbutton")[0], "2");
  await user.click(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Įvertinimas atnaujintas.")).toBeInTheDocument();
  const [patch] = requestsTo("PATCH", "/api/activities/5/committee");
  expect(patch.headers).toEqual({ "x-active-role": "Komisijos narys", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "score", score: 0.5, committee_comments: "Labai gerai", theme_id: 2, subtheme_id: 22 });
  expect(requestLog()).toHaveLength(3);

  const m = modal();
  expect(within(m).getByRole("button", { name: "Pervertinti" })).toBeEnabled();
  expect(within(m).getByText("6.2. — Mokslas")).toBeInTheDocument();
  expect(within(m).getByText("6.2.10. — Straipsniai")).toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox")).toHaveValue("Labai gerai");
  expect(within(m).queryByRole("spinbutton")).not.toBeInTheDocument();

  expect(screen.getAllByRole("row")).toHaveLength(3);
  const row = rowNamed("Seminaras apie X");
  expect(within(row).getByText("6.2. — Mokslas")).toBeInTheDocument();
  expect(within(row).getByText("6.2.10. — Straipsniai")).toBeInTheDocument();
  expect(within(row).getByText("0.5")).toBeInTheDocument();
});

test("a theme without subthemes saves subtheme_id null", async () => {
  onRequest("PATCH", "/api/activities/5/committee", ok({
    ...ACT5, theme_id: 3, theme_code: "6.3.", theme_title: "Kita",
    subtheme_id: null, subtheme_code: null, subtheme_title: null, score: 1,
  }));
  const user = await openRescoring(ACT5);

  await pick(user, "Tema", "6.3. — Kita");
  await user.type(within(modal()).getAllByRole("spinbutton")[0], "1");
  await user.click(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Įvertinimas atnaujintas.")).toBeInTheDocument();
  expect(requestsTo("PATCH", "/api/activities/5/committee")[0].body).toEqual({
    action: "score", score: 1, committee_comments: "Gerai", theme_id: 3, subtheme_id: null,
  });
  expect(within(modal()).getByText("6.3. — Kita")).toBeInTheDocument();
  expect(within(rowNamed("Seminaras apie X")).getByText("1")).toBeInTheDocument();
});







// -----------------------------------------------------------
// errors
// -----------------------------------------------------------
//
// A refused PATCH shows "Klaida: " + the backend's reason and
// leaves the modal in re-scoring mode with the row untouched.
// -----------------------------------------------------------

test("a refused re-score shows Klaida: and keeps the modal in re-scoring mode", async () => {
  onRequest("PATCH", "/api/activities/5/committee", { status: 400, body: { error: "Neteisingas įvertinimas" } });
  const user = await openRescoring(ACT5);

  await user.type(within(modal()).getAllByRole("spinbutton")[0], "3");
  await user.click(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Klaida: Neteisingas įvertinimas")).toHaveClass("form-status--error");
  await waitFor(() => expect(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" })).toBeEnabled());
  expect(within(modal()).getAllByRole("spinbutton")[0]).toHaveValue(3);
  expect(within(fieldNamed("Tema")).getByRole("button")).toHaveTextContent("6.1. — Studijų kokybė");
  expect(within(rowNamed("Seminaras apie X")).getByText("0.5")).toBeInTheDocument();
  expect(screen.queryByText("Įvertinimas atnaujintas.")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// attachment
// -----------------------------------------------------------
//
// The attachment button GETs /api/activities/:id/attachment
// with the header only; the file comes back as a text body
// (jsdom's Blob cannot feed a Response) and jsdom has no
// object URLs, so the blob URL pair and the anchor click are
// stubbed. A refused download is reported with the "Klaida: "
// prefix, and opening a row clears the line.
// -----------------------------------------------------------

test("the attachment button fetches the file with X-Active-Role", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", EVALUATED);
  onRequest("GET", "/api/themes", THEMES);
  onRequest("GET", "/api/activities/5/attachment", "%PDF-1.4");
  window.URL.createObjectURL = vi.fn(() => "blob:test");
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { user } = renderPage(ResultsPage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "ataskaita.pdf" }));

  await waitFor(() => expect(within(modal()).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
  const [get] = requestsTo("GET", "/api/activities/5/attachment");
  expect(get.headers).toEqual({ "x-active-role": "Komisijos narys" });
  expect(get.body).toBeNull();
  expect(requestLog()).toHaveLength(3);
  expect(screen.queryByText(/Nepavyko atsisiųsti priedo/)).not.toBeInTheDocument();
});

test("a refused download is reported with the Klaida: prefix; opening a row clears it", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/evaluated", EVALUATED);
  onRequest("GET", "/api/themes", THEMES);
  onRequest("GET", "/api/activities/5/attachment", { status: 404, body: { error: "Priedas nerastas" } });
  const { user } = renderPage(ResultsPage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "ataskaita.pdf" }));

  expect(await screen.findByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).toHaveClass("form-status--error");
  await waitFor(() => expect(within(modal()).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
  expect(requestsTo("GET", "/api/activities/5/attachment")).toHaveLength(1);

  await user.click(within(modal()).getByRole("button", { name: "Uždaryti" }));
  expect(screen.getByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).toBeInTheDocument();
  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  expect(screen.queryByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// non-array body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of a list — the
// activities or the themes, each in turn — is refused before
// it reaches state: the page keeps its h1 and the empty
// state, shows "Klaida: netikėtas serverio atsakymas." once
// and renders no rows instead of blanking.
// -----------------------------------------------------------

test("a 200 whose body is not a list — either list — is refused with one message, not a blank page", async () => {
  signInAs("Komisijos narys");
  // `bad` names the list that answers { ok: true } this mount;
  // the other one is intact
  let bad = "";
  const listOr = (path, list) => () => (bad === path ? { status: 200, body: { ok: true } } : list);
  onRequest("GET", "/api/activities/evaluated", listOr("/api/activities/evaluated", EVALUATED));
  onRequest("GET", "/api/themes", listOr("/api/themes", THEMES));

  for (const path of ["/api/activities/evaluated", "/api/themes"]) {
    bad = path;
    const { unmount } = renderPage(ResultsPage);
    expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status--error");
    expect(screen.getByRole("heading", { level: 1, name: "Įvertinimai" })).toBeInTheDocument();
    expect(screen.getByText("(Šiuo metu nėra įvertintų veiklų.)")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    unmount();
  }
  expect(requestLog()).toHaveLength(4);
});
