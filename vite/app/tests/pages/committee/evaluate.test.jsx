// -----------------------------------------------------------
//  [*] Regression — pages/committee/evaluate.jsx
//
//  The PATVIRTINTA queue against the scripted fetch: the
//  queue loads with the committee's X-Active-Role and renders
//  rows with status pills, the review modal shows the row's
//  read-only fields (muted placeholders for what is missing),
//  "Grąžinti vadybininkei" confirms and PATCHes { action:
//  "return" }, scoring derives 1/n from the people count,
//  refuses an empty or negative count without a request,
//  PATCHes { action: "score", … } and closes the modal only
//  when the status left PATVIRTINTA, backend errors — a
//  refused download included — are shown as "Klaida: …", the
//  attachment travels through fetch with the header, and the
//  modal's comments box and people count answer to their
//  labels.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import EvaluatePage from "@/pages/committee/evaluate.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Two approved activities: one with every optional field
// filled (description, attachment, manager comments), one
// with none of them
const ACT1 = {
  id: 1, full_name: "Jonas Jonaitis",
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 12, subtheme_code: "6.1.2.", subtheme_title: "Seminarai",
  title: "Seminaras apie X", description: "Trys seminarai studentams",
  status: "PATVIRTINTA", score: null, committee_comments: null, manager_comments: "Tinka",
  attachment_path: "uploads/1.pdf", attachment_original_name: "ataskaita.pdf",
  created_at: "2025-03-04T12:00:00Z",
};
const ACT2 = {
  id: 2, full_name: "Rasa Šukienė",
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos",
  title: "Paskaitų ciklas", description: null,
  status: "PATVIRTINTA", score: null, committee_comments: null, manager_comments: null,
  attachment_path: null, attachment_original_name: null,
  created_at: "2025-03-05T09:30:00Z",
};
const QUEUE = [ACT1, ACT2];

// An activity reply must be wrapped: the row's own `status`
// ("PATVIRTINTA") would otherwise be read as the HTTP status
const ok = (body) => ({ status: 200, body });

// The table row whose cells contain `text`
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));

// The open review modal (its h3 sits directly inside it)
const modal = () => screen.getByRole("heading", { level: 3, name: "Veiklų įvertinimas" }).parentElement;

// Load the queue, open one row's modal and arm scoring mode;
// returns the user session
async function openScoring(activity) {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  const { user } = renderPage(EvaluatePage);
  await screen.findByText(activity.title);
  await user.click(within(rowNamed(activity.title)).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "Įvertinti" }));
  return user;
}







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// "Kraunama…" while the one GET is in flight, then a row per
// activity: name, "code — title" pairs, the approved pill and
// both action buttons.
// -----------------------------------------------------------

test("loads the queue with X-Active-Role and renders rows, pills and actions", async () => {
  signInAs("Komisijos narys");
  let release;
  onRequest("GET", "/api/activities/committee", () => new Promise((r) => { release = r; }));
  renderPage(EvaluatePage);

  expect(screen.getByRole("heading", { name: "Įvertinti veiklas" })).toBeInTheDocument();
  expect(screen.getByText("Kraunama…")).toBeInTheDocument();
  release(QUEUE);

  expect(await screen.findByText("Seminaras apie X")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
  expect(requestsTo("GET", "/api/activities/committee")[0].headers).toEqual({ "x-active-role": "Komisijos narys" });

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Darbuotojas", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Veiksmai",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(3);

  const row = rowNamed("Seminaras apie X");
  expect(within(row).getByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(within(row).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(row).getByText("6.1.2. — Seminarai")).toBeInTheDocument();
  expect(within(row).getByText("PATVIRTINTA")).toHaveClass("status-pill", "status-pill--approved");
  expect(within(row).getByRole("button", { name: "Peržiūrėti" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Grąžinti vadybininkei" })).toBeEnabled();
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// empty
// -----------------------------------------------------------
//
// An empty queue shows the muted empty line and no table.
// -----------------------------------------------------------

test("an empty queue shows the empty state and no table", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", []);
  renderPage(EvaluatePage);

  expect(await screen.findByText("(Šiuo metu nėra patvirtintų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// load error
// -----------------------------------------------------------
//
// The backend's error text is shown as sent (no prefix) above
// the empty state.
// -----------------------------------------------------------

test("a failed load shows the backend's error verbatim", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", { status: 500, body: { error: "internal error" } });
  renderPage(EvaluatePage);

  expect(await screen.findByText("internal error")).toHaveClass("form-status--error");
  expect(screen.getByText("(Šiuo metu nėra patvirtintų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// modal
// -----------------------------------------------------------
//
// "Peržiūrėti" opens the read-only review: meta line, the
// theme pair, description, pill, attachment button, manager
// comments, a read-only comments box (found by its label)
// and "(nėra)" for the missing score; the placeholders for a
// bare row; "Uždaryti" closes it.
// -----------------------------------------------------------

test("Peržiūrėti opens the read-only modal; placeholders for missing fields; Uždaryti closes", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal();
  expect(within(m).getByText("Jonas Jonaitis", { selector: "strong" })).toBeInTheDocument();
  expect(m).toHaveTextContent(/Sukurta: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  expect(within(m).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(m).getByText("6.1.2. — Seminarai")).toBeInTheDocument();
  expect(within(m).getByText("Seminaras apie X")).toBeInTheDocument();
  expect(within(m).getByText("Trys seminarai studentams")).toBeInTheDocument();
  expect(within(m).getByText("PATVIRTINTA")).toHaveClass("status-pill--approved");
  expect(within(m).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled();
  expect(within(m).getByText("Tinka")).toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox")).toHaveValue("");
  expect(within(m).getByLabelText("Komisijos nario komentarai")).toBe(within(m).getByRole("textbox"));
  expect(within(m).getAllByText("(nėra)")).toHaveLength(1);
  expect(within(m).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Uždaryti" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Įvertinti" })).toBeInTheDocument();

  await user.click(within(m).getByRole("button", { name: "Uždaryti" }));
  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const bare = modal();
  expect(within(bare).getByText("(nenurodyta)")).toBeInTheDocument();
  expect(within(bare).getByText("(nėra priedo)")).toBeInTheDocument();
  expect(within(bare).getAllByText("(nėra)")).toHaveLength(2);
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// return
// -----------------------------------------------------------
//
// "Grąžinti vadybininkei" asks for confirmation, PATCHes
// { action: "return" } with both headers, shows "Grąžinama…"
// disabled while in flight, and drops the row once the reply
// leaves PATVIRTINTA.
// -----------------------------------------------------------

test("returning a row: confirm, PATCH { action: \"return\" }, in-flight label, row removed", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  let release;
  onRequest("PATCH", "/api/activities/1/committee", () => new Promise((r) => { release = r; }));
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Grąžinti vadybininkei" }));
  expect(window.confirm).toHaveBeenCalledWith("Grąžinti veiklą vadybininkei?");
  const busy = await screen.findByRole("button", { name: "Grąžinama…" });
  expect(busy).toBeDisabled();
  expect(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Grąžinti vadybininkei" })).toBeEnabled();

  release(ok({ ...ACT1, status: "PATEIKTA" }));
  await waitFor(() => expect(screen.queryByText("Seminaras apie X")).not.toBeInTheDocument());
  expect(screen.getByText("Paskaitų ciklas")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(2);

  const [patch] = requestsTo("PATCH", "/api/activities/1/committee");
  expect(patch.headers).toEqual({ "x-active-role": "Komisijos narys", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "return" });
  expect(requestLog()).toHaveLength(2);
});

test("a cancelled confirm sends nothing and keeps the row", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Grąžinti vadybininkei" }));

  expect(window.confirm).toHaveBeenCalledWith("Grąžinti veiklą vadybininkei?");
  expect(requestLog()).toHaveLength(1);
  expect(screen.getByText("Seminaras apie X")).toBeInTheDocument();
  expect(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Grąžinti vadybininkei" })).toBeEnabled();
});







// -----------------------------------------------------------
// scoring mode
// -----------------------------------------------------------
//
// "Įvertinti" unlocks the comments box and adds the people
// count (found by its label); the read-only score previews
// 1/n to two decimals (0 people → 0) without any request.
// -----------------------------------------------------------

test("Įvertinti arms scoring: writable comments, people count, score = 1/n preview", async () => {
  const user = await openScoring(ACT1);
  const m = modal();

  expect(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" })).toBeEnabled();
  expect(within(m).queryByRole("button", { name: "Įvertinti" })).not.toBeInTheDocument();
  expect(within(m).getByRole("textbox")).not.toHaveAttribute("readonly");
  expect(within(m).getAllByText("Veiklos vykdytojų kiekis")).toHaveLength(1);

  const [people, score] = within(m).getAllByRole("spinbutton");
  expect(within(m).getByLabelText("Veiklos vykdytojų kiekis")).toBe(people);
  expect(people).toHaveValue(null);
  expect(score).toHaveAttribute("readonly");

  await user.type(people, "3");
  expect(score).toHaveValue(0.33);
  await user.clear(people);
  await user.type(people, "0");
  expect(score).toHaveValue(0);
  await user.clear(people);
  await user.type(people, "1");
  expect(score).toHaveValue(1);
  await user.clear(people);
  await user.type(people, "4");
  expect(score).toHaveValue(0.25);

  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// validation
// -----------------------------------------------------------
//
// An empty count is refused with "Klaida: Įveskite veiklos
// vykdytojų kiekį.", a negative one with "… turi būti 0 arba
// teigiamas skaičius."; no PATCH leaves the page.
// -----------------------------------------------------------

test("empty and negative people counts are refused without a request", async () => {
  const user = await openScoring(ACT1);
  const m = modal();

  await user.click(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" }));
  expect(await screen.findByText("Klaida: Įveskite veiklos vykdytojų kiekį.")).toHaveClass("form-status--error");

  const [people] = within(m).getAllByRole("spinbutton");
  await user.type(people, "-2");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" }));
  expect(await screen.findByText("Veiklos vykdytojų kiekis turi būti 0 arba teigiamas skaičius.")).toHaveClass("form-status--error");

  expect(modal()).toBeInTheDocument();
  expect(requestLog().filter((r) => r.method === "PATCH")).toEqual([]);
});







// -----------------------------------------------------------
// save
// -----------------------------------------------------------
//
// "Išsaugoti įvertinimą" PATCHes { action: "score", score,
// committee_comments } with both headers; a reply that left
// PATVIRTINTA drops the row, closes the modal and confirms.
// -----------------------------------------------------------

test("saving a score: PATCH body and headers, message, modal closed, row removed", async () => {
  onRequest("PATCH", "/api/activities/1/committee", ok({ ...ACT1, status: "ĮVERTINTA", score: 0.33, committee_comments: "Labai gerai" }));
  const user = await openScoring(ACT1);
  const m = modal();

  await user.clear(within(m).getByRole("textbox"));
  await user.type(within(m).getByRole("textbox"), "Labai gerai");
  await user.type(within(m).getAllByRole("spinbutton")[0], "3");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Įvertinimas išsaugotas.")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  expect(screen.queryByText("Seminaras apie X")).not.toBeInTheDocument();
  expect(screen.getByText("Paskaitų ciklas")).toBeInTheDocument();

  const [patch] = requestsTo("PATCH", "/api/activities/1/committee");
  expect(patch.headers).toEqual({ "x-active-role": "Komisijos narys", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "score", score: 0.33, committee_comments: "Labai gerai" });
  expect(requestLog()).toHaveLength(2);
});

test("a reply still PATVIRTINTA keeps the modal open and patches the row in place", async () => {
  onRequest("PATCH", "/api/activities/1/committee", ok({ ...ACT1, status: "PATVIRTINTA", score: 0.5, title: "Seminaras apie X (patikslinta)" }));
  const user = await openScoring(ACT1);

  await user.type(within(modal()).getAllByRole("spinbutton")[0], "2");
  await user.click(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Įvertinimas išsaugotas.")).toBeInTheDocument();
  const m = modal();
  expect(within(m).getByRole("button", { name: "Įvertinti" })).toBeEnabled();
  expect(within(m).getByText("0.5")).toBeInTheDocument();
  expect(within(m).getByText("Seminaras apie X (patikslinta)")).toBeInTheDocument();
  expect(within(m).queryByRole("spinbutton")).not.toBeInTheDocument();

  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(within(rowNamed("Seminaras apie X (patikslinta)")).getByText("PATVIRTINTA")).toBeInTheDocument();
  expect(requestsTo("PATCH", "/api/activities/1/committee")[0].body).toEqual({ action: "score", score: 0.5, committee_comments: "" });
});







// -----------------------------------------------------------
// errors
// -----------------------------------------------------------
//
// A refused PATCH shows "Klaida: " + the backend's reason; a
// refused score keeps the modal in scoring mode, a refused
// return keeps the row with its button re-enabled.
// -----------------------------------------------------------

test("a refused score shows Klaida: and keeps the modal in scoring mode", async () => {
  onRequest("PATCH", "/api/activities/1/committee", { status: 400, body: { error: "Neteisingas įvertinimas" } });
  const user = await openScoring(ACT1);

  await user.type(within(modal()).getAllByRole("spinbutton")[0], "3");
  await user.click(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" }));

  expect(await screen.findByText("Klaida: Neteisingas įvertinimas")).toHaveClass("form-status--error");
  await waitFor(() => expect(within(modal()).getByRole("button", { name: "Išsaugoti įvertinimą" })).toBeEnabled());
  expect(within(modal()).getAllByRole("spinbutton")[0]).toHaveValue(3);
  expect(rowNamed("Seminaras apie X")).toBeInTheDocument();
  expect(screen.queryByText("Įvertinimas išsaugotas.")).not.toBeInTheDocument();
});

test("a refused return shows Klaida: and keeps the row", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  onRequest("PATCH", "/api/activities/1/committee", { status: 409, body: { error: "Veikla jau įvertinta" } });
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Grąžinti vadybininkei" }));

  expect(await screen.findByText("Klaida: Veikla jau įvertinta")).toBeInTheDocument();
  await waitFor(() => expect(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Grąžinti vadybininkei" })).toBeEnabled());
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(requestsTo("PATCH", "/api/activities/1/committee")[0].body).toEqual({ action: "return" });
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
// prefix, like every other error on the page.
// -----------------------------------------------------------

test("the attachment button fetches the file with X-Active-Role", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  onRequest("GET", "/api/activities/1/attachment", "%PDF-1.4");
  window.URL.createObjectURL = vi.fn(() => "blob:test");
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "ataskaita.pdf" }));

  await waitFor(() => expect(within(modal()).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
  const [get] = requestsTo("GET", "/api/activities/1/attachment");
  expect(get.headers).toEqual({ "x-active-role": "Komisijos narys" });
  expect(get.body).toBeNull();
  expect(requestLog()).toHaveLength(2);
  expect(screen.queryByText(/Nepavyko atsisiųsti priedo/)).not.toBeInTheDocument();
});

test("a refused download is reported with the Klaida: prefix", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", QUEUE);
  onRequest("GET", "/api/activities/1/attachment", { status: 404, body: { error: "Priedas nerastas" } });
  const { user } = renderPage(EvaluatePage);
  await screen.findByText("Seminaras apie X");

  await user.click(within(rowNamed("Seminaras apie X")).getByRole("button", { name: "Peržiūrėti" }));
  await user.click(within(modal()).getByRole("button", { name: "ataskaita.pdf" }));

  expect(await screen.findByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).toHaveClass("form-status--error");
  await waitFor(() => expect(within(modal()).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
  expect(requestsTo("GET", "/api/activities/1/attachment")).toHaveLength(1);
});







// -----------------------------------------------------------
// non-array body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of the list is
// refused before it reaches state: the page keeps its h1 and
// the empty state, shows "Klaida: netikėtas serverio
// atsakymas." once and renders no rows instead of blanking.
// -----------------------------------------------------------

test("a 200 whose body is not a list is refused with one message, not a blank page", async () => {
  signInAs("Komisijos narys");
  onRequest("GET", "/api/activities/committee", { status: 200, body: { ok: true } });
  renderPage(EvaluatePage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status--error");
  expect(screen.getByRole("heading", { level: 1, name: "Įvertinti veiklas" })).toBeInTheDocument();
  expect(screen.getByText("(Šiuo metu nėra patvirtintų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toHaveLength(0);
  expect(screen.queryByText("Kraunama…")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});
