// -----------------------------------------------------------
//  [*] Utils — request input checks
//
//  The checks a value must pass before it reaches Postgres or
//  is stored as a number. Ids must fit the int4 columns they
//  are compared with: anything else ("abc", "1.5",
//  2147483648) is refused by Postgres itself and would
//  surface as a 500 with a stack trace in the log. Amounts
//  must be real numbers rather than whatever Number() can
//  coerce, so a blank string, a boolean, an array or a hex
//  string is not quietly stored as 0, 1 or 500.
// -----------------------------------------------------------


// The largest value an INTEGER / SERIAL column holds
const INT4_MAX = 2147483647;

// A plain decimal written out in a string: digits with an
// optional fraction, surrounding whitespace allowed
const DECIMAL_TEXT = /^\s*(\d+(\.\d*)?|\.\d+)\s*$/;







// -----------------------------------------------------------
// requireIdParam
// -----------------------------------------------------------
//
// Middleware for a route parameter that names a row by its
// int4 id: anything but a whole number in range answers the
// 404 "Klaida: Nerasta" before a query runs — such an id
// cannot name a row. Placed after the auth guards, so an
// anonymous caller still meets the 401 first, and before any
// upload middleware, so a refused id never stores a file.
//
// Used by:
//   - routes/activities.js — every /:id route
//   - routes/themes.js — every /:id and /:themeId route
// -----------------------------------------------------------

export function requireIdParam(name) {
  return (req, res, next) => {
    const value = req.params[name];
    if (/^\d{1,10}$/.test(value) && Number(value) <= INT4_MAX) return next();
    return res.status(404).json({ error: "Klaida: Nerasta" });
  };
}







// -----------------------------------------------------------
// parseId
// -----------------------------------------------------------
//
// parseInt for a theme or subtheme id sent in a body, with
// one difference: a value outside the int4 range comes back
// as NaN, so each route treats it exactly like the garbage
// parseInt already turns into NaN — refused on create and on
// the employee's edit, ignored by the verdict routes.
//
// Used by:
//   - routes/activities.js — POST /, PATCH /:id,
//     PATCH /:id/manager, PATCH /:id/committee
// -----------------------------------------------------------

export function parseId(value) {
  const n = parseInt(value, 10);
  return Math.abs(n) <= INT4_MAX ? n : NaN;
}







// -----------------------------------------------------------
// numberOf
// -----------------------------------------------------------
//
// The number a request field holds, or null when it holds
// anything else: a finite JSON number passes as it is, a
// string passes only when it spells a plain decimal. The
// committee pages always send JSON numbers; the string form
// is kept for clients that send them as text.
//
// Used by:
//   - routes/activities.js — PATCH /:id/committee (score)
//   - routes/themes.js — the cap, total-sum and pointvalue
//     PATCHes
// -----------------------------------------------------------

export function numberOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && DECIMAL_TEXT.test(value)) return Number(value);
  return null;
}
