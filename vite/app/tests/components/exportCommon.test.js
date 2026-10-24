// -----------------------------------------------------------
//  [*] Regression — components/exportCommon.js
//
//  The rules both export pages follow when they write their
//  XLSX: every text cell fits the 32,767 characters a cell
//  holds — a longer text cut to exactly that length with a
//  "…" at its end, never through the middle of a character
//  written as two UTF-16 units — while shorter texts,
//  numbers and blanks pass untouched and the page's own rows
//  stay as they were; and the file name's stamp is the local
//  date and time, zero-padded and joined by dashes, not UTC.
//  The pages' own tests follow the same rules through a
//  mocked SheetJS; here the helpers are pinned on their own.
// -----------------------------------------------------------

import { test, expect } from "vitest";
import process from "node:process";
import { fileStamp, fitRows } from "@/components/exportCommon.js";


// The most characters an XLSX cell holds, Excel's limit
const LIMIT = 32767;







// -----------------------------------------------------------
// what fits stays as it is
// -----------------------------------------------------------
//
// A text of the limit's length or shorter, a number, a zero,
// a blank and a missing value come back unchanged, in the
// same places.
// -----------------------------------------------------------

test("cells that fit come back unchanged", () => {
  const full = "x".repeat(LIMIT);

  expect(fitRows([["Data", "Veikla"], [full, 4.5, 0, "", null, undefined]])).toEqual([
    ["Data", "Veikla"],
    [full, 4.5, 0, "", null, undefined],
  ]);
});







// -----------------------------------------------------------
// a longer text is cut to fit
// -----------------------------------------------------------
//
// One character over the limit, or thousands, and the text
// is cut to exactly the limit's length: its own beginning,
// then a "…" that tells the reader it was cut. Every row is
// cut, the header row too, and the rows the page built are
// not touched.
// -----------------------------------------------------------

test("a text longer than a cell holds is cut to the limit and ends in …", () => {
  const justOver = "a".repeat(LIMIT + 1);
  const farOver = "Aprašas. ".repeat(5000);
  const rows = [["b".repeat(40000)], ["Kursas A", justOver, farOver, 12]];

  const [[header], [title, near, far, score]] = fitRows(rows);

  expect(header).toBe(`${"b".repeat(LIMIT - 1)}…`);
  expect(title).toBe("Kursas A");
  expect(near).toHaveLength(LIMIT);
  expect(near).toBe(`${"a".repeat(LIMIT - 1)}…`);
  expect(far).toHaveLength(LIMIT);
  expect(far.endsWith("…")).toBe(true);
  expect(farOver.startsWith(far.slice(0, -1))).toBe(true);
  expect(score).toBe(12);

  expect(rows[1][1]).toBe(justOver);
  expect(rows[0][0]).toHaveLength(40000);
});







// -----------------------------------------------------------
// the cut keeps whole characters
// -----------------------------------------------------------
//
// A character written as two UTF-16 units that would straddle
// the cut goes as a whole, one unit short of the limit,
// instead of leaving its first half before the "…"; one that
// ends right at the cut stays.
// -----------------------------------------------------------

test("the cut never leaves half of a two-unit character behind", () => {
  const emoji = "😀";
  const straddling = `${"a".repeat(LIMIT - 2)}${emoji}${"a".repeat(10)}`;
  const endingAtCut = `${"a".repeat(LIMIT - 3)}${emoji}${"a".repeat(10)}`;

  const [[cutBefore, cutAfter]] = fitRows([[straddling, endingAtCut]]);

  expect(cutBefore).toBe(`${"a".repeat(LIMIT - 2)}…`);
  expect(cutBefore).toHaveLength(LIMIT - 1);
  expect(cutAfter).toBe(`${"a".repeat(LIMIT - 3)}${emoji}…`);
  expect(cutAfter).toHaveLength(LIMIT);
});







// -----------------------------------------------------------
// the file name's stamp
// -----------------------------------------------------------
//
// Year, month, day, hours, minutes and seconds of the
// browser's local clock, each zero-padded, joined by dashes.
// The test container runs in UTC, so the second test moves
// the runner's zone to Vilnius for an instant half an hour
// after midnight there — still the day before in UTC — and
// puts the zone back.
// -----------------------------------------------------------

test("the stamp is the local date and time, zero-padded and joined by dashes", () => {
  expect(fileStamp(new Date(2026, 0, 5, 7, 8, 9))).toBe("2026-01-05-07-08-09");
  expect(fileStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31-23-59-59");
});

test("the stamp follows the local zone, not UTC", () => {
  const runnerZone = process.env.TZ;
  process.env.TZ = "Europe/Vilnius";

  try {
    expect(fileStamp(new Date("2026-10-24T21:30:00Z"))).toBe("2026-10-25-00-30-00");
    expect(fileStamp(new Date("2026-03-01T10:05:00Z"))).toBe("2026-03-01-12-05-00");
  } finally {
    if (runnerZone === undefined) delete process.env.TZ;
    else process.env.TZ = runnerZone;
  }
});
