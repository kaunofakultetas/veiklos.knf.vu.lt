// -----------------------------------------------------------
//  [*] Regression — pages/employee/newActivity.jsx
//
//  The new-activity form against the scripted fetch: the
//  theme tree is loaded with the employee's X-Active-Role and
//  the first theme + its first subtheme are preselected, a
//  theme switch re-sorts and preselects the subthemes, the
//  submit POSTs multipart with the fields in the documented
//  order (codes before the attachment) and only the role
//  header, a success resets the text fields and the file but
//  keeps the selection, the client refuses empty required
//  fields and oversized picks without a request, and backend
//  errors are shown with the page's own prefix.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import NewActivityPage from "@/pages/employee/newActivity.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Two themes: one whose subthemes arrive out of numeric order
// ("1.10." before "1.2.") so the sort is visible, one without
// subthemes
const THEMES = [
  { id: 1, code: "1.", title: "Studijos", subthemes: [
    { id: 11, code: "1.10.", title: "Dešimta potemė", description: "Dešimtos potemės aprašymas" },
    { id: 12, code: "1.2.", title: "Antra potemė", description: "" },
  ] },
  { id: 2, code: "2.", title: "Mokslas", subthemes: [] },
];

const ATTACHMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp";

// The two AppSelect triggers (theme, subtheme), the open
// dropdown, the file input and the text fields — labels are
// not linked to their inputs, so placeholders and classes
// do the finding
const triggers = () => [...document.querySelectorAll(".app-select-trigger")];
const dropdown = () => document.querySelector(".app-select-dropdown");
const fileInput = () => document.querySelector('input[type="file"]');
const titleInput = () => screen.getByPlaceholderText("Įveskite veiklos pavadinimą");
const descriptionInput = () => screen.getByPlaceholderText("Aprašykite veiklą");
const submitButton = () => screen.getByRole("button", { name: "Pateikti veiklą" });

// The theme load has finished once the loading line is gone
const themesLoaded = () => waitFor(() => expect(screen.queryByText("Kraunamos temos…")).not.toBeInTheDocument());







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// One GET with the header; the first theme and its FIRST
// subtheme in API order (not the sorted one) are preselected,
// the subtheme's description fills the info box, the text
// fields start empty and the submit is enabled.
// -----------------------------------------------------------

test("loads the tree with X-Active-Role and preselects the first theme and subtheme", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  renderPage(NewActivityPage);

  expect(await screen.findByRole("heading", { name: "Nauja veikla" })).toBeInTheDocument();
  expect(screen.getByText("Užpildykite formą, kad pateikti naują veiklą vertinimui.")).toBeInTheDocument();
  await themesLoaded();
  expect(requestLog()).toHaveLength(1);
  expect(requestsTo("GET", "/api/themes")[0].headers).toEqual({ "x-active-role": "Darbuotojas" });

  const [theme, subtheme] = triggers();
  expect(theme).toHaveTextContent("1. — Studijos");
  expect(theme).toBeEnabled();
  expect(subtheme).toHaveTextContent("1.10. — Dešimta potemė");
  expect(subtheme).toBeEnabled();
  expect(screen.getByText("Dešimtos potemės aprašymas")).toBeInTheDocument();

  expect(titleInput()).toHaveValue("");
  expect(descriptionInput()).toHaveValue("");
  expect(fileInput()).toHaveAttribute("accept", ATTACHMENT_ACCEPT);
  expect(screen.queryByText(/Pasirinktas failas:/)).not.toBeInTheDocument();
  expect(submitButton()).toBeEnabled();
});







// -----------------------------------------------------------
// pickers
// -----------------------------------------------------------
//
// Switching to a theme without subthemes disables the
// subtheme picker with "(potemių nėra)" and empties the
// description box; switching back preselects the SORTED
// first subtheme ("1.2." before "1.10."), and the dropdown
// lists them in that order.
// -----------------------------------------------------------

test("a theme switch re-sorts the subthemes and preselects the first; none → disabled picker", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  await user.click(triggers()[0]);
  await user.click(within(dropdown()).getByRole("button", { name: "2. — Mokslas" }));
  expect(dropdown()).toBeNull();
  expect(triggers()[0]).toHaveTextContent("2. — Mokslas");
  expect(triggers()[1]).toHaveTextContent("(potemių nėra)");
  expect(triggers()[1]).toBeDisabled();
  expect(screen.getByText("(aprašymas nenurodytas)")).toBeInTheDocument();

  await user.click(triggers()[0]);
  await user.click(within(dropdown()).getByRole("button", { name: "1. — Studijos" }));
  expect(triggers()[1]).toHaveTextContent("1.2. — Antra potemė");
  expect(triggers()[1]).toBeEnabled();
  expect(screen.getByText("(aprašymas nenurodytas)")).toBeInTheDocument();

  await user.click(triggers()[1]);
  expect(within(dropdown()).getAllByRole("button").map((b) => b.textContent)).toEqual([
    "1.2. — Antra potemė",
    "1.10. — Dešimta potemė",
  ]);
  await user.click(within(dropdown()).getByRole("button", { name: "1.10. — Dešimta potemė" }));
  expect(triggers()[1]).toHaveTextContent("1.10. — Dešimta potemė");
  expect(screen.getByText("Dešimtos potemės aprašymas")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// submit
// -----------------------------------------------------------
//
// A filled form POSTs a FormData with theme_id, subtheme_id,
// title, description, theme_code, subtheme_code in that
// order and only the role header (the browser sets the
// multipart content-type); the success message shows, the
// text fields reset and the selection survives.
// -----------------------------------------------------------

test("submits multipart with the fields in order and only the role header; resets the text fields", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("POST", "/api/activities", { status: 200, body: { id: 7, status: "PATEIKTA" } });
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  await user.type(titleInput(), "Konferencija");
  await user.type(descriptionInput(), "Pranešimas konferencijoje");
  await user.click(submitButton());

  expect(await screen.findByText("Veikla sėkmingai pateikta.")).toBeInTheDocument();
  const [post] = requestsTo("POST", "/api/activities");
  expect(post.headers).toEqual({ "x-active-role": "Darbuotojas" });
  expect(post.body).toBeInstanceOf(FormData);
  expect([...post.body.entries()]).toEqual([
    ["theme_id", "1"],
    ["subtheme_id", "11"],
    ["title", "Konferencija"],
    ["description", "Pranešimas konferencijoje"],
    ["theme_code", "1."],
    ["subtheme_code", "1.10."],
  ]);

  expect(titleInput()).toHaveValue("");
  expect(descriptionInput()).toHaveValue("");
  expect(triggers()[0]).toHaveTextContent("1. — Studijos");
  expect(triggers()[1]).toHaveTextContent("1.10. — Dešimta potemė");
  expect(submitButton()).toBeEnabled();
  expect(requestLog()).toHaveLength(2);
});







// -----------------------------------------------------------
// attachment
// -----------------------------------------------------------
//
// A picked file is named under the input and travels LAST in
// the FormData, after the codes, as a File with its name and
// type; the chosen subtheme's id and code go along; after the
// submit the pick is gone and the input is empty.
// -----------------------------------------------------------

test("an attachment is appended after the codes and cleared after a successful submit", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("POST", "/api/activities", { status: 200, body: { id: 8, status: "PATEIKTA" } });
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  const file = new File(["%PDF-1.4"], "ataskaita.pdf", { type: "application/pdf" });
  await user.upload(fileInput(), file);
  expect(screen.getByText("Pasirinktas failas: ataskaita.pdf")).toBeInTheDocument();

  await user.click(triggers()[1]);
  await user.click(within(dropdown()).getByRole("button", { name: "1.2. — Antra potemė" }));
  await user.type(titleInput(), "Seminaras");
  await user.type(descriptionInput(), "Seminaro aprašymas");
  await user.click(submitButton());

  expect(await screen.findByText("Veikla sėkmingai pateikta.")).toBeInTheDocument();
  const [post] = requestsTo("POST", "/api/activities");
  expect(post.headers).toEqual({ "x-active-role": "Darbuotojas" });
  const entries = [...post.body.entries()];
  expect(entries.map(([name]) => name)).toEqual([
    "theme_id", "subtheme_id", "title", "description", "theme_code", "subtheme_code", "attachment",
  ]);
  expect(entries.slice(0, 6)).toEqual([
    ["theme_id", "1"],
    ["subtheme_id", "12"],
    ["title", "Seminaras"],
    ["description", "Seminaro aprašymas"],
    ["theme_code", "1."],
    ["subtheme_code", "1.2."],
  ]);
  const sent = post.body.get("attachment");
  expect(sent).toBeInstanceOf(File);
  expect(sent.name).toBe("ataskaita.pdf");
  expect(sent.type).toBe("application/pdf");

  expect(screen.queryByText(/Pasirinktas failas:/)).not.toBeInTheDocument();
  expect(fileInput().value).toBe("");
  expect(fileInput().files).toHaveLength(0);
  expect(triggers()[1]).toHaveTextContent("1.2. — Antra potemė");
});







// -----------------------------------------------------------
// validation
// -----------------------------------------------------------
//
// A missing title or a whitespace-only description is refused
// with the form's one message and no POST; the same when the
// tree came back empty and no theme can be selected.
// -----------------------------------------------------------

test("empty required fields are refused without a request", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  await user.click(submitButton());
  expect(await screen.findByText("Klaida: Užpildykite visus privalomus laukus.")).toBeInTheDocument();

  await user.type(titleInput(), "Konferencija");
  await user.type(descriptionInput(), "   ");
  await user.click(submitButton());
  expect(await screen.findByText("Klaida: Užpildykite visus privalomus laukus.")).toBeInTheDocument();

  expect(requestsTo("POST", "/api/activities")).toEqual([]);
  expect(titleInput()).toHaveValue("Konferencija");
});

test("an empty theme tree leaves both pickers disabled and the submit refused", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", []);
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  expect(triggers()[0]).toHaveTextContent("Pasirinkite temą");
  expect(triggers()[0]).toBeDisabled();
  expect(triggers()[1]).toHaveTextContent("(potemių nėra)");
  expect(triggers()[1]).toBeDisabled();
  expect(screen.getByText("(aprašymas nenurodytas)")).toBeInTheDocument();

  await user.type(titleInput(), "Konferencija");
  await user.type(descriptionInput(), "Aprašymas");
  await user.click(submitButton());
  expect(await screen.findByText("Klaida: Užpildykite visus privalomus laukus.")).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// oversized pick
// -----------------------------------------------------------
//
// A file over 100 MB is refused at pick time with the shared
// message, nothing is named under the input and the input is
// remounted empty; a following submit goes out without an
// attachment field at all.
// -----------------------------------------------------------

test("an oversized pick is refused on the spot and never sent", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("POST", "/api/activities", { status: 200, body: { id: 9, status: "PATEIKTA" } });
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  const big = new File(["x"], "didelis.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: 100 * 1024 * 1024 + 1 });
  await user.upload(fileInput(), big);

  expect(await screen.findByText("Klaida: priedas per didelis (iki 100 MB)")).toBeInTheDocument();
  expect(screen.queryByText(/Pasirinktas failas:/)).not.toBeInTheDocument();
  expect(fileInput().files).toHaveLength(0);

  await user.type(titleInput(), "Konferencija");
  await user.type(descriptionInput(), "Aprašymas");
  await user.click(submitButton());
  expect(await screen.findByText("Veikla sėkmingai pateikta.")).toBeInTheDocument();
  const [post] = requestsTo("POST", "/api/activities");
  expect(post.body.has("attachment")).toBe(false);
  expect([...post.body.keys()]).toEqual(["theme_id", "subtheme_id", "title", "description", "theme_code", "subtheme_code"]);
});







// -----------------------------------------------------------
// errors
// -----------------------------------------------------------
//
// A refused POST shows the backend's reason behind the page's
// "Nepavyko pateikti: " prefix and keeps the draft; a failed
// theme load shows the reason verbatim and leaves the pickers
// disabled on their placeholders.
// -----------------------------------------------------------

test("a refused POST shows the prefixed reason and keeps the draft", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", THEMES);
  onRequest("POST", "/api/activities", { status: 400, body: { error: "Trūksta pavadinimo" } });
  const { user } = renderPage(NewActivityPage);
  await themesLoaded();

  await user.type(titleInput(), "Konferencija");
  await user.type(descriptionInput(), "Aprašymas");
  await user.click(submitButton());

  expect(await screen.findByText("Nepavyko pateikti: Trūksta pavadinimo")).toBeInTheDocument();
  await waitFor(() => expect(submitButton()).toBeEnabled());
  expect(titleInput()).toHaveValue("Konferencija");
  expect(descriptionInput()).toHaveValue("Aprašymas");
  expect(requestsTo("POST", "/api/activities")).toHaveLength(1);
});

test("a failed theme load shows the backend's error verbatim and disables the pickers", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", { status: 500, body: { error: "internal error" } });
  renderPage(NewActivityPage);

  expect(await screen.findByText("internal error")).toBeInTheDocument();
  await themesLoaded();
  expect(triggers()[0]).toHaveTextContent("Pasirinkite temą");
  expect(triggers()[0]).toBeDisabled();
  expect(triggers()[1]).toHaveTextContent("(potemių nėra)");
  expect(triggers()[1]).toBeDisabled();
  expect(submitButton()).toBeEnabled();
});







// -----------------------------------------------------------
// wrong shape
// -----------------------------------------------------------
//
// A 200 whose body is not the theme array (an object here)
// is refused with the page's fixed message in the status
// line instead of blanking the page on the next render; the
// pickers stay disabled on their placeholders.
// -----------------------------------------------------------

test("a non-array theme reply is refused with a clear message instead of a blank page", async () => {
  signInAs("Darbuotojas");
  onRequest("GET", "/api/themes", { status: 200, body: { ok: true } });
  renderPage(NewActivityPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  await themesLoaded();
  expect(screen.getByRole("heading", { name: "Nauja veikla" })).toBeInTheDocument();
  expect(triggers()[0]).toHaveTextContent("Pasirinkite temą");
  expect(triggers()[0]).toBeDisabled();
  expect(triggers()[1]).toHaveTextContent("(potemių nėra)");
  expect(triggers()[1]).toBeDisabled();
  expect(screen.getByText("(aprašymas nenurodytas)")).toBeInTheDocument();
  expect(submitButton()).toBeEnabled();
  expect(requestLog()).toHaveLength(1);
});
