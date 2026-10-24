// -----------------------------------------------------------
//  [*] Regression — pages/manager/review.jsx
//
//  The PATEIKTA queue against the scripted fetch: queue and
//  theme tree load in parallel with X-Active-Role and the
//  rows render; every verdict PATCHes /api/activities/:id/
//  manager with its exact body — approve behind a confirm,
//  deny and return from the comment modals, where an empty
//  comment is refused without a request — and the queue
//  follows the RESPONSE: a status that left PATEIKTA drops
//  the row, one still PATEIKTA patches it in place, and each
//  row stays busy until its own PATCH ends. The review modal
//  is a dialog named by its heading that takes the focus and
//  gives it back; it shows the activity read-only, saves
//  theme / subtheme / manager comments with numeric ids but
//  never a theme without a subtheme, stays open while its
//  save is in flight and leaves a modal moved on to another
//  row alone when that save answers. The attachment downloads
//  with the header, every refused request surfaces as
//  "Klaida: <reason>", and each comment textarea is reachable
//  by its label. The prompts show their messages inside
//  them, and a cancelled edit puts the stored values back.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import ManagerReviewPage from "@/pages/manager/review.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Three themes: 6.2.'s subthemes are listed out of code
// order on purpose (6.2.10. before 6.2.2.), 6.3. has none
const THEMES = [
  { id: 1, code: "6.1.", title: "Studijų kokybė", total_sum: "1000", pointvalue: "2.5", subthemes: [
    { id: 11, theme_id: 1, code: "6.1.1.", title: "Paskaitos", description: null, cap: "60" },
    { id: 12, theme_id: 1, code: "6.1.2.", title: "Seminarai", description: null, cap: null },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", total_sum: "500", pointvalue: "1", subthemes: [
    { id: 22, theme_id: 2, code: "6.2.10.", title: "Publikacijos", description: null, cap: "40" },
    { id: 21, theme_id: 2, code: "6.2.2.", title: "Konferencijos", description: null, cap: null },
  ] },
  { id: 3, code: "6.3.", title: "Tuščia", total_sum: "0", pointvalue: "1", subthemes: [] },
];

// Two pending activities, neither scored yet: one with an
// attachment and a description, one with neither but with
// earlier comments
const ACT1 = {
  id: 1, full_name: "Jonas Jonaitis", status: "PATEIKTA", created_at: "2026-09-01T10:30:00Z",
  theme_id: 1, theme_code: "6.1.", theme_title: "Studijų kokybė",
  subtheme_id: 11, subtheme_code: "6.1.1.", subtheme_title: "Paskaitos",
  title: "Paskaitų ciklas", description: "Aprašymas A",
  attachment_path: "uploads/1.pdf", attachment_original_name: "ataskaita.pdf",
  manager_comments: "", rejection_comment: "", committee_comments: null, score: null,
};
const ACT2 = {
  id: 2, full_name: "Ona Onaitė", status: "PATEIKTA", created_at: "2026-09-02T08:00:00Z",
  theme_id: 2, theme_code: "6.2.", theme_title: "Mokslas",
  subtheme_id: 21, subtheme_code: "6.2.2.", subtheme_title: "Konferencijos",
  title: "Konferencijos pranešimas", description: "",
  attachment_path: null, attachment_original_name: null,
  manager_comments: "Senas komentaras", rejection_comment: "Ankstesnis atmetimas", committee_comments: null, score: null,
};

// The table row naming an activity (undefined once it left)
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));

// A modal by its heading
const modal = (heading) => screen.getByRole("heading", { name: heading }).closest(".employee-modal");

// The row a verdict PATCH answers with: the full activity row
// — the queue's fields plus employee_eid and updated_at —
// with the verdict's changes on top. A plain
// row is a 200 reply: the fake tells an activity's own
// `status` from a reply envelope
function verdict(activity, changes = {}) {
  return {
    ...activity,
    employee_eid: `u1000${activity.id}`,
    committee_comments: null,
    updated_at: "2026-09-02T12:00:00Z",
    ...changes,
  };
}

// The four GETs/PATCHes every test scripts the same way
function scriptQueue(items = [ACT1, ACT2]) {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/pending", items);
  onRequest("GET", "/api/themes", THEMES);
}







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Two GETs, both with the header only; the six column
// headers; a row's employee, "code — title" pairs, status
// pill and four action buttons.
// -----------------------------------------------------------

test("loads the queue and the theme tree with X-Active-Role and renders the rows", async () => {
  scriptQueue();
  renderPage(ManagerReviewPage);

  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų peržiūra" })).toBeInTheDocument();
  await screen.findByText("Paskaitų ciklas");
  expect(requestLog().map((r) => [r.method, r.url])).toEqual([["GET", "/api/activities/pending"], ["GET", "/api/themes"]]);
  for (const r of requestLog()) expect(r.headers).toEqual({ "x-active-role": "Vadybininkas" });

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Darbuotojas", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Veiksmai",
  ]);
  const row1 = rowNamed("Paskaitų ciklas");
  expect(within(row1).getByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(within(row1).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(row1).getByText("6.1.1. — Paskaitos")).toBeInTheDocument();
  expect(within(row1).getByText("PATEIKTA")).toHaveClass("status-pill", "status-pill--submitted");
  expect(within(row1).getAllByRole("button").map((b) => b.textContent)).toEqual(["Patvirtinti", "Atmesti", "Grąžinti", "Peržiūrėti"]);
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.queryByText("(Šiuo metu nėra pateiktų veiklų.)")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// empty queue
// -----------------------------------------------------------
//
// No pending activities: the empty note instead of a table.
// -----------------------------------------------------------

test("an empty queue shows the empty note and no table", async () => {
  scriptQueue([]);
  renderPage(ManagerReviewPage);

  expect(await screen.findByText("(Šiuo metu nėra pateiktų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// load error
// -----------------------------------------------------------
//
// Both GETs must succeed: a refused theme tree shows its
// error verbatim (no "Klaida:" prefix on load) and the queue
// that did arrive is not shown.
// -----------------------------------------------------------

test("a refused theme load shows the backend's text verbatim and keeps the queue empty", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/activities/pending", [ACT1]);
  onRequest("GET", "/api/themes", { status: 500, body: { error: "internal error" } });
  renderPage(ManagerReviewPage);

  expect(await screen.findByText("internal error")).toBeInTheDocument();
  expect(screen.getByText("(Šiuo metu nėra pateiktų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Paskaitų ciklas")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// approve
// -----------------------------------------------------------
//
// Patvirtinti asks the exact confirm; cancel sends nothing.
// OK PATCHes { action: "approve" } with both headers and a
// PATVIRTINTA response drops the row.
// -----------------------------------------------------------

test("approve: the confirm text, PATCH { action: 'approve' } with both headers, the row leaves; cancel sends nothing", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/1/manager", verdict(ACT1, { status: "PATVIRTINTA" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" }));
  expect(window.confirm).toHaveBeenCalledWith("Patvirtinti šią veiklą?");
  expect(requestsTo("PATCH", /^\/api\/activities\/\d+\/manager$/)).toEqual([]);
  expect(rowNamed("Paskaitų ciklas")).toBeDefined();

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" }));
  await waitFor(() => expect(rowNamed("Paskaitų ciklas")).toBeUndefined());
  const [patch] = requestsTo("PATCH", "/api/activities/1/manager");
  expect(patch.headers).toEqual({ "x-active-role": "Vadybininkas", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "approve" });
  expect(rowNamed("Konferencijos pranešimas")).toBeDefined();
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.queryByText(/^Klaida/)).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// row rule
// -----------------------------------------------------------
//
// The queue follows the response's status, not the action: an
// approve answered with a still-PATEIKTA activity patches the
// row in place instead of dropping it.
// -----------------------------------------------------------

test("a PATCH answered with status PATEIKTA replaces the row instead of removing it", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/1/manager", verdict(ACT1, { title: "Paskaitų ciklas (patikslintas)", status: "PATEIKTA" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" }));
  await screen.findByText("Paskaitų ciklas (patikslintas)");
  expect(requestsTo("PATCH", "/api/activities/1/manager")[0].body).toEqual({ action: "approve" });
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(rowNamed("Paskaitų ciklas")).toBeUndefined();
  expect(within(rowNamed("Paskaitų ciklas (patikslintas)")).getByRole("button", { name: "Patvirtinti" })).toBeEnabled();
});







// -----------------------------------------------------------
// one busy flag per row
// -----------------------------------------------------------
//
// A verdict on a second row while the first row's PATCH is
// still in flight disables the second row and leaves the
// first one disabled; the first answer then removes its row
// and leaves the second disabled until its own answer lands.
// -----------------------------------------------------------

test("a row's verdict buttons stay disabled until its own PATCH ends, whatever another row does", async () => {
  scriptQueue();
  // Both approvals wait until the test answers them
  const answer = {};
  onRequest("PATCH", /^\/api\/activities\/[12]\/manager$/, (req) => new Promise((resolve) => { answer[req.path] = resolve; }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  // A busy button reads "..." instead of its name, so a row's
  // three verdict buttons are taken by position
  const disabledIn = (title) => within(rowNamed(title)).getAllByRole("button").slice(0, 3).map((b) => b.disabled);

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" }));
  expect(disabledIn("Paskaitų ciklas")).toEqual([true, true, true]);
  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Patvirtinti" }));
  expect(disabledIn("Konferencijos pranešimas")).toEqual([true, true, true]);
  expect(disabledIn("Paskaitų ciklas")).toEqual([true, true, true]);

  answer["/api/activities/1/manager"](verdict(ACT1, { status: "PATVIRTINTA" }));
  await waitFor(() => expect(rowNamed("Paskaitų ciklas")).toBeUndefined());
  expect(disabledIn("Konferencijos pranešimas")).toEqual([true, true, true]);

  answer["/api/activities/2/manager"](verdict(ACT2, { status: "PATVIRTINTA" }));
  expect(await screen.findByText("(Šiuo metu nėra pateiktų veiklų.)")).toBeInTheDocument();
});







// -----------------------------------------------------------
// deny
// -----------------------------------------------------------
//
// Atmesti opens the modal seeded with the activity's earlier
// rejection_comment in a textarea reachable by its label; an
// empty or blank comment is refused with the message and no
// request; a comment PATCHes { action: "deny",
// rejection_comment }; ATMESTA drops the row and closes the
// modal.
// -----------------------------------------------------------

test("deny: the modal, an empty comment refused without a request, PATCH { action: 'deny', rejection_comment }, the row leaves", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/2/manager", verdict(ACT2, { status: "ATMESTA", rejection_comment: "Trūksta dokumentų" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Konferencijos pranešimas");

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Atmesti" }));
  const m = modal("Atmesti veiklą");
  expect(within(m).getByText("Ona Onaitė")).toBeInTheDocument();
  expect(within(m).getByText("Konferencijos pranešimas")).toBeInTheDocument();
  expect(within(m).getByText("Atmetimo komentaras")).toBeInTheDocument();
  const comment = within(m).getByPlaceholderText("Paaiškinkite, kodėl veikla atmetama");
  expect(within(m).getByLabelText("Atmetimo komentaras")).toBe(comment);
  expect(comment.value).toBe("Ankstesnis atmetimas");

  await user.clear(comment);
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  expect(await screen.findByText("Klaida: Atmetimui būtinas komentaras.")).toBeInTheDocument();
  await user.type(comment, "   ");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  expect(screen.getByText("Klaida: Atmetimui būtinas komentaras.")).toBeInTheDocument();
  expect(requestsTo("PATCH", /^\/api\/activities\/\d+\/manager$/)).toEqual([]);
  expect(screen.getByRole("heading", { name: "Atmesti veiklą" })).toBeInTheDocument();

  await user.clear(comment);
  await user.type(comment, "Trūksta dokumentų");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  await waitFor(() => expect(rowNamed("Konferencijos pranešimas")).toBeUndefined());
  const [patch] = requestsTo("PATCH", "/api/activities/2/manager");
  expect(patch.headers).toEqual({ "x-active-role": "Vadybininkas", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "deny", rejection_comment: "Trūksta dokumentų" });
  expect(screen.queryByRole("heading", { name: "Atmesti veiklą" })).not.toBeInTheDocument();
  expect(rowNamed("Paskaitų ciklas")).toBeDefined();
});







// -----------------------------------------------------------
// return
// -----------------------------------------------------------
//
// Grąžinti opens its own prompt with an empty comment even
// when the row has a rejection_comment; Atšaukti closes it
// without a request; an empty comment is refused; a comment
// PATCHes { action: "return", rejection_comment } and
// TIKSLINTI drops the row.
// -----------------------------------------------------------

test("return: the modal, Atšaukti, an empty comment refused, PATCH { action: 'return', rejection_comment }, the row leaves", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/2/manager", verdict(ACT2, { status: "TIKSLINTI" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Konferencijos pranešimas");

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Grąžinti" }));
  let m = modal("Grąžinti veiklą tikslinimui");
  expect(within(m).getByText("Tikslinimo komentaras")).toBeInTheDocument();
  expect(within(m).getByLabelText("Tikslinimo komentaras")).toBe(within(m).getByPlaceholderText("Paaiškinkite, ką reikia patikslinti"));
  expect(within(m).getByPlaceholderText("Paaiškinkite, ką reikia patikslinti").value).toBe("");
  await user.click(within(m).getByRole("button", { name: "Atšaukti" }));
  expect(screen.queryByRole("heading", { name: "Grąžinti veiklą tikslinimui" })).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Grąžinti" }));
  m = modal("Grąžinti veiklą tikslinimui");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti grąžinimą" }));
  expect(await screen.findByText("Klaida: Tikslinimui būtinas komentaras.")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);

  await user.type(within(m).getByPlaceholderText("Paaiškinkite, ką reikia patikslinti"), "Pridėkite datas");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti grąžinimą" }));
  await waitFor(() => expect(rowNamed("Konferencijos pranešimas")).toBeUndefined());
  const [patch] = requestsTo("PATCH", "/api/activities/2/manager");
  expect(patch.headers).toEqual({ "x-active-role": "Vadybininkas", "content-type": "application/json" });
  expect(patch.body).toEqual({ action: "return", rejection_comment: "Pridėkite datas" });
  expect(screen.queryByRole("heading", { name: "Grąžinti veiklą tikslinimui" })).not.toBeInTheDocument();
  expect(screen.queryByText("Klaida: Tikslinimui būtinas komentaras.")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// refused verdicts
// -----------------------------------------------------------
//
// A refused PATCH shows "Klaida: <reason>"; the row stays
// with its buttons re-enabled, and the comment modal stays
// open with its button re-enabled.
// -----------------------------------------------------------

test("a refused verdict shows Klaida: <reason>, keeps the row and keeps the comment modal open", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/1/manager", { status: 500, body: { error: "DB nepasiekiama" } });
  // The backend's wording, "Klaida:" included — shown once
  onRequest("PATCH", "/api/activities/2/manager", { status: 400, body: { error: "Klaida: Netinkama būsena" } });
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" }));
  expect(await screen.findByText("Klaida: DB nepasiekiama")).toBeInTheDocument();
  expect(rowNamed("Paskaitų ciklas")).toBeDefined();
  await waitFor(() => expect(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" })).toBeEnabled());

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Atmesti" }));
  expect(screen.queryByText("Klaida: DB nepasiekiama")).not.toBeInTheDocument();
  const m = modal("Atmesti veiklą");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  expect(await screen.findByText("Klaida: Netinkama būsena")).toBeInTheDocument();
  expect(requestsTo("PATCH", "/api/activities/2/manager")[0].body).toEqual({ action: "deny", rejection_comment: "Ankstesnis atmetimas" });
  expect(screen.getByRole("heading", { name: "Atmesti veiklą" })).toBeInTheDocument();
  await waitFor(() => expect(within(m).getByRole("button", { name: "Patvirtinti atmetimą" })).toBeEnabled());
  expect(rowNamed("Konferencijos pranešimas")).toBeDefined();
});







// -----------------------------------------------------------
// the deny prompt's messages show inside it
// -----------------------------------------------------------
//
// The empty-comment refusal and a refused PATCH show on the
// prompt's own status line, inside the dialog, not on the
// page's line behind the overlay.
// -----------------------------------------------------------

test("the deny prompt shows the empty-comment refusal and a refused PATCH inside the dialog", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/1/manager", { status: 400, body: { error: "Klaida: Netinkama būsena" } });
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Atmesti" }));
  const m = modal("Atmesti veiklą");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  await screen.findAllByText("Klaida: Atmetimui būtinas komentaras.");
  expect(within(m).getByText("Klaida: Atmetimui būtinas komentaras.")).toBeVisible();

  await user.type(within(m).getByLabelText("Atmetimo komentaras"), "Trūksta dokumentų");
  await user.click(within(m).getByRole("button", { name: "Patvirtinti atmetimą" }));
  await screen.findAllByText("Klaida: Netinkama būsena");
  expect(within(m).getByText("Klaida: Netinkama būsena")).toBeVisible();
});







// -----------------------------------------------------------
// review modal — view mode
// -----------------------------------------------------------
//
// Peržiūrėti opens the activity read-only: employee and
// Sukurta line, "code — title" pairs as text, title,
// description or "(nenurodyta)", status pill, the attachment
// button named after the file or "(nėra priedo)", a readOnly
// comments textarea reachable by its label; Išsaugoti is
// disabled until Redaguoti; Uždaryti closes.
// -----------------------------------------------------------

test("review modal: the activity read-only, Išsaugoti disabled, Uždaryti closes", async () => {
  scriptQueue();
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  let m = modal("Pateiktos veiklos peržiūra");
  expect(within(m).getByText("Jonas Jonaitis")).toBeInTheDocument();
  expect(within(m).getByText(/Sukurta: 2026-09-01 10:30/)).toBeInTheDocument();
  expect(within(m).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
  expect(within(m).getByText("6.1.1. — Paskaitos")).toBeInTheDocument();
  expect(within(m).getByText("Paskaitų ciklas")).toBeInTheDocument();
  expect(within(m).getByText("Aprašymas A")).toBeInTheDocument();
  expect(within(m).getByText("PATEIKTA")).toHaveClass("status-pill--submitted");
  expect(within(m).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled();
  expect(within(m).getByText("Vadybininkės komentarai")).toBeInTheDocument();
  expect(within(m).getByLabelText("Vadybininkės komentarai")).toBe(within(m).getByRole("textbox"));
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox").value).toBe("");
  expect(within(m).queryByRole("button", { name: /Pasirinkite/ })).not.toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Redaguoti" })).toBeEnabled();
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeDisabled();

  await user.click(within(m).getByRole("button", { name: "Uždaryti" }));
  expect(screen.queryByRole("heading", { name: "Pateiktos veiklos peržiūra" })).not.toBeInTheDocument();

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Peržiūrėti" }));
  m = modal("Pateiktos veiklos peržiūra");
  expect(within(m).getByText("Ona Onaitė")).toBeInTheDocument();
  expect(within(m).getByText("(nenurodyta)")).toBeInTheDocument();
  expect(within(m).getByText("(nėra priedo)")).toBeInTheDocument();
  expect(within(m).getByRole("textbox").value).toBe("Senas komentaras");
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// review modal — edit and save
// -----------------------------------------------------------
//
// Redaguoti turns the pair into pickers and the textarea
// writable. Picking a theme preselects its first subtheme in
// code order (6.2.2. before 6.2.10.), or shows "(potemių
// nėra)"; Išsaugoti PATCHes { manager_comments, theme_id,
// subtheme_id } with numeric ids; the PATEIKTA response
// patches the row in place, confirms "Veikla atnaujinta." and
// the modal drops back to view mode showing the saved pair.
// -----------------------------------------------------------

test("edit: the pickers, first-subtheme preselect in code order, PATCH with numeric ids, row patched, back to view mode", async () => {
  scriptQueue();
  const UPDATED = verdict(ACT1, {
    status: "PATEIKTA", manager_comments: "Perkelta į mokslą",
    theme_code: "6.2.", theme_title: "Mokslas",
    subtheme_code: "6.2.10.", subtheme_title: "Publikacijos",
  });
  onRequest("PATCH", "/api/activities/1/manager", UPDATED);
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  expect(within(m).getByRole("button", { name: "Atšaukti redagavimą" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeEnabled();
  expect(within(m).getByRole("textbox")).not.toHaveAttribute("readonly");
  expect(within(m).getByRole("button", { name: "Tema 6.1. — Studijų kokybė" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Potemė 6.1.1. — Paskaitos" })).toBeInTheDocument();

  await user.click(within(m).getByRole("button", { name: "Tema 6.1. — Studijų kokybė" }));
  await user.click(within(m).getByRole("button", { name: "6.3. — Tuščia" }));
  expect(within(m).getByText("(potemių nėra)")).toBeInTheDocument();

  await user.click(within(m).getByRole("button", { name: "Tema 6.3. — Tuščia" }));
  await user.click(within(m).getByRole("button", { name: "6.2. — Mokslas" }));
  expect(within(m).queryByText("(potemių nėra)")).not.toBeInTheDocument();
  await user.click(within(m).getByRole("button", { name: "Potemė 6.2.2. — Konferencijos" }));
  expect(within(m).getAllByRole("button", { name: /^6\.2\.\d+\. — [^▾]+$/ }).map((b) => b.textContent))
    .toEqual(["6.2.2. — Konferencijos", "6.2.10. — Publikacijos"]);
  await user.click(within(m).getByRole("button", { name: "6.2.10. — Publikacijos" }));

  await user.type(within(m).getByRole("textbox"), "Perkelta į mokslą");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  // The modal stays open, so it confirms the save itself
  expect(await within(m).findByText("Veikla atnaujinta.")).not.toHaveClass("form-status--error");
  const [patch] = requestsTo("PATCH", "/api/activities/1/manager");
  expect(patch.headers).toEqual({ "x-active-role": "Vadybininkas", "content-type": "application/json" });
  expect(patch.body).toEqual({ manager_comments: "Perkelta į mokslą", theme_id: 2, subtheme_id: 22 });
  expect(screen.getAllByRole("row")).toHaveLength(3);
  const row = rowNamed("Paskaitų ciklas");
  expect(within(row).getByText("6.2. — Mokslas")).toBeInTheDocument();
  expect(within(row).getByText("6.2.10. — Publikacijos")).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Redaguoti" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeDisabled();
  expect(within(m).getByText("6.2. — Mokslas")).toBeInTheDocument();
  expect(within(m).getByText("6.2.10. — Publikacijos")).toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox").value).toBe("Perkelta į mokslą");
});







// -----------------------------------------------------------
// review modal — refused save
// -----------------------------------------------------------
//
// A refused edit shows "Klaida: <reason>" on the modal's own
// status line, inside the box, and leaves the modal in edit
// mode with Išsaugoti enabled again and the row untouched.
// -----------------------------------------------------------

test("a refused edit save shows Klaida: <reason> and stays in edit mode", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/1/manager", { status: 400, body: { error: "Potemė nepriklauso temai" } });
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.type(within(m).getByRole("textbox"), "Pastaba");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  expect(await within(m).findByText("Klaida: Potemė nepriklauso temai")).toHaveClass("form-status--error");
  expect(requestsTo("PATCH", "/api/activities/1/manager")[0].body).toEqual({ manager_comments: "Pastaba", theme_id: 1, subtheme_id: 11 });
  expect(screen.queryByText("Veikla atnaujinta.")).not.toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Atšaukti redagavimą" })).toBeInTheDocument();
  await waitFor(() => expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeEnabled());
  expect(within(m).getByRole("textbox").value).toBe("Pastaba");
  expect(within(rowNamed("Paskaitų ciklas")).getByText("6.1. — Studijų kokybė")).toBeInTheDocument();
});







// -----------------------------------------------------------
// Atšaukti redagavimą restores the stored values
// -----------------------------------------------------------
//
// Cancelling an edit puts the activity's theme, subtheme and
// manager comments back: view mode shows the stored values,
// the next Redaguoti starts from them, and a save after that
// sends them.
// -----------------------------------------------------------

test("Atšaukti redagavimą restores the stored theme, subtheme and manager comments", async () => {
  scriptQueue();
  onRequest("PATCH", "/api/activities/2/manager", verdict(ACT2, { status: "PATEIKTA" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Konferencijos pranešimas");

  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.click(within(m).getByRole("button", { name: "Tema 6.2. — Mokslas" }));
  await user.click(within(m).getByRole("button", { name: "6.1. — Studijų kokybė" }));
  expect(within(m).getByRole("button", { name: "Potemė 6.1.1. — Paskaitos" })).toBeInTheDocument();
  await user.type(within(m).getByRole("textbox"), " — atšaukta");

  await user.click(within(m).getByRole("button", { name: "Atšaukti redagavimą" }));
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("textbox")).toHaveValue("Senas komentaras");

  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  expect(within(m).getByRole("button", { name: "Tema 6.2. — Mokslas" })).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Potemė 6.2.2. — Konferencijos" })).toBeInTheDocument();
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  await screen.findByText("Veikla atnaujinta.");
  expect(requestsTo("PATCH", "/api/activities/2/manager")[0].body).toEqual({ manager_comments: "Senas komentaras", theme_id: 2, subtheme_id: 21 });
});







// -----------------------------------------------------------
// review modal — no save without a subtheme
// -----------------------------------------------------------
//
// Picking a theme that has no subthemes leaves the subtheme
// empty, and an activity needs one: the save sends nothing,
// rather than a PATCH with a null subtheme_id that the
// backend would refuse with the misleading "potemė
// nepriklauso pasirinktai temai".
// -----------------------------------------------------------

test("a theme without subthemes is not saved — no PATCH goes out without a subtheme", async () => {
  scriptQueue();
  // How the backend answers such a pair, should one go out
  onRequest("PATCH", "/api/activities/1/manager", { status: 400, body: { error: "Klaida: potemė nepriklauso pasirinktai temai" } });
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.click(within(m).getByRole("button", { name: "Tema 6.1. — Studijų kokybė" }));
  await user.click(within(m).getByRole("button", { name: "6.3. — Tuščia" }));
  expect(within(m).getByText("(potemių nėra)")).toBeInTheDocument();

  // Pressed whether or not it is enabled; a PATCH, if one
  // goes out, has been answered once the button reads
  // Išsaugoti again
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  await waitFor(() => expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeInTheDocument());
  expect(requestsTo("PATCH", "/api/activities/1/manager")).toEqual([]);
});







// -----------------------------------------------------------
// review modal — open until its save ends
// -----------------------------------------------------------
//
// While a save is in flight a click on the backdrop closes
// nothing, like the modal's disabled buttons; when the
// answer lands, the same modal confirms the save and drops
// back to view mode with the saved comment.
// -----------------------------------------------------------

test("the review modal stays open while its save is in flight", async () => {
  scriptQueue();
  // The save waits until the test answers it
  let answer;
  onRequest("PATCH", "/api/activities/1/manager", () => new Promise((resolve) => { answer = resolve; }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.type(within(m).getByRole("textbox"), "Pastaba");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  expect(within(m).getByRole("button", { name: "Saugoma…" })).toBeDisabled();

  await user.click(document.querySelector(".employee-modal-backdrop"));
  expect(m).toBeInTheDocument();

  answer(verdict(ACT1, { status: "PATEIKTA", manager_comments: "Pastaba" }));
  await screen.findByText("Veikla atnaujinta.");
  expect(within(m).getByRole("textbox")).toHaveValue("Pastaba");
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
});







// -----------------------------------------------------------
// review modal — moved on to another row mid-save
// -----------------------------------------------------------
//
// The overlay stops the mouse, not the keyboard, so the rows
// behind it stay within reach while a save is in flight.
// Another row's Peržiūrėti then shows that row afresh, in
// view mode with its own comment; the first save's answer,
// landing later, leaves the modal on that row, and the
// modal's own save goes to its own activity with its own
// fields.
// -----------------------------------------------------------

test("a save answered after the modal moved on to another row leaves that row's modal alone", async () => {
  scriptQueue();
  // The first row's save waits until the test answers it
  let answer;
  onRequest("PATCH", "/api/activities/1/manager", () => new Promise((resolve) => { answer = resolve; }));
  onRequest("PATCH", "/api/activities/2/manager", verdict(ACT2, { status: "PATEIKTA" }));
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  let m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.type(within(m).getByRole("textbox"), "Pastaba");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  // A click stands in for the keyboard: jsdom lays out no
  // overlay that could stop it
  await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Peržiūrėti" }));
  m = modal("Pateiktos veiklos peržiūra");
  expect(within(m).getByText("Ona Onaitė")).toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveValue("Senas komentaras");
  expect(within(m).getByRole("textbox")).toHaveAttribute("readonly");
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeDisabled();

  // The first row's buttons come back once its answer has
  // been taken in; the modal that saved is gone, so no
  // confirmation shows anywhere
  answer(verdict(ACT1, { status: "PATEIKTA", manager_comments: "Pastaba" }));
  await waitFor(() => expect(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Patvirtinti" })).toBeEnabled());
  expect(screen.queryByText("Veikla atnaujinta.")).not.toBeInTheDocument();
  m = modal("Pateiktos veiklos peržiūra");
  expect(within(m).getByText("Ona Onaitė")).toBeInTheDocument();
  expect(within(m).queryByText("Jonas Jonaitis")).not.toBeInTheDocument();
  expect(within(m).getByRole("textbox")).toHaveValue("Senas komentaras");

  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  await waitFor(() => expect(within(m).getByRole("button", { name: "Redaguoti" })).toBeInTheDocument());
  expect(requestsTo("PATCH", "/api/activities/2/manager").map((r) => r.body)).toEqual([
    { manager_comments: "Senas komentaras", theme_id: 2, subtheme_id: 21 },
  ]);
  expect(requestsTo("PATCH", "/api/activities/1/manager")).toHaveLength(1);
});







// -----------------------------------------------------------
// attachment
// -----------------------------------------------------------
//
// The attachment button GETs /api/activities/:id/attachment
// with the header only; the reply is a text body (the page
// reads it with res.blob() either way), jsdom has no
// createObjectURL so it is stubbed and the anchor click
// swallowed — only the request is pinned. Without an original
// name the button reads "Atsisiųsti priedą"; a refused
// download reports "Klaida: Nepavyko atsisiųsti priedo:
// <reason>" inside the modal.
// -----------------------------------------------------------

test("attachment: GET /api/activities/:id/attachment with the header; a refused download reports the reason", async () => {
  const ACT2_WITH_FILE = { ...ACT2, attachment_path: "uploads/2.pdf", attachment_original_name: null };
  scriptQueue([ACT1, ACT2_WITH_FILE]);
  onRequest("GET", "/api/activities/1/attachment", "%PDF-1.4");
  // The backend's wording, "Klaida:" included — shown once
  onRequest("GET", "/api/activities/2/attachment", { status: 404, body: { error: "Klaida: Priedas nerastas" } });
  const createObjectURL = vi.fn(() => "blob:fake");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(window.URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(window.URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  try {
    await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
    let m = modal("Pateiktos veiklos peržiūra");
    await user.click(within(m).getByRole("button", { name: "ataskaita.pdf" }));
    await waitFor(() => expect(requestsTo("GET", "/api/activities/1/attachment")).toHaveLength(1));
    const [get] = requestsTo("GET", "/api/activities/1/attachment");
    expect(get.headers).toEqual({ "x-active-role": "Vadybininkas" });
    expect(get.body).toBeNull();
    await waitFor(() => expect(within(m).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
    expect(screen.queryByText(/^Klaida/)).not.toBeInTheDocument();
    await user.click(within(m).getByRole("button", { name: "Uždaryti" }));

    await user.click(within(rowNamed("Konferencijos pranešimas")).getByRole("button", { name: "Peržiūrėti" }));
    m = modal("Pateiktos veiklos peržiūra");
    await user.click(within(m).getByRole("button", { name: "Atsisiųsti priedą" }));
    expect(await within(m).findByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).toHaveClass("form-status--error");
    expect(requestsTo("GET", "/api/activities/2/attachment")[0].headers).toEqual({ "x-active-role": "Vadybininkas" });
    expect(within(m).getByRole("button", { name: "Atsisiųsti priedą" })).toBeEnabled();
  } finally {
    delete window.URL.createObjectURL;
    delete window.URL.revokeObjectURL;
  }
});







// -----------------------------------------------------------
// unexpected body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of the array — the
// queue's or the theme tree's, in turn — is refused with one
// message in the status line: the heading stays, the queue
// shows its empty note, nothing blanks.
// -----------------------------------------------------------

test("a 200 whose body is not an array, for either list, shows one message and keeps the page", async () => {
  signInAs("Vadybininkas");
  // Which list answers with the object; the other is fine.
  // Wrong shapes on purpose, so neither entry is guarded
  let broken = "queue";
  onRequest("GET", "/api/activities/pending", () => (broken === "queue" ? { status: 200, body: { ok: true } } : [ACT1]), { offContract: true });
  onRequest("GET", "/api/themes", () => (broken === "themes" ? { status: 200, body: { ok: true } } : THEMES), { offContract: true });
  const first = renderPage(ManagerReviewPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų peržiūra" })).toBeInTheDocument();
  expect(screen.getByText("(Šiuo metu nėra pateiktų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);

  first.unmount();
  broken = "themes";
  renderPage(ManagerReviewPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Darbuotojų veiklų peržiūra" })).toBeInTheDocument();
  expect(screen.getByText("(Šiuo metu nėra pateiktų veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Paskaitų ciklas")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(4);
});







// -----------------------------------------------------------
// a row the committee sent back
// -----------------------------------------------------------
//
// An activity the committee returned is back in PATEIKTA with
// the committee's reason in committee_comments; the row shows
// that reason under the title, so the manager knows why it is
// here again. A row without one shows no note.
// -----------------------------------------------------------

test("a row the committee sent back shows the committee's reason under its title", async () => {
  scriptQueue([{ ...ACT1, committee_comments: "Patikslinkite temą" }, ACT2]);
  renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  expect(within(rowNamed("Paskaitų ciklas")).getByText("Komisijos komentaras: Patikslinkite temą")).toBeInTheDocument();
  expect(within(rowNamed("Konferencijos pranešimas")).queryByText(/Komisijos komentaras/)).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// accessible names
// -----------------------------------------------------------
//
// In edit mode the review modal's theme and subtheme pickers
// are named by their captions.
// -----------------------------------------------------------

test("the review modal's theme and subtheme pickers are named by their captions", async () => {
  scriptQueue();
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");
  await user.click(within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" }));
  const m = modal("Pateiktos veiklos peržiūra");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));

  const [themeTrigger, subthemeTrigger] = m.querySelectorAll(".app-select-trigger");
  expect(within(m).getByLabelText("Tema")).toBe(themeTrigger);
  expect(within(m).getByLabelText("Potemė")).toBe(subthemeTrigger);
});







// -----------------------------------------------------------
// review modal — a dialog
// -----------------------------------------------------------
//
// Peržiūrėti opens a modal dialog named by its heading and
// moves the focus into it, so assistive tech announces it;
// Uždaryti hands the focus back to the row's Peržiūrėti.
// -----------------------------------------------------------

test("the review modal is a dialog named by its heading that takes the focus and gives it back", async () => {
  scriptQueue();
  const { user } = renderPage(ManagerReviewPage);
  await screen.findByText("Paskaitų ciklas");

  const opener = within(rowNamed("Paskaitų ciklas")).getByRole("button", { name: "Peržiūrėti" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Pateiktos veiklos peržiūra" });
  expect(dialog).toBe(modal("Pateiktos veiklos peržiūra"));
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toContainElement(document.activeElement);

  await user.click(within(dialog).getByRole("button", { name: "Uždaryti" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
