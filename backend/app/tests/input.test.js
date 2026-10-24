// -----------------------------------------------------------
//  [*] Regression — utils/input.js
//
//  The checks a request value passes before it reaches
//  Postgres or is stored as a number. An id sent in a body
//  comes back as a whole number in the int4 range or as NaN,
//  so each route refuses or ignores it; an amount comes back
//  as a finite number or as null, so nothing that is not a
//  real amount is ever stored as one.
//
//  Pinned as expected failures until they are fixed, the
//  known bugs: a decimal written out in a string too long for
//  a finite number comes back as Infinity, and an id that
//  JavaScript writes in exponent notation comes back as a
//  small, valid one.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { numberOf, parseId } from "../src/utils/input.js";







// -----------------------------------------------------------
// BUG — numberOf turns an overlong decimal into Infinity
// -----------------------------------------------------------
//
// A string passes numberOf when it spells a plain decimal,
// but the number it converts to is never checked: a decimal
// with hundreds of digits is past the largest double and
// becomes Infinity. The cap, total-sum and point-value routes
// refuse only negative numbers, so Infinity is stored in the
// NUMERIC column, which accepts it. A string must pass only
// when it converts to a finite number, as a JSON number
// already must; anything else is null.
// -----------------------------------------------------------

test(
  "BUG: numberOf: a decimal string too long for a finite number → null, not Infinity",
  { todo: "known bug: numberOf's string branch returns Number(value) with no Number.isFinite check, so a decimal string of 400 nines comes back as Infinity" },
  () => {
    assert.equal(numberOf("9".repeat(400)), null);
  }
);







// -----------------------------------------------------------
// BUG — parseId reads exponent notation as a small id
// -----------------------------------------------------------
//
// parseId promises that a value outside the int4 range comes
// back as NaN. It hands a JSON number to parseInt, which
// reads the number's text, and JavaScript writes a huge
// number or a tiny fraction in exponent notation: parseInt
// stops at the first character that is not a digit, so both
// come back as a small, valid id — a verdict sent with an
// absurd theme id moves the activity to an unrelated theme
// instead of ignoring the field. The huge number must come
// back as NaN, and the tiny fraction as zero — what any
// fraction below one gives, an id no row has — or NaN.
// -----------------------------------------------------------

test(
  "BUG: parseId: a number written in exponent notation — past int4 or a tiny fraction — never comes back as a small valid id",
  { todo: "known bug: parseId hands a JSON number to parseInt, which reads its text — \"1e+21\" as 1 and \"5e-7\" as 5 — so an out-of-range or fractional id comes back as a small valid one" },
  () => {
    assert.ok(Number.isNaN(parseId(1e21)), `parseId(1e21) returned ${parseId(1e21)}`);
    const tiny = parseId(5e-7);
    assert.ok(Number.isNaN(tiny) || tiny === 0, `parseId(5e-7) returned ${tiny}`);
  }
);
