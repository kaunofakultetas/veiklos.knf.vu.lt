// -----------------------------------------------------------
//  [*] Regression — pages/manager/themes.jsx
//
//  The theme administration page against the scripted fetch:
//  the tree loads with X-Active-Role only (Content-Type
//  travels only with a body), themes collapse and expand one
//  by one or all at once with their subthemes in code order,
//  the two creation forms stay disabled until filled and POST
//  their exact bodies, the two delete buttons ask their exact
//  confirms and DELETE, every successful change reloads the
//  tree (collapsing it — except the parent of a new
//  subtheme), and backend errors are shown verbatim without a
//  reload.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import ThemesPage from "@/pages/manager/themes.jsx";
import { onRequest, requestsTo, requestLog } from "../../helpers/fakeFetch.js";
import { renderPage, signInAs } from "../../helpers/render.js";


// Two themes: the first with three subthemes listed out of
// code order (6.1.10. first), one of them described; the
// second with none
const THEMES = [
  { id: 1, code: "6.1.", title: "Studijų kokybė", subthemes: [
    { id: 13, code: "6.1.10.", title: "Konsultacijos", description: null },
    { id: 12, code: "6.1.2.", title: "Seminarai", description: "Seminarų vedimas" },
    { id: 11, code: "6.1.1.", title: "Paskaitos", description: null },
  ] },
  { id: 2, code: "6.2.", title: "Mokslas", subthemes: [] },
];

const HEADER_ONLY = { "x-active-role": "Vadybininkas" };
const WITH_BODY = { "x-active-role": "Vadybininkas", "content-type": "application/json" };

// A theme's toggle button and its whole item (row + subthemes)
const themeToggle = (title) => screen.getByText(title).closest("button");
const themeItem = (title) => screen.getByText(title).closest(".theme-item");

// A subtheme's line, by its title
const subthemeRow = (title) => screen.getByText(title).closest(".theme-subtheme-row");

// The subtheme codes shown under a theme, in DOM order
const subthemeCodes = (title) => within(themeItem(title)).getAllByText(/^6\.\d+\.\d+\.$/).map((e) => e.textContent);

// The creation inputs — "Pavadinimas" is the placeholder of
// both title fields, theme first
const themeCode = () => screen.getByPlaceholderText("pvz. 6.1.");
const themeTitle = () => screen.getAllByPlaceholderText("Pavadinimas")[0];
const subCode = () => screen.getByPlaceholderText("pvz. 6.1.1.");
const subTitle = () => screen.getAllByPlaceholderText("Pavadinimas")[1];
const subDescription = () => screen.getByPlaceholderText("Aprašymas");

// Script GET /api/themes to answer from a mutable tree, so a
// reload after a mutation sees the change
function scriptTree(initial = THEMES) {
  signInAs("Vadybininkas");
  const state = { tree: initial };
  onRequest("GET", "/api/themes", () => state.tree);
  return state;
}

// Wait for the first load to land: the subtheme form's parent
// picker shows the first theme
const loaded = () => screen.findByRole("button", { name: /^6\.1\. — Studijų kokybė/ });







// -----------------------------------------------------------
// load
// -----------------------------------------------------------
//
// One GET with the header only; both form headings, the tree
// heading and its two buttons; every theme collapsed with its
// code, title and subtheme count; the parent picker seeded
// with the first theme; both create buttons disabled.
// -----------------------------------------------------------

test("loads the tree with X-Active-Role only and renders it collapsed", async () => {
  scriptTree();
  renderPage(ThemesPage);

  await loaded();
  expect(requestLog()).toHaveLength(1);
  expect(requestLog()[0].method).toBe("GET");
  expect(requestLog()[0].url).toBe("/api/themes");
  expect(requestLog()[0].headers).toEqual(HEADER_ONLY);

  expect(screen.getByRole("heading", { name: "Nauja tema" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Nauja potemė" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Temos ir potemės" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Išskleisti viską" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suskleisti viską" })).toBeInTheDocument();

  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "false");
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("title", "Išskleisti");
  expect(themeToggle("Studijų kokybė")).toHaveTextContent("▸");
  expect(within(themeToggle("Studijų kokybė")).getByText("6.1.")).toBeInTheDocument();
  expect(within(themeToggle("Studijų kokybė")).getByText("(3)")).toBeInTheDocument();
  expect(within(themeToggle("Mokslas")).getByText("(0)")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Pašalinti temą" })).toHaveLength(2);
  expect(screen.queryByText("Paskaitos")).not.toBeInTheDocument();
  expect(screen.queryByText("(potemių nėra)")).not.toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Sukurti temą" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sukurti potemę" })).toBeDisabled();
});







// -----------------------------------------------------------
// empty tree
// -----------------------------------------------------------
//
// No themes: "(temų nėra)", the parent picker on its
// placeholder, and Sukurti potemę stays disabled even with a
// code and title because there is no parent to pick.
// -----------------------------------------------------------

test("an empty tree shows (temų nėra) and keeps Sukurti potemę disabled for lack of a parent", async () => {
  scriptTree([]);
  const { user } = renderPage(ThemesPage);

  expect(await screen.findByText("(temų nėra)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Pasirinkite temą/ })).toBeInTheDocument();

  await user.type(subCode(), "6.1.1.");
  await user.type(subTitle(), "Paskaitos");
  expect(screen.getByRole("button", { name: "Sukurti potemę" })).toBeDisabled();
  await user.type(themeCode(), "6.1.");
  await user.type(themeTitle(), "Studijų kokybė");
  expect(screen.getByRole("button", { name: "Sukurti temą" })).toBeEnabled();
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// load error
// -----------------------------------------------------------
//
// A refused load shows the backend's text verbatim and an
// empty tree.
// -----------------------------------------------------------

test("a refused load shows the backend's text verbatim", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/themes", { status: 500, body: { error: "internal error" } });
  renderPage(ThemesPage);

  expect(await screen.findByText("internal error")).toBeInTheDocument();
  expect(screen.getByText("(temų nėra)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pašalinti temą" })).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// expand / collapse
// -----------------------------------------------------------
//
// A theme's toggle flips aria-expanded and its title and
// lists the subthemes in code order (6.1.1., 6.1.2., 6.1.10.)
// with "— description" where there is one; a theme without
// subthemes shows "(potemių nėra)"; Išskleisti viską /
// Suskleisti viską act on every theme at once.
// -----------------------------------------------------------

test("expand and collapse: per theme and all at once, subthemes in code order, (potemių nėra)", async () => {
  scriptTree();
  const { user } = renderPage(ThemesPage);
  await loaded();

  await user.click(themeToggle("Studijų kokybė"));
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "true");
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("title", "Suskleisti");
  expect(themeToggle("Studijų kokybė")).toHaveTextContent("▾");
  expect(subthemeCodes("Studijų kokybė")).toEqual(["6.1.1.", "6.1.2.", "6.1.10."]);
  expect(within(subthemeRow("Seminarai")).getByText("— Seminarų vedimas")).toBeInTheDocument();
  expect(within(subthemeRow("Paskaitos")).queryByText(/^—/)).not.toBeInTheDocument();
  expect(within(themeItem("Studijų kokybė")).getAllByRole("button", { name: "Pašalinti" })).toHaveLength(3);
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "false");

  await user.click(themeToggle("Mokslas"));
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "true");
  expect(within(themeItem("Mokslas")).getByText("(potemių nėra)")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Suskleisti viską" }));
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "false");
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Paskaitos")).not.toBeInTheDocument();
  expect(screen.queryByText("(potemių nėra)")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Išskleisti viską" }));
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "true");
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Paskaitos")).toBeInTheDocument();
  expect(screen.getByText("(potemių nėra)")).toBeInTheDocument();

  await user.click(themeToggle("Studijų kokybė"));
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "false");
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "true");
  expect(requestLog()).toHaveLength(1);
});







// -----------------------------------------------------------
// create theme
// -----------------------------------------------------------
//
// Sukurti temą is disabled until both fields are filled, then
// POSTs { code, title } with both headers; the tree reloads
// (a second GET), the new theme shows, the fields clear and
// "Tema sukurta." confirms.
// -----------------------------------------------------------

test("create theme: disabled until filled, POST { code, title }, reload, fields cleared, Tema sukurta.", async () => {
  const state = scriptTree();
  onRequest("POST", "/api/themes", (req) => {
    state.tree = [...THEMES, { id: 3, code: req.body.code, title: req.body.title, subthemes: [] }];
    return { id: 3, ...req.body };
  });
  const { user } = renderPage(ThemesPage);
  await loaded();

  const button = screen.getByRole("button", { name: "Sukurti temą" });
  await user.type(themeCode(), "6.3.");
  expect(button).toBeDisabled();
  await user.type(themeTitle(), "Bendruomenė");
  expect(button).toBeEnabled();
  await user.click(button);

  await screen.findByText("Tema sukurta.");
  const [post] = requestsTo("POST", "/api/themes");
  expect(post.headers).toEqual(WITH_BODY);
  expect(post.body).toEqual({ code: "6.3.", title: "Bendruomenė" });
  expect(requestsTo("GET", "/api/themes")).toHaveLength(2);
  expect(requestsTo("GET", "/api/themes")[1].headers).toEqual(HEADER_ONLY);
  expect(themeToggle("Bendruomenė")).toHaveAttribute("aria-expanded", "false");
  expect(within(themeToggle("Bendruomenė")).getByText("6.3.")).toBeInTheDocument();
  expect(themeCode().value).toBe("");
  expect(themeTitle().value).toBe("");
  expect(screen.getByRole("button", { name: "Sukurti temą" })).toBeDisabled();
});







// -----------------------------------------------------------
// create subtheme — chosen parent, no description
// -----------------------------------------------------------
//
// The parent picker lists "code — title" per theme; with a
// parent, a code and a title (the description is optional
// despite its asterisk) Sukurti potemę POSTs { code, title,
// description: null } to /api/themes/:parent/subthemes; the
// tree reloads with only that parent expanded, the new line
// shows, the three own fields clear while the parent stays.
// -----------------------------------------------------------

test("create subtheme: parent picked, POST { code, title, description: null }, reload with the parent expanded", async () => {
  const state = scriptTree();
  onRequest("POST", "/api/themes/2/subthemes", (req) => {
    state.tree = [THEMES[0], { ...THEMES[1], subthemes: [{ id: 21, ...req.body }] }];
    return { id: 21, ...req.body };
  });
  const { user } = renderPage(ThemesPage);
  await loaded();
  await user.click(screen.getByRole("button", { name: "Išskleisti viską" }));

  await user.click(screen.getByRole("button", { name: /^6\.1\. — Studijų kokybė/ }));
  expect(screen.getByRole("button", { name: "6.1. — Studijų kokybė" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "6.2. — Mokslas" }));
  expect(screen.getByRole("button", { name: /^6\.2\. — Mokslas/ })).toBeInTheDocument();

  const button = screen.getByRole("button", { name: "Sukurti potemę" });
  await user.type(subCode(), "6.2.1.");
  expect(button).toBeDisabled();
  await user.type(subTitle(), "Projektai");
  expect(button).toBeEnabled();
  await user.click(button);

  await screen.findByText("Potemė sukurta.");
  const [post] = requestsTo("POST", "/api/themes/2/subthemes");
  expect(post.headers).toEqual(WITH_BODY);
  expect(post.body).toEqual({ code: "6.2.1.", title: "Projektai", description: null });
  expect(requestsTo("GET", "/api/themes")).toHaveLength(2);
  expect(themeToggle("Mokslas")).toHaveAttribute("aria-expanded", "true");
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "false");
  expect(within(themeToggle("Mokslas")).getByText("(1)")).toBeInTheDocument();
  expect(subthemeCodes("Mokslas")).toEqual(["6.2.1."]);
  expect(within(subthemeRow("Projektai")).getByRole("button", { name: "Pašalinti" })).toBeInTheDocument();
  expect(subCode().value).toBe("");
  expect(subTitle().value).toBe("");
  expect(screen.getByRole("button", { name: /^6\.2\. — Mokslas/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sukurti potemę" })).toBeDisabled();
});







// -----------------------------------------------------------
// create subtheme — default parent, with description
// -----------------------------------------------------------
//
// Without touching the picker the parent is the first theme;
// a typed description travels as is and renders as
// "— description" after the reload, in code order.
// -----------------------------------------------------------

test("create subtheme under the seeded parent with a description", async () => {
  const state = scriptTree();
  onRequest("POST", "/api/themes/1/subthemes", (req) => {
    state.tree = [{ ...THEMES[0], subthemes: [...THEMES[0].subthemes, { id: 14, ...req.body }] }, THEMES[1]];
    return { id: 14, ...req.body };
  });
  const { user } = renderPage(ThemesPage);
  await loaded();

  await user.type(subCode(), "6.1.3.");
  await user.type(subTitle(), "Egzaminai");
  await user.type(subDescription(), "Egzaminų vertinimas");
  await user.click(screen.getByRole("button", { name: "Sukurti potemę" }));

  await screen.findByText("Potemė sukurta.");
  const [post] = requestsTo("POST", "/api/themes/1/subthemes");
  expect(post.body).toEqual({ code: "6.1.3.", title: "Egzaminai", description: "Egzaminų vertinimas" });
  expect(requestsTo("GET", "/api/themes")).toHaveLength(2);
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "true");
  expect(subthemeCodes("Studijų kokybė")).toEqual(["6.1.1.", "6.1.2.", "6.1.3.", "6.1.10."]);
  expect(within(subthemeRow("Egzaminai")).getByText("— Egzaminų vertinimas")).toBeInTheDocument();
  expect(subDescription().value).toBe("");
});







// -----------------------------------------------------------
// delete theme
// -----------------------------------------------------------
//
// Pašalinti temą asks the exact confirm; cancel sends nothing
// and reloads nothing. OK DELETEs /api/themes/:id with the
// header only, a 204 reloads the tree, the theme is gone and
// "Tema pašalinta." confirms.
// -----------------------------------------------------------

test("delete theme: confirm text, cancel sends nothing, DELETE /api/themes/:id, reload, Tema pašalinta.", async () => {
  const state = scriptTree();
  onRequest("DELETE", "/api/themes/2", () => {
    state.tree = [THEMES[0]];
    return { status: 204 };
  });
  const { user } = renderPage(ThemesPage);
  await loaded();

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(themeItem("Mokslas")).getByRole("button", { name: "Pašalinti temą" }));
  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai pašalinti šią temą ir visas potemes?");
  expect(requestLog()).toHaveLength(1);
  expect(screen.getByText("Mokslas")).toBeInTheDocument();

  await user.click(within(themeItem("Mokslas")).getByRole("button", { name: "Pašalinti temą" }));
  await screen.findByText("Tema pašalinta.");
  expect(window.confirm).toHaveBeenCalledTimes(2);
  const [del] = requestsTo("DELETE", "/api/themes/2");
  expect(del.headers).toEqual(HEADER_ONLY);
  expect(del.body).toBeNull();
  expect(requestsTo("GET", "/api/themes")).toHaveLength(2);
  expect(screen.queryByText("Mokslas")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Pašalinti temą" })).toHaveLength(1);
});







// -----------------------------------------------------------
// delete subtheme
// -----------------------------------------------------------
//
// A subtheme's Pašalinti asks its own confirm; cancel sends
// nothing. OK DELETEs /api/themes/subthemes/:id, the reload
// collapses the tree again, and expanding the parent shows the
// line gone.
// -----------------------------------------------------------

test("delete subtheme: confirm text, cancel sends nothing, DELETE /api/themes/subthemes/:id, reload collapses", async () => {
  const state = scriptTree();
  onRequest("DELETE", "/api/themes/subthemes/11", () => {
    state.tree = [{ ...THEMES[0], subthemes: THEMES[0].subthemes.filter((s) => s.id !== 11) }, THEMES[1]];
    return { status: 204 };
  });
  const { user } = renderPage(ThemesPage);
  await loaded();
  await user.click(themeToggle("Studijų kokybė"));

  window.confirm.mockReturnValueOnce(false);
  await user.click(within(subthemeRow("Paskaitos")).getByRole("button", { name: "Pašalinti" }));
  expect(window.confirm).toHaveBeenCalledWith("Ar tikrai pašalinti šią potemę?");
  expect(requestLog()).toHaveLength(1);
  expect(screen.getByText("Paskaitos")).toBeInTheDocument();

  await user.click(within(subthemeRow("Paskaitos")).getByRole("button", { name: "Pašalinti" }));
  await screen.findByText("Potemė pašalinta.");
  const [del] = requestsTo("DELETE", "/api/themes/subthemes/11");
  expect(del.headers).toEqual(HEADER_ONLY);
  expect(requestsTo("GET", "/api/themes")).toHaveLength(2);
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "false");
  expect(within(themeToggle("Studijų kokybė")).getByText("(2)")).toBeInTheDocument();

  await user.click(themeToggle("Studijų kokybė"));
  expect(subthemeCodes("Studijų kokybė")).toEqual(["6.1.2.", "6.1.10."]);
  expect(screen.queryByText("Paskaitos")).not.toBeInTheDocument();
});







// -----------------------------------------------------------
// create errors
// -----------------------------------------------------------
//
// A refused POST shows the backend's text verbatim, reloads
// nothing and keeps what was typed (the fields clear only
// after success) — for both forms.
// -----------------------------------------------------------

test("refused creates show the backend's reason, reload nothing and keep the fields", async () => {
  scriptTree();
  onRequest("POST", "/api/themes", { status: 409, body: { error: "Klaida: Toks kodas jau yra" } });
  onRequest("POST", "/api/themes/1/subthemes", { status: 400, body: { error: "Klaida: Neteisingas potemės kodas" } });
  const { user } = renderPage(ThemesPage);
  await loaded();

  await user.type(themeCode(), "6.1.");
  await user.type(themeTitle(), "Dublikatas");
  await user.click(screen.getByRole("button", { name: "Sukurti temą" }));
  expect(await screen.findByText("Klaida: Toks kodas jau yra")).toBeInTheDocument();
  expect(requestsTo("POST", "/api/themes")[0].body).toEqual({ code: "6.1.", title: "Dublikatas" });
  expect(themeCode().value).toBe("6.1.");
  expect(themeTitle().value).toBe("Dublikatas");
  expect(screen.queryByText("Tema sukurta.")).not.toBeInTheDocument();

  await user.type(subCode(), "x");
  await user.type(subTitle(), "Bloga");
  await user.click(screen.getByRole("button", { name: "Sukurti potemę" }));
  expect(await screen.findByText("Klaida: Neteisingas potemės kodas")).toBeInTheDocument();
  expect(requestsTo("POST", "/api/themes/1/subthemes")[0].body).toEqual({ code: "x", title: "Bloga", description: null });
  expect(subCode().value).toBe("x");
  expect(subTitle().value).toBe("Bloga");
  expect(screen.queryByText("Klaida: Toks kodas jau yra")).not.toBeInTheDocument();
  expect(requestsTo("GET", "/api/themes")).toHaveLength(1);
});







// -----------------------------------------------------------
// delete errors
// -----------------------------------------------------------
//
// A refused DELETE shows the backend's text verbatim, reloads
// nothing and leaves the tree as it was.
// -----------------------------------------------------------

test("refused deletes show the backend's reason and reload nothing", async () => {
  scriptTree();
  onRequest("DELETE", "/api/themes/1", { status: 409, body: { error: "Klaida: Tema turi veiklų" } });
  onRequest("DELETE", "/api/themes/subthemes/12", { status: 409, body: { error: "Klaida: Potemė turi veiklų" } });
  const { user } = renderPage(ThemesPage);
  await loaded();

  await user.click(within(themeItem("Studijų kokybė")).getByRole("button", { name: "Pašalinti temą" }));
  expect(await screen.findByText("Klaida: Tema turi veiklų")).toBeInTheDocument();
  expect(requestsTo("DELETE", "/api/themes/1")).toHaveLength(1);
  expect(screen.getByText("Studijų kokybė")).toBeInTheDocument();

  await user.click(themeToggle("Studijų kokybė"));
  await user.click(within(subthemeRow("Seminarai")).getByRole("button", { name: "Pašalinti" }));
  expect(await screen.findByText("Klaida: Potemė turi veiklų")).toBeInTheDocument();
  expect(requestsTo("DELETE", "/api/themes/subthemes/12")).toHaveLength(1);
  expect(screen.getByText("Seminarai")).toBeInTheDocument();
  expect(themeToggle("Studijų kokybė")).toHaveAttribute("aria-expanded", "true");
  expect(requestsTo("GET", "/api/themes")).toHaveLength(1);
  expect(window.confirm).toHaveBeenCalledTimes(2);
});







// -----------------------------------------------------------
// unexpected body
// -----------------------------------------------------------
//
// A 200 whose body is an object instead of the tree array is
// refused with one message in the status line: the tree
// heading stays, "(temų nėra)" shows with no delete buttons,
// the parent picker sits on its placeholder, nothing blanks.
// -----------------------------------------------------------

test("a 200 whose body is not an array shows one message and keeps the page", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/themes", { status: 200, body: { ok: true } });
  renderPage(ThemesPage);

  expect(await screen.findByText("Klaida: netikėtas serverio atsakymas.")).toHaveClass("form-status");
  expect(screen.getByRole("heading", { name: "Temos ir potemės" })).toBeInTheDocument();
  expect(screen.getByText("(temų nėra)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pašalinti temą" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Pasirinkite temą/ })).toBeInTheDocument();
  expect(requestLog()).toHaveLength(1);
});
