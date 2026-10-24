// -----------------------------------------------------------
//  [*] Utils — database errors the request caused
//
//  A failed statement is normally our fault and answered 500.
//  Postgres refuses a few values the request itself carried:
//  text holding the NUL character, which a UTF8 text column
//  cannot store (SQLSTATE 22021), and a value too large for
//  an index entry, such as a code thousands of characters
//  long under a UNIQUE constraint (54000). Those are bad
//  input, so the routes answer them 400, all with one
//  wording, instead of logging a server failure for them.
// -----------------------------------------------------------


// The SQLSTATEs a request's own values cause
const DATA_ERRORS = new Set(["22021", "54000"]);







// -----------------------------------------------------------
// MSG_BAD_DATA
// -----------------------------------------------------------
//
// The 400's text for a value Postgres refused to store.
//
// Used by:
//   - routes/activities.js, routes/themes.js,
//     routes/userRoles.js, routes/roles.js — their catches
// -----------------------------------------------------------

export const MSG_BAD_DATA = "Klaida: Netinkami duomenys";







// -----------------------------------------------------------
// isDataError
// -----------------------------------------------------------
//
// true when a failed statement was refused for a value the
// request carried, rather than for a fault on our side.
//
// Used by:
//   - routes/activities.js, routes/themes.js,
//     routes/userRoles.js, routes/roles.js — their catches
// -----------------------------------------------------------

export function isDataError(err) {
  return DATA_ERRORS.has(err?.code);
}
