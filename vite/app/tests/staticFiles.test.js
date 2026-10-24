// -----------------------------------------------------------
//  [*] Regression — index.html and the stylesheets
//
//  Facts that live in files no component test sees: the
//  language index.html declares for the page, and how the
//  stylesheets layer the session-expired notice against the
//  dialogs the pages open. vitest applies no CSS (css:
//  false), so the stacking order is read from the .css files
//  under src/; the notice's own classes are taken from the
//  notice as it renders, so the check follows whichever
//  classes it carries.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createElement } from "react";
import { render, screen, act } from "@testing-library/react";
import SessionExpired from "@/components/sessionExpired.jsx";
import { onRequest } from "./helpers/fakeFetch.js";


// vitest runs from the app root, so index.html and src/ are
// right there
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

// The rules of every stylesheet under src/, comments dropped,
// each as its selectors and its declarations' text
const RULES = fs.readdirSync(SRC, { recursive: true })
  .filter((file) => file.endsWith(".css"))
  .flatMap((file) => {
    const css = fs.readFileSync(path.join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
      selectors: selectors.split(",").map((s) => s.trim()),
      body,
    }));
  });







// -----------------------------------------------------------
// zIndexOf
// -----------------------------------------------------------
//
// The z-index the stylesheets give an element carrying these
// classes: the highest one set by a rule whose selector is
// made of the element's classes alone, or nothing when no
// such rule sets one.
//
// Used by:
//   - the layering test (below)
// -----------------------------------------------------------

function zIndexOf(classes) {
  const ownSelector = (s) => /^(\.[\w-]+)+$/.test(s) && s.slice(1).split(".").every((c) => classes.includes(c));
  const values = RULES
    .filter((rule) => rule.selectors.some(ownSelector))
    .map((rule) => /(?:^|[\s;])z-index\s*:\s*(-?\d+)/.exec(rule.body)?.[1])
    .filter((z) => z !== undefined)
    .map(Number);
  return values.length ? Math.max(...values) : undefined;
}







// -----------------------------------------------------------
// the page's language
// -----------------------------------------------------------
//
// Every text of the interface is Lithuanian, and index.html
// declares the page so: screen readers read it with
// Lithuanian pronunciation, and Firefox, which reads a
// number field by the page's language, takes a decimal comma
// typed into the committee's sums and caps as a number.
// -----------------------------------------------------------

test("index.html declares the page Lithuanian", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  expect(/<html\b[^>]*\slang="([^"]*)"/i.exec(html)?.[1]).toBe("lt");
});







// -----------------------------------------------------------
// the session-expired notice above the page dialogs
// -----------------------------------------------------------
//
// The notice that the session has ended is layered above the
// dialogs the pages open to view, review, evaluate or comment
// on an activity. When the eight-hour limit passes while one
// of them is open, the notice shows over it: hidden behind
// it, the notice could only be reached by a click outside
// the dialog, which closes the dialog and throws away what
// was typed in it — the very loss the notice exists to
// prevent.
// -----------------------------------------------------------

test("the session-expired notice is layered above the page dialogs", async () => {
  onRequest("GET", "/api/me", { status: 401, body: { error: "Neprisijungta" } });
  render(createElement(SessionExpired));
  await act(() => window.fetch("/api/me"));
  const backdrop = screen.getByRole("dialog", { name: "Prisijungimo sesija baigėsi" }).parentElement;

  expect(zIndexOf([...backdrop.classList])).toBeGreaterThan(zIndexOf(["employee-modal-backdrop"]));
});
