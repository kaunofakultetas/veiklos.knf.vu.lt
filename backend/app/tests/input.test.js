// -----------------------------------------------------------
//  [*] Regression — utils/input.js
//
//  The checks a request value passes before it reaches
//  Postgres or is stored as a number. An id sent in a body
//  comes back as a whole number in the int4 range or as NaN,
//  so each route refuses or ignores it; an amount comes back
//  as a finite number or as null, so nothing that is not a
//  real amount is ever stored as one.
// -----------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { numberOf, parseId } from "../src/utils/input.js";







// -----------------------------------------------------------
// numberOf — finite numbers only
// -----------------------------------------------------------
//
// A string passes numberOf only when it spells a plain
// decimal whose value is finite: hundreds of digits make
// Infinity, which the cap, total-sum and point-value routes
// would otherwise store, as the NUMERIC column accepts it.
// -----------------------------------------------------------

test(
  "numberOf: a decimal string too long for a finite number → null, not Infinity",
  () => {
    assert.equal(numberOf("9".repeat(400)), null);
  }
);







// -----------------------------------------------------------
// parseId — a number is never read from its text
// -----------------------------------------------------------
//
// A JSON number is cut to its whole part directly rather than
// read from its text, which JavaScript writes in exponent
// notation for a huge number or a tiny fraction: a number
// past the int4 range is NaN, and a tiny fraction zero — what
// any fraction below one gives, an id no row has — never a
// small, valid id.
// -----------------------------------------------------------

test(
  "parseId: a number written in exponent notation — past int4 or a tiny fraction — never comes back as a small valid id",
  () => {
    assert.ok(Number.isNaN(parseId(1e21)), `parseId(1e21) returned ${parseId(1e21)}`);
    const tiny = parseId(5e-7);
    assert.ok(Number.isNaN(tiny) || tiny === 0, `parseId(5e-7) returned ${tiny}`);
  }
);
