// -----------------------------------------------------------
//  [*] Regression — pages/employee/myActivities.jsx
//
//  The my-activities list against the scripted fetch: the
//  activities and the theme tree load together with the
//  employee's X-Active-Role, every row shows its pill, the
//  "(nėra)" fallbacks and the buttons its status allows, the
//  attachment download fetches with the header and hands a
//  blob URL to a temporary link, delete and resubmit ask for
//  confirmation and patch the list in place, the review modal
//  shows the row's values and closes from the button or the
//  backdrop, the edit mode's inputs are named by their
//  captions and PATCH multipart with the codes before the
//  file, refreshing the row and the modal, the client refuses
//  an incomplete edit and an oversized pick without a
//  request, and backend errors are shown behind the page's
//  own prefixes.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import MyActivitiesPage from "@/pages/employee/myActivities.jsx";
import { onRequest, requestsTo, requestLog, resetFakeFetch } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Three themes: two with subthemes, one without (the edit
// modal's "(potemių nėra)" case)
const THEMES = [
  { id: 1, code: "1.", title: "Studijos", subthemes: [
    { id: 11, code: "1.1.", title: "Paskaitos" },
    { id: 12, code: "1.2.", title: "Seminarai" },
  ] },
  { id: 2, code: "2.", title: "Mokslas", subthemes: [
    { id: 21, code: "2.1.", title: "Straipsniai" },
  ] },
  { id: 3, code: "3.", title: "Kita", subthemes: [] },
];

// One activity per status: A submitted with a named
// attachment, B returned for correction without one, C scored
// with an unnamed attachment, D rejected without a
// description, E approved
const ACTIVITIES = [
  { id: 101, theme_id: 1, subtheme_id: 11, theme_code: "1.", theme_title: "Studijos", subtheme_code: "1.1.", subtheme_title: "Paskaitos",
    title: "Kursas A", description: "Aprašas A", status: "PATEIKTA", rejection_comment: null, score: null,
    attachment_path: "uploads/1_1.1_ataskaita.pdf", attachment_original_name: "ataskaita.pdf", created_at: "2026-03-05T10:20:00Z" },
  { id: 102, theme_id: 1, subtheme_id: 12, theme_code: "1.", theme_title: "Studijos", subtheme_code: "1.2.", subtheme_title: "Seminarai",
    title: "Seminaras B", description: "", status: "TIKSLINTI", rejection_comment: "Patikslinkite datą", score: null,
    attachment_path: null, attachment_original_name: null, created_at: "2026-03-06T09:00:00Z" },
  { id: 103, theme_id: 2, subtheme_id: 21, theme_code: "2.", theme_title: "Mokslas", subtheme_code: "2.1.", subtheme_title: "Straipsniai",
    title: "Straipsnis C", description: "Aprašas C", status: "ĮVERTINTA", rejection_comment: null, score: 4.5,
    attachment_path: "uploads/2_2.1_x.pdf", attachment_original_name: null, created_at: "2026-03-07T12:00:00Z" },
  { id: 104, theme_id: 2, subtheme_id: 21, theme_code: "2.", theme_title: "Mokslas", subtheme_code: "2.1.", subtheme_title: "Straipsniai",
    title: "Projektas D", description: null, status: "ATMESTA", rejection_comment: "Netinka temai", score: null,
    attachment_path: null, attachment_original_name: null, created_at: "2026-03-08T12:00:00Z" },
  { id: 105, theme_id: 1, subtheme_id: 11, theme_code: "1.", theme_title: "Studijos", subtheme_code: "1.1.", subtheme_title: "Paskaitos",
    title: "Renginys E", description: "Aprašas E", status: "PATVIRTINTA", rejection_comment: null, score: null,
    attachment_path: null, attachment_original_name: null, created_at: "2026-03-09T12:00:00Z" },
];

// The page's lt-LT date-time, computed the same way so the
// expectation does not depend on the runner's time zone
const fmt = (iso) => new Date(iso).toLocaleString("lt-LT", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

// The table row naming an activity, its button labels, the
// modal and its backdrop, the open AppSelect dropdown, the
// modal's two select triggers and the (only) file input
const rowNamed = (text) => screen.getAllByRole("row").find((r) => within(r).queryByText(text));
const buttonsIn = (el) => within(el).getAllByRole("button").map((b) => b.textContent);
const modal = () => document.querySelector(".employee-modal");
const backdrop = () => document.querySelector(".employee-modal-backdrop");
const dropdown = () => document.querySelector(".app-select-dropdown");
const selects = () => [...modal().querySelectorAll(".app-select-trigger")];
const fileInput = () => document.querySelector('input[type="file"]');

// Activity-shaped replies carry a `status` field, which the
// fake would read as an envelope — so they are wrapped in one
const activityReply = (act) => ({ status: 200, body: act });

const mountPage = (activities = ACTIVITIES) => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/activities/my", activities);
  onRequest("GET", "/api/themes", THEMES);
  return renderPage(MyActivitiesPage);
};

// jsdom has no object URLs and no navigation: stub both on
// window.URL and capture what the temporary link is asked to
// download instead of letting jsdom try to follow it
const stubDownloads = () => {
  const createObjectURL = vi.fn(() => "blob:fake-url");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(window.URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
  Object.defineProperty(window.URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true, writable: true });
  const clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicked.push({ href: this.href, download: this.download });
  });
  return { createObjectURL, revokeObjectURL, clicked };
};

// The attachment reply: jsdom's Blob has no stream(), which
// Node's Response needs to carry a Blob body, so the bytes go
// as a string with the PDF content-type set on the envelope
const PDF_REPLY = { status: 200, body: "%PDF-1.4", headers: { "Content-Type": "application/pdf" } };

const openModalFor = async (user, title) => {
  await user.click(within(rowNamed(title)).getByRole("button", { name: "Peržiūrėti" }));
  return modal();
};







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// Two GETs (activities first, then themes), both with the
// header; each row shows the formatted date, "code — title"
// pairs, the status pill class, the comment / score /
// attachment or "(nėra)", and only the buttons its status
// allows: review always, resubmit for TIKSLINTI, delete until
// approved / scored / rejected.
// -----------------------------------------------------------

test("loads activities and themes with X-Active-Role and renders rows, pills, fallbacks and buttons", async () => {
  mountPage();

  expect(await screen.findByRole("heading", { name: "Mano veiklos" })).toBeInTheDocument();
  await screen.findByText("Kursas A");
  expect(requestLog().map((r) => [r.method, r.path])).toEqual([["GET", "/api/activities/my"], ["GET", "/api/themes"]]);
  for (const r of requestLog()) expect(r.headers).toEqual({ "x-active-role": "Darbuotojas" });

  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
    "Data", "Tema", "Potemė", "Veiklos pavadinimas", "Būsena", "Komentaras", "Įvertinimas", "Priedas", "Veiksmai",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(6);

  const a = rowNamed("Kursas A");
  expect(within(a).getByText(fmt("2026-03-05T10:20:00Z"))).toBeInTheDocument();
  expect(within(a).getByText("1. — Studijos")).toBeInTheDocument();
  expect(within(a).getByText("1.1. — Paskaitos")).toBeInTheDocument();
  expect(within(a).getByText("PATEIKTA")).toHaveClass("status-pill", "status-pill--submitted");
  expect(within(a).getAllByText("(nėra)")).toHaveLength(2);
  expect(buttonsIn(a)).toEqual(["ataskaita.pdf", "Peržiūrėti", "Ištrinti"]);

  const b = rowNamed("Seminaras B");
  expect(within(b).getByText("TIKSLINTI")).toHaveClass("status-pill", "status-pill--returned");
  expect(within(b).getByText("Patikslinkite datą")).toBeInTheDocument();
  expect(within(b).getAllByText("(nėra)")).toHaveLength(2);
  expect(buttonsIn(b)).toEqual(["Peržiūrėti", "Pateikti", "Ištrinti"]);

  const c = rowNamed("Straipsnis C");
  expect(within(c).getByText("ĮVERTINTA")).toHaveClass("status-pill", "status-pill--scored");
  expect(within(c).getByText("4.5")).toBeInTheDocument();
  expect(within(c).getAllByText("(nėra)")).toHaveLength(1);
  expect(buttonsIn(c)).toEqual(["Atsisiųsti", "Peržiūrėti"]);

  const d = rowNamed("Projektas D");
  expect(within(d).getByText("ATMESTA")).toHaveClass("status-pill", "status-pill--rejected");
  expect(within(d).getByText("Netinka temai")).toBeInTheDocument();
  expect(buttonsIn(d)).toEqual(["Peržiūrėti"]);

  const e = rowNamed("Renginys E");
  expect(within(e).getByText("PATVIRTINTA")).toHaveClass("status-pill", "status-pill--approved");
  expect(buttonsIn(e)).toEqual(["Peržiūrėti"]);
  expect(modal()).toBeNull();
  expect(document.querySelector(".form-status")).toBeNull();
});

test("an empty list shows the empty line instead of a table", async () => {
  mountPage([]);

  expect(await screen.findByText("(Dar nepateikėte jokių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// load errors
// -----------------------------------------------------------
//
// Either GET failing shows the backend's error text verbatim
// and nothing is listed — the items are set only after both
// responses pass.
// -----------------------------------------------------------

test("a failed activities load shows the error verbatim and lists nothing", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/activities/my", { status: 500, body: { error: "internal error" } });
  onRequest("GET", "/api/themes", THEMES);
  renderPage(MyActivitiesPage);

  expect(await screen.findByText("internal error")).toBeInTheDocument();
  expect(screen.getByText("(Dar nepateikėte jokių veiklų.)")).toBeInTheDocument();
});

test("a failed theme load shows the error verbatim and drops the activities too", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/activities/my", ACTIVITIES);
  onRequest("GET", "/api/themes", { status: 403, body: { error: "Neturite teisės" } });
  renderPage(MyActivitiesPage);

  expect(await screen.findByText("Neturite teisės")).toBeInTheDocument();
  expect(screen.getByText("(Dar nepateikėte jokių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Kursas A")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// download
// -----------------------------------------------------------
//
// The attachment button GETs /api/activities/:id/attachment
// with the header, turns the blob into an object URL, clicks
// a link named after the original filename ("priedas" when
// there is none) and revokes the URL; a refused download
// shows the reason behind "Klaida: Nepavyko atsisiųsti
// priedo: ".
// -----------------------------------------------------------

test("the attachment button fetches with the role header and downloads under the original name", async () => {
  const { createObjectURL, revokeObjectURL, clicked } = stubDownloads();
  onRequest("GET", "/api/activities/101/attachment", PDF_REPLY);
  onRequest("GET", "/api/activities/103/attachment", PDF_REPLY);
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(within(rowNamed("Kursas A")).getByRole("button", { name: "ataskaita.pdf" }));
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url"));
  const [get] = requestsTo("GET", "/api/activities/101/attachment");
  expect(get.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(get.body).toBeNull();
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(createObjectURL.mock.calls[0][0]).toMatchObject({ size: 8, type: "application/pdf" });
  expect(clicked).toEqual([{ href: "blob:fake-url", download: "ataskaita.pdf" }]);
  expect(within(rowNamed("Kursas A")).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled();

  await user.click(within(rowNamed("Straipsnis C")).getByRole("button", { name: "Atsisiųsti" }));
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2));
  expect(requestsTo("GET", "/api/activities/103/attachment")[0].headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(clicked[1]).toEqual({ href: "blob:fake-url", download: "priedas" });
  expect(document.querySelector(".form-status")).toBeNull();
});

test("a refused download shows the prefixed reason and re-enables the button", async () => {
  const { createObjectURL, clicked } = stubDownloads();
  onRequest("GET", "/api/activities/101/attachment", { status: 404, body: { error: "Priedas nerastas" } });
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(within(rowNamed("Kursas A")).getByRole("button", { name: "ataskaita.pdf" }));

  expect(await screen.findByText("Klaida: Nepavyko atsisiųsti priedo: Priedas nerastas")).toBeInTheDocument();
  expect(requestsTo("GET", "/api/activities/101/attachment")).toHaveLength(1);
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(clicked).toEqual([]);
  await waitFor(() => expect(within(rowNamed("Kursas A")).getByRole("button", { name: "ataskaita.pdf" })).toBeEnabled());
});







// -----------------------------------------------------------
// delete
// -----------------------------------------------------------
//
// "Ištrinti" asks "Ar tikrai norite ištrinti šią veiklą?",
// DELETEs with the header and no body, drops the row and
// confirms; a declined prompt sends nothing; a refused DELETE
// shows the reason behind "Klaida: Nepavyko ištrinti veiklos:
// " and keeps the row.
// -----------------------------------------------------------

test("Ištrinti confirms, DELETEs with the role header, drops the row and confirms", async () => {
  onRequest("DELETE", "/api/activities/101", { status: 204 });
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(within(rowNamed("Kursas A")).getByRole("button", { name: "Ištrinti" }));

  expect(await screen.findByText("Veikla sėkmingai ištrinta.")).toBeInTheDocument();
  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai norite ištrinti šią veiklą?");
  const [del] = requestsTo("DELETE", "/api/activities/101");
  expect(del.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(del.body).toBeNull();
  expect(screen.queryByText("Kursas A")).not.toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(5);
  expect(requestLog()).toHaveLength(3);
});

test("a declined delete prompt sends nothing and keeps the row", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(rowNamed("Seminaras B")).getByRole("button", { name: "Ištrinti" }));

  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai norite ištrinti šią veiklą?");
  expect(requestsTo("DELETE", /^\/api\/activities\/\d+$/)).toEqual([]);
  expect(screen.getByText("Seminaras B")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(6);
  expect(document.querySelector(".form-status")).toBeNull();
});

test("a refused DELETE shows the prefixed reason and keeps the row", async () => {
  onRequest("DELETE", "/api/activities/101", { status: 403, body: { error: "Veiklos trinti nebegalima" } });
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(within(rowNamed("Kursas A")).getByRole("button", { name: "Ištrinti" }));

  expect(await screen.findByText("Klaida: Nepavyko ištrinti veiklos: Veiklos trinti nebegalima")).toBeInTheDocument();
  expect(screen.getByText("Kursas A")).toBeInTheDocument();
  await waitFor(() => expect(within(rowNamed("Kursas A")).getByRole("button", { name: "Ištrinti" })).toBeEnabled());
});







// -----------------------------------------------------------
// resubmit
// -----------------------------------------------------------
//
// "Pateikti" on a TIKSLINTI row asks "Ar tikrai norite
// pateikti veiklą iš naujo?", POSTs /resubmit with the header
// and no body, and replaces the row (and the open modal) with
// the returned copy; a declined prompt sends nothing; a
// refused POST shows the reason behind "Klaida: Nepavyko
// pateikti iš naujo: ".
// -----------------------------------------------------------

test("Pateikti confirms, POSTs /resubmit with the role header and replaces the row and the open modal", async () => {
  const fresh = { ...ACTIVITIES[1], status: "PATEIKTA", rejection_comment: null };
  onRequest("POST", "/api/activities/102/resubmit", activityReply(fresh));
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Seminaras B");
  expect(within(m).getByText("TIKSLINTI")).toHaveClass("status-pill--returned");
  await user.click(within(rowNamed("Seminaras B")).getByRole("button", { name: "Pateikti" }));

  expect(await screen.findByText("Veikla sėkmingai pateikta iš naujo.")).toBeInTheDocument();
  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai norite pateikti veiklą iš naujo?");
  const [post] = requestsTo("POST", "/api/activities/102/resubmit");
  expect(post.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(post.body).toBeNull();

  const b = rowNamed("Seminaras B");
  expect(within(b).getByText("PATEIKTA")).toHaveClass("status-pill", "status-pill--submitted");
  expect(within(b).getAllByText("(nėra)")).toHaveLength(3);
  expect(buttonsIn(b)).toEqual(["Peržiūrėti", "Ištrinti"]);
  expect(within(modal()).getByText("PATEIKTA")).toHaveClass("status-pill--submitted");
  expect(requestLog()).toHaveLength(3);
});

test("a declined resubmit prompt sends nothing", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(rowNamed("Seminaras B")).getByRole("button", { name: "Pateikti" }));

  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai norite pateikti veiklą iš naujo?");
  expect(requestsTo("POST", "/api/activities/102/resubmit")).toEqual([]);
  expect(within(rowNamed("Seminaras B")).getByText("TIKSLINTI")).toBeInTheDocument();
});

test("a refused resubmit shows the prefixed reason and keeps the row as it was", async () => {
  onRequest("POST", "/api/activities/102/resubmit", { status: 409, body: { error: "Veikla jau pateikta" } });
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  await user.click(within(rowNamed("Seminaras B")).getByRole("button", { name: "Pateikti" }));

  expect(await screen.findByText("Klaida: Nepavyko pateikti iš naujo: Veikla jau pateikta")).toBeInTheDocument();
  const b = rowNamed("Seminaras B");
  expect(within(b).getByText("TIKSLINTI")).toHaveClass("status-pill--returned");
  await waitFor(() => expect(within(rowNamed("Seminaras B")).getByRole("button", { name: "Pateikti" })).toBeEnabled());
  expect(buttonsIn(rowNamed("Seminaras B"))).toEqual(["Peržiūrėti", "Pateikti", "Ištrinti"]);
});







// -----------------------------------------------------------
// review modal
// -----------------------------------------------------------
//
// "Peržiūrėti" opens the modal with the row's created time,
// theme / subtheme pairs, title, description or
// "(nenurodyta)", status pill and attachment button or
// "(nėra)"; "Redaguoti" appears only for PATEIKTA / TIKSLINTI.
// "Uždaryti" and a backdrop click close it; a click inside
// does not.
// -----------------------------------------------------------

test("Peržiūrėti opens the modal with the row's values; Uždaryti and the backdrop close it", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Kursas A");
  expect(within(m).getByRole("heading", { name: "Veiklos peržiūra" })).toBeInTheDocument();
  expect(within(m).getByText(`Sukurta: ${fmt("2026-03-05T10:20:00Z")}`)).toBeInTheDocument();
  expect(within(m).getByText("1. — Studijos")).toBeInTheDocument();
  expect(within(m).getByText("1.1. — Paskaitos")).toBeInTheDocument();
  expect(within(m).getByText("Kursas A")).toBeInTheDocument();
  expect(within(m).getByText("Aprašas A")).toBeInTheDocument();
  expect(within(m).getByText("PATEIKTA")).toHaveClass("status-pill", "status-pill--submitted");
  expect(buttonsIn(m)).toEqual(["ataskaita.pdf", "Uždaryti", "Redaguoti"]);
  expect(m.querySelector("input, textarea")).toBeNull();

  await user.click(within(m).getByText("Veiklos peržiūra"));
  expect(modal()).not.toBeNull();
  await user.click(within(m).getByRole("button", { name: "Uždaryti" }));
  expect(modal()).toBeNull();

  const d = await openModalFor(user, "Projektas D");
  expect(within(d).getByText("(nenurodyta)")).toBeInTheDocument();
  expect(within(d).getByText("(nėra)")).toBeInTheDocument();
  expect(within(d).getByText("ATMESTA")).toHaveClass("status-pill--rejected");
  expect(buttonsIn(d)).toEqual(["Uždaryti"]);
  await user.click(backdrop());
  expect(modal()).toBeNull();

  const c = await openModalFor(user, "Straipsnis C");
  expect(buttonsIn(c)).toEqual(["Atsisiųsti", "Uždaryti"]);
  await user.click(within(c).getByRole("button", { name: "Uždaryti" }));
  expect(modal()).toBeNull();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// edit
// -----------------------------------------------------------
//
// "Redaguoti" swaps the fields for two AppSelects seeded from
// the row, a title input, a description textarea and a file
// input with its keep-empty hint; a theme pick preselects its
// first subtheme; "Išsaugoti" PATCHes multipart with
// theme_id, subtheme_id, title, description, theme_code,
// subtheme_code and then the file, only the role header, and
// the returned copy replaces the row and the modal, back in
// view mode, with "Veikla sėkmingai atnaujinta.".
// -----------------------------------------------------------

test("Redaguoti → Išsaugoti PATCHes multipart with the codes before the file and refreshes the row and modal", async () => {
  const updated = {
    ...ACTIVITIES[1],
    theme_id: 2, subtheme_id: 21, theme_code: "2.", theme_title: "Mokslas", subtheme_code: "2.1.", subtheme_title: "Straipsniai",
    title: "Seminaras B2", description: "Naujas aprašas",
    attachment_path: "uploads/2_2.1_naujas.pdf", attachment_original_name: "naujas.pdf",
  };
  onRequest("PATCH", "/api/activities/102", activityReply(updated));
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Seminaras B");
  expect(within(m).getByText("(nenurodyta)")).toBeInTheDocument();
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));

  expect(selects()[0]).toHaveTextContent("1. — Studijos");
  expect(selects()[1]).toHaveTextContent("1.2. — Seminarai");
  const title = m.querySelector("input.field-input");
  const description = m.querySelector("textarea");
  expect(title).toHaveValue("Seminaras B");
  expect(description).toHaveValue("");
  expect(within(m).getByText("Palikite tuščią, jei nenorite keisti priedo.")).toBeInTheDocument();
  expect(within(m).queryByText(/Dabartinis failas:/)).not.toBeInTheDocument();
  expect(within(m).getByText("TIKSLINTI")).toHaveClass("status-pill--returned");
  expect(buttonsIn(m).slice(-2)).toEqual(["Uždaryti", "Išsaugoti"]);

  await user.click(selects()[0]);
  await user.click(within(dropdown()).getByRole("button", { name: "2. — Mokslas" }));
  expect(selects()[0]).toHaveTextContent("2. — Mokslas");
  expect(selects()[1]).toHaveTextContent("2.1. — Straipsniai");

  await user.clear(title);
  await user.type(title, "Seminaras B2");
  await user.type(description, "Naujas aprašas");
  const file = new File(["%PDF-1.4"], "naujas.pdf", { type: "application/pdf" });
  await user.upload(fileInput(), file);
  expect(within(m).getByText("Pasirinktas naujas failas: naujas.pdf")).toBeInTheDocument();

  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  expect(await screen.findByText("Veikla sėkmingai atnaujinta.")).toBeInTheDocument();
  const [patch] = requestsTo("PATCH", "/api/activities/102");
  expect(patch.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(patch.body).toBeInstanceOf(FormData);
  const entries = [...patch.body.entries()];
  expect(entries.map(([name]) => name)).toEqual([
    "theme_id", "subtheme_id", "title", "description", "theme_code", "subtheme_code", "attachment",
  ]);
  expect(entries.slice(0, 6)).toEqual([
    ["theme_id", "2"],
    ["subtheme_id", "21"],
    ["title", "Seminaras B2"],
    ["description", "Naujas aprašas"],
    ["theme_code", "2."],
    ["subtheme_code", "2.1."],
  ]);
  const sent = patch.body.get("attachment");
  expect(sent).toBeInstanceOf(File);
  expect(sent.name).toBe("naujas.pdf");
  expect(sent.type).toBe("application/pdf");

  const b = rowNamed("Seminaras B2");
  expect(within(b).getByText("2. — Mokslas")).toBeInTheDocument();
  expect(within(b).getByText("2.1. — Straipsniai")).toBeInTheDocument();
  expect(buttonsIn(b)).toEqual(["naujas.pdf", "Peržiūrėti", "Pateikti", "Ištrinti"]);
  expect(screen.queryByText("Seminaras B")).not.toBeInTheDocument();

  expect(within(modal()).getByText("Seminaras B2")).toBeInTheDocument();
  expect(within(modal()).getByText("Naujas aprašas")).toBeInTheDocument();
  expect(within(modal()).getByText("2.1. — Straipsniai")).toBeInTheDocument();
  expect(buttonsIn(modal())).toEqual(["naujas.pdf", "Uždaryti", "Redaguoti"]);
  expect(modal().querySelector("input, textarea")).toBeNull();
  expect(requestLog()).toHaveLength(3);
});

test("an edit without a file keeps the current attachment: no attachment field, hint names the current file", async () => {
  onRequest("PATCH", "/api/activities/101", activityReply({ ...ACTIVITIES[0], title: "Kursas A1" }));
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Kursas A");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  expect(within(m).getByText("Dabartinis failas: ataskaita.pdf")).toBeInTheDocument();
  expect(selects()[0]).toHaveTextContent("1. — Studijos");
  expect(selects()[1]).toHaveTextContent("1.1. — Paskaitos");

  await user.type(m.querySelector("input.field-input"), "1");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  expect(await screen.findByText("Veikla sėkmingai atnaujinta.")).toBeInTheDocument();
  const [patch] = requestsTo("PATCH", "/api/activities/101");
  expect(patch.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect([...patch.body.entries()]).toEqual([
    ["theme_id", "1"],
    ["subtheme_id", "11"],
    ["title", "Kursas A1"],
    ["description", "Aprašas A"],
    ["theme_code", "1."],
    ["subtheme_code", "1.1."],
  ]);
  expect(within(rowNamed("Kursas A1")).getByRole("button", { name: "ataskaita.pdf" })).toBeInTheDocument();
});







// -----------------------------------------------------------
// edit labels
// -----------------------------------------------------------
//
// In edit mode the title input, the description textarea and
// the file input are reachable by their captions ("Veiklos
// pavadinimas", "Veiklos aprašymas", "Priedas") — divs linked
// through aria-labelledby. The two picker captions are not
// linked: AppSelect renders a button, and naming it is
// AppSelect's own business.
// -----------------------------------------------------------

test("the edit form's title, description and file inputs are reachable by their captions", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Kursas A");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));

  expect(within(m).getByLabelText("Veiklos pavadinimas")).toBe(m.querySelector("input.field-input"));
  expect(within(m).getByLabelText("Veiklos pavadinimas")).toHaveValue("Kursas A");
  expect(within(m).getByLabelText("Veiklos aprašymas")).toBe(m.querySelector("textarea"));
  expect(within(m).getByLabelText("Priedas")).toBe(fileInput());
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// edit validation
// -----------------------------------------------------------
//
// An empty title, or a theme without subthemes (the field
// reads "(potemių nėra)" and the id is ""), is refused with
// "Prašome užpildyti temą, potemę ir pavadinimą." and no
// PATCH; the modal stays in edit mode.
// -----------------------------------------------------------

test("an empty title or a theme without subthemes is refused without a request", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Seminaras B");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  const title = m.querySelector("input.field-input");

  await user.clear(title);
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Prašome užpildyti temą, potemę ir pavadinimą.")).toBeInTheDocument();
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeInTheDocument();

  await user.type(title, "Seminaras B");
  await user.click(selects()[0]);
  await user.click(within(dropdown()).getByRole("button", { name: "3. — Kita" }));
  expect(selects()[0]).toHaveTextContent("3. — Kita");
  expect(selects()).toHaveLength(1);
  expect(within(m).getByText("(potemių nėra)")).toBeInTheDocument();
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));
  expect(await screen.findByText("Prašome užpildyti temą, potemę ir pavadinimą.")).toBeInTheDocument();

  expect(requestsTo("PATCH", /^\/api\/activities\/\d+$/)).toEqual([]);
  expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeInTheDocument();
  expect(within(rowNamed("Seminaras B")).getByText("1.2. — Seminarai")).toBeInTheDocument();
});







// -----------------------------------------------------------
// oversized pick
// -----------------------------------------------------------
//
// A file over 100 MB picked in edit mode is refused with the
// shared message, the input is cleared and the current file
// stays named; a valid pick afterwards replaces that hint
// with "Pasirinktas naujas failas: …".
// -----------------------------------------------------------

test("an oversized pick in edit mode is refused and cleared; a valid pick replaces the current-file hint", async () => {
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Kursas A");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));

  const big = new File(["x"], "didelis.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });
  await user.upload(fileInput(), big);
  expect(await screen.findByText("Klaida: priedas per didelis (iki 100 MB)")).toBeInTheDocument();
  expect(within(m).queryByText(/Pasirinktas naujas failas:/)).not.toBeInTheDocument();
  expect(within(m).getByText("Dabartinis failas: ataskaita.pdf")).toBeInTheDocument();
  expect(fileInput().value).toBe("");
  expect(fileInput().files).toHaveLength(0);

  await user.upload(fileInput(), new File(["%PDF-1.4"], "geras.pdf", { type: "application/pdf" }));
  expect(within(m).getByText("Pasirinktas naujas failas: geras.pdf")).toBeInTheDocument();
  expect(within(m).queryByText(/Dabartinis failas:/)).not.toBeInTheDocument();
  expect(screen.queryByText("Klaida: priedas per didelis (iki 100 MB)")).not.toBeInTheDocument();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// edit errors
// -----------------------------------------------------------
//
// A refused PATCH shows the reason behind "Klaida: Nepavyko
// atnaujinti: ", leaves the modal in edit mode with the draft
// and the row untouched.
// -----------------------------------------------------------

test("a refused PATCH shows the prefixed reason and keeps the draft in edit mode", async () => {
  onRequest("PATCH", "/api/activities/102", { status: 400, body: { error: "Neteisinga potemė" } });
  const { user } = mountPage();
  await screen.findByText("Kursas A");

  const m = await openModalFor(user, "Seminaras B");
  await user.click(within(m).getByRole("button", { name: "Redaguoti" }));
  const title = m.querySelector("input.field-input");
  await user.clear(title);
  await user.type(title, "Seminaras B2");
  await user.click(within(m).getByRole("button", { name: "Išsaugoti" }));

  expect(await screen.findByText("Klaida: Nepavyko atnaujinti: Neteisinga potemė")).toBeInTheDocument();
  expect(requestsTo("PATCH", "/api/activities/102")).toHaveLength(1);
  await waitFor(() => expect(within(m).getByRole("button", { name: "Išsaugoti" })).toBeEnabled());
  expect(m.querySelector("input.field-input")).toHaveValue("Seminaras B2");
  expect(rowNamed("Seminaras B")).toBeDefined();
  expect(screen.queryByText("Seminaras B2", { selector: "td" })).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// wrong shape
// -----------------------------------------------------------
//
// A 200 whose body is not an array — from either GET in turn
// — is refused with the page's fixed message in the status
// line instead of blanking the page on the next render;
// nothing is listed, as after a failed GET.
// -----------------------------------------------------------

test("a non-array activities or theme reply is refused with a clear message instead of a blank page", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/activities/my", { status: 200, body: { ok: true } });
  onRequest("GET", "/api/themes", THEMES);
  const { unmount } = renderPage(MyActivitiesPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Mano veiklos" })).toBeInTheDocument();
  expect(screen.getByText("(Dar nepateikėte jokių veiklų.)")).toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toEqual([]);
  expect(requestLog()).toHaveLength(2);
  unmount();

  // The same page again, now with the theme tree misshapen
  resetFakeFetch();
  onRequest("GET", "/api/activities/my", ACTIVITIES);
  onRequest("GET", "/api/themes", { status: 200, body: { ok: true } });
  renderPage(MyActivitiesPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Mano veiklos" })).toBeInTheDocument();
  expect(screen.getByText("(Dar nepateikėte jokių veiklų.)")).toBeInTheDocument();
  expect(screen.queryByText("Kursas A")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("row")).toEqual([]);
  expect(requestLog()).toHaveLength(2);
});
