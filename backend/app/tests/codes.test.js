// -----------------------------------------------------------
//  [*] Regression — utils/codes.js
//
//  The order theme and subtheme codes are listed in: digit
//  runs compared by value, so section ten follows section
//  two; the text around them compared first, so the themes of
//  one family stay together — the live theme codes are a
//  family name followed by a section number, and two families
//  number their sections alike; and Lithuanian letters in the
//  order of their alphabet.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCodes } from "../src/utils/codes.js";


// The five theme codes in the live catalog, shuffled
const LIVE_THEME_CODES = [
  "STUDIJŲ KOKYBĖ 6.3.",
  "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.",
  "STUDIJŲ KOKYBĖ 6.1.",
  "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.",
  "STUDIJŲ KOKYBĖ 6.2.",
];







// -----------------------------------------------------------
// compareCodes
// -----------------------------------------------------------
//
// Sorting with it gives the order a person reads codes in.
// Comparing the numbers alone would interleave the two
// families, since both have a section 6.1 and a section 6.2;
// comparing plain text would put section ten before section
// two.
// -----------------------------------------------------------

test("digit runs compare by value", () => {
  assert.deepEqual(["6.10.", "6.2.", "6.1."].sort(compareCodes), ["6.1.", "6.2.", "6.10."]);
  assert.deepEqual(["6.1.10.", "6.1.9.", "6.1.1."].sort(compareCodes), ["6.1.1.", "6.1.9.", "6.1.10."]);
});

test("the text decides before the numbers, so a family's themes stay together", () => {
  assert.deepEqual([...LIVE_THEME_CODES].sort(compareCodes), [
    "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.1.",
    "EKSPERTINĖ VEIKLA IR KOMUNIKACIJA 6.2.",
    "STUDIJŲ KOKYBĖ 6.1.",
    "STUDIJŲ KOKYBĖ 6.2.",
    "STUDIJŲ KOKYBĖ 6.3.",
  ]);
  assert.deepEqual(["STUDIJŲ KOKYBĖ 6.10.", "STUDIJŲ KOKYBĖ 6.2."].sort(compareCodes), ["STUDIJŲ KOKYBĖ 6.2.", "STUDIJŲ KOKYBĖ 6.10."]);
});

test("Lithuanian letters keep their alphabet's order", () => {
  assert.deepEqual(["DARBAS", "ČIA", "CUKRUS"].sort(compareCodes), ["CUKRUS", "ČIA", "DARBAS"]);
});
