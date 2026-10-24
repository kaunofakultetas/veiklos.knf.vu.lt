// -----------------------------------------------------------
//  [*] Utils — theme and subtheme code order
//
//  A code is text with dotted numbers in it: the live theme
//  codes are a family name followed by a section number, the
//  subtheme codes the number alone. Postgres orders codes as
//  plain text, which puts section ten before section two, so
//  the lists the pages show as they arrive are sorted here
//  instead, the way a person reads them — digit runs by
//  value, everything else as Lithuanian text. The text
//  decides first, which keeps one family's themes together:
//  two families number their sections alike, and comparing
//  the numbers alone would interleave them.
// -----------------------------------------------------------


// The Lithuanian collation, with digit runs compared by
// value; built once, as building it is the costly part
const COLLATOR = new Intl.Collator("lt", { numeric: true });







// -----------------------------------------------------------
// compareCodes
// -----------------------------------------------------------
//
// A sort comparator for two codes in reading order, through
// the one shared collator.
//
// Used by:
//   - routes/themes.js — GET / (themes and subthemes)
//   - routes/activities.js — GET /evaluated/theme-totals,
//     GET /evaluated/employee/:eid/subthemes
// -----------------------------------------------------------

export function compareCodes(a, b) {
  return COLLATOR.compare(String(a), String(b));
}
