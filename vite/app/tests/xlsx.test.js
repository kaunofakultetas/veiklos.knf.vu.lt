// -----------------------------------------------------------
//  [*] Regression — the xlsx library behind the exports
//
//  Both export pages write their XLSX with SheetJS, imported
//  by its dist path. Their page tests mock the library, so
//  the real one is pinned here: it is SheetJS's own build at
//  0.20.2 or later — npm's xlsx stops at 0.18.5, which still
//  carries both published advisories — and the calls the
//  pages make still produce a workbook whose text stays text
//  and whose scores stay numbers when it is read back.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";


// 0.20.2, the first release free of both advisories, as one
// comparable number: major·10⁶ + minor·10³ + patch
const FIXED = 20002;







// -----------------------------------------------------------
// the version
// -----------------------------------------------------------
//
// A reinstall from the npm registry, which only has 0.18.5,
// fails here.
// -----------------------------------------------------------

test("xlsx is SheetJS's own build, 0.20.2 or later", () => {
  const [major, minor, patch] = XLSX.version.split(".").map(Number);
  expect(major * 1e6 + minor * 1e3 + patch, `xlsx ${XLSX.version}`).toBeGreaterThanOrEqual(FIXED);
});







// -----------------------------------------------------------
// what the export pages write
// -----------------------------------------------------------
//
// The pages build one sheet from rows, add it to a new book
// as "Veiklos" and write it; written to bytes instead of a
// download and read back, the header is text and the score a
// number.
// -----------------------------------------------------------

test("the export pages' calls write a workbook whose scores read back as numbers", () => {
  const sheet = XLSX.utils.aoa_to_sheet([["Veikla", "Balai"], ["Paskaita", 12.5]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Veiklos");

  const back = XLSX.read(XLSX.write(book, { type: "array", bookType: "xlsx" }), { type: "array" });
  expect(back.SheetNames).toEqual(["Veiklos"]);
  expect(back.Sheets.Veiklos.A1).toMatchObject({ t: "s", v: "Veikla" });
  expect(back.Sheets.Veiklos.B2).toMatchObject({ t: "n", v: 12.5 });
});
