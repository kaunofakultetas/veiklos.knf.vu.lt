// -----------------------------------------------------------
//  [*] Regression — components/api.js
//
//  The shared backend client against the scripted fetch: the
//  tab's active role travels as X-Active-Role unless a call
//  opts out, a JSON body is announced as JSON while a
//  FormData one is left to the browser, a refusal throws the
//  backend's text — else the caller's fallback, else the
//  HTTP status — a call that gets no answer at all throws the
//  fallback, else the client's own text, never the browser's
//  error, a body-less answer is fine and a 2xx that is not
//  JSON reads as {}, several calls report their refusals
//  in the order they are listed, an attachment is saved
//  under its original name, and reasonOf drops the backend's
//  leading "Klaida:". The calls go to real routes of the
//  contract, which the guard holds every request to; an
//  answer of a shape the contract does not have is scripted
//  off it.
// -----------------------------------------------------------

import { test, expect, vi } from "vitest";
import { apiJson, apiJsonAll, apiSend, downloadAttachment, reasonOf } from "@/components/api.js";
import { onRequest, requestsTo } from "../helpers/fakeFetch.js";
import { signInAs } from "../helpers/render.js";


// For answers of a shape the contract does not have
const OFF = { offContract: true };







// -----------------------------------------------------------
// requests
// -----------------------------------------------------------
//
// The role header on every call that does not opt out; a
// JSON body stringified under Content-Type; a FormData body
// passed as it is, its Content-Type left to the browser.
// -----------------------------------------------------------

test("apiJson: the role header and the answer; JSON bodies announced, forms left alone; no role when asked", async () => {
  signInAs("Vadybininkas");
  onRequest("GET", "/api/themes", [{ ok: 1 }], OFF);
  onRequest("POST", "/api/themes", { id: 7, code: "7.", title: "T" });
  onRequest("POST", "/api/activities", { id: 9 }, OFF);
  onRequest("GET", "/api/me", { name: "Jonas Jonaitis", email: "jonas@vu.lt", eid: "u1", roles: [] });

  expect(await apiJson("/api/themes")).toEqual([{ ok: 1 }]);
  expect(requestsTo("GET", "/api/themes")[0].headers).toEqual({ "x-active-role": "Vadybininkas" });

  expect(await apiJson("/api/themes", { method: "POST", json: { code: "7.", title: "T" } })).toEqual({ id: 7, code: "7.", title: "T" });
  const form = new FormData();
  form.append("title", "T");
  expect(await apiJson("/api/activities", { method: "POST", form })).toEqual({ id: 9 });
  const [asJson] = requestsTo("POST", "/api/themes");
  const [asForm] = requestsTo("POST", "/api/activities");
  expect(asJson.headers).toEqual({ "x-active-role": "Vadybininkas", "content-type": "application/json" });
  expect(asJson.body).toEqual({ code: "7.", title: "T" });
  expect(asForm.headers).toEqual({ "x-active-role": "Vadybininkas" });
  expect(asForm.body).toBe(form);

  await apiJson("/api/me", { activeRole: false });
  expect(requestsTo("GET", "/api/me")[0].headers).toEqual({});
});







// -----------------------------------------------------------
// answers
// -----------------------------------------------------------
//
// A refusal throws the backend's `error` text as it is, the
// caller's fallback when there is none, and the HTTP status
// when there is no fallback either (a body that is not JSON
// counts as none). A 204 is fine for apiSend; a 2xx body
// that is not JSON reads as {}.
// -----------------------------------------------------------

test("a refusal throws the backend's text, else the fallback, else the HTTP status", async () => {
  onRequest("GET", "/api/themes", { status: 403, body: { error: "Klaida: Nėra teisių" } });
  onRequest("GET", "/api/activities/my", { status: 500, body: {} }, OFF);
  onRequest("GET", "/api/activities/all", { status: 502, body: "<html>" });

  await expect(apiJson("/api/themes")).rejects.toThrowError(/^Klaida: Nėra teisių$/);
  await expect(apiJson("/api/activities/my", { fallback: "Nepavyko įkelti." })).rejects.toThrowError(/^Nepavyko įkelti\.$/);
  await expect(apiJson("/api/activities/all")).rejects.toThrowError(/^502\b/);
});

test("apiSend: a body-less answer is fine; apiJson reads a 2xx that is not JSON as {}", async () => {
  onRequest("DELETE", "/api/themes/5", { status: 204 });
  onRequest("GET", "/api/me", { status: 200, body: "plain" }, OFF);

  await expect(apiSend("/api/themes/5", { method: "DELETE" })).resolves.toBeUndefined();
  expect(await apiJson("/api/me")).toEqual({});
});







// -----------------------------------------------------------
// no answer at all
// -----------------------------------------------------------
//
// When fetch itself fails — no network, the backend out of
// reach — the browser's own error is English and names
// nothing a user could act on, so it never reaches the page:
// the call throws the caller's fallback, and without one the
// client's own "could not reach the server" text, with the
// browser's error kept as the cause.
// -----------------------------------------------------------

test("a fetch that fails outright throws the caller's fallback", async () => {
  onRequest("GET", "/api/themes", () => { throw new TypeError("Failed to fetch"); });

  await expect(apiJson("/api/themes", { fallback: "Klaida: Nepavyko įkelti." })).rejects.toThrowError(/^Klaida: Nepavyko įkelti\.$/);
});

test("without a fallback, a call with no answer throws the client's own text, the browser's error as its cause", async () => {
  const offline = new TypeError("Failed to fetch");
  onRequest("GET", "/api/themes", () => { throw offline; });
  onRequest("DELETE", "/api/themes/5", () => { throw offline; });

  const thrown = await apiJson("/api/themes").catch((e) => e);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown.message).toBe("Klaida: nepavyko susisiekti su serveriu.");
  expect(thrown.cause).toBe(offline);
  await expect(apiSend("/api/themes/5", { method: "DELETE" })).rejects.toThrowError(/^Klaida: nepavyko susisiekti su serveriu\.$/);
  expect(reasonOf(thrown)).toBe("nepavyko susisiekti su serveriu.");
});







// -----------------------------------------------------------
// several calls at once
// -----------------------------------------------------------
//
// apiJsonAll starts the calls together and answers in the
// order they are listed; when more than one is refused, the
// first one listed is what throws, even when it is the last
// to answer — the order a page checks its loads in.
// -----------------------------------------------------------

test("apiJsonAll: answers in order; of two refusals the first listed throws, whichever answers first", async () => {
  onRequest("GET", "/api/themes", [1], OFF);
  onRequest("GET", "/api/activities/my", [2], OFF);
  onRequest("GET", "/api/activities/pending", () => new Promise((r) => setTimeout(() => r({ status: 500, body: { error: "pirma" } }), 30)));
  onRequest("GET", "/api/activities/all", { status: 500, body: { error: "antra" } });

  expect(await apiJsonAll([["/api/themes"], ["/api/activities/my"]])).toEqual([[1], [2]]);
  await expect(apiJsonAll([["/api/activities/pending"], ["/api/activities/all"]])).rejects.toThrowError(/^pirma$/);
});







// -----------------------------------------------------------
// attachments
// -----------------------------------------------------------
//
// The file is fetched with the role header and saved through
// a temporary link under its original name ("priedas" when
// there is none); a refusal throws the backend's text.
// jsdom has no createObjectURL, so it is stubbed and the
// link's click caught.
// -----------------------------------------------------------

test("downloadAttachment: fetched with the role header, saved under its original name; a refusal throws", async () => {
  signInAs("Komisijos narys");
  Object.defineProperty(window.URL, "createObjectURL", { value: vi.fn(() => "blob:fake"), configurable: true, writable: true });
  Object.defineProperty(window.URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
  const saved = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    saved.push(this.download);
  });
  onRequest("GET", "/api/activities/7/attachment", { status: 200, body: new Blob(["turinys"]) });
  onRequest("GET", "/api/activities/8/attachment", { status: 200, body: new Blob(["turinys"]) });
  onRequest("GET", "/api/activities/9/attachment", { status: 404, body: { error: "Klaida: Nėra priedo" } });

  try {
    await downloadAttachment({ id: 7, attachment_original_name: "Ataskaita.pdf" });
    await downloadAttachment({ id: 8, attachment_original_name: null });
    expect(saved).toEqual(["Ataskaita.pdf", "priedas"]);
    expect(requestsTo("GET", "/api/activities/7/attachment")[0].headers).toEqual({ "x-active-role": "Komisijos narys" });
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");

    await expect(downloadAttachment({ id: 9 })).rejects.toThrowError(/^Klaida: Nėra priedo$/);
  } finally {
    delete window.URL.createObjectURL;
    delete window.URL.revokeObjectURL;
  }
});







// -----------------------------------------------------------
// reasonOf
// -----------------------------------------------------------
//
// The backend starts most refusals with "Klaida:"; a page
// that wraps one in its own "Klaida: …" sentence needs the
// reason alone. Texts without the word stay as they are.
// -----------------------------------------------------------

test("reasonOf: the backend's leading Klaida: goes, anything else stays", () => {
  expect(reasonOf(new Error("Klaida: Nėra priedo"))).toBe("Nėra priedo");
  expect(reasonOf(new Error("Neteisingas įvertinimas"))).toBe("Neteisingas įvertinimas");
  expect(reasonOf(new Error("500 Internal Server Error"))).toBe("500 Internal Server Error");
});
