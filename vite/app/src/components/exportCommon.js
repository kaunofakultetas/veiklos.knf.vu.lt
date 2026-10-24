// -----------------------------------------------------------
//  [*] Components — the rules both XLSX exports share
//
//  The employee's and the manager's export pages build their
//  workbooks the same way, client-side with SheetJS, and
//  follow the same two rules for what they write.
//
//  A text cell is cut to the 32,767 characters an XLSX cell
//  holds. The backend takes descriptions and comments far
//  longer than that, and SheetJS refuses to write a workbook
//  with a longer text, so a single such activity would cost
//  the whole download. The cut text ends in "…", so a reader
//  of the file sees that it was cut.
//
//  The file name is stamped with the local date and time, the
//  clock the date cells are written in.
//
//  Split into:
//
//    CELL_TEXT_LIMIT — the longest text an XLSX cell holds
//    fitCell         — one cell value, cut to fit
//    fitRows         — every cell of a sheet, cut to fit
//    fileStamp       — the local date-time for a file name
// -----------------------------------------------------------


// The most characters an XLSX cell holds — Excel's limit,
// counted in UTF-16 units as SheetJS counts them before it
// refuses a workbook
const CELL_TEXT_LIMIT = 32767;







// -----------------------------------------------------------
// fitCell
// -----------------------------------------------------------
//
// One cell value as a sheet can hold it: a text longer than
// CELL_TEXT_LIMIT is cut so that, with the "…" after it, it
// is no longer than the limit; anything else — a shorter
// text, a number, a blank — comes back as it is. The cut
// never splits a character written as two UTF-16 units (an
// emoji, a rare letter), which would leave half of it behind.
//
// Used by:
//   - fitRows (below)
// -----------------------------------------------------------

function fitCell(value) {
  if (typeof value !== "string" || value.length <= CELL_TEXT_LIMIT) return value;

  // Room for the "…" at the end
  let end = CELL_TEXT_LIMIT - 1;

  // A high surrogate as the last unit kept would lose its low
  // half to the cut, so it goes too
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;

  return `${value.slice(0, end)}…`;
}







// -----------------------------------------------------------
// fitRows
// -----------------------------------------------------------
//
// The rows of a sheet, header row included, with every cell
// passed through fitCell — as new arrays, so the rows the
// page built stay as they are. The export pages hand this to
// SheetJS, so a description or a comment of any length still
// ends in a file.
//
// Used by:
//   - employee/export.jsx — ExportPage, the employee's export
//   - manager/export.jsx — ManagerExportPage, the manager's
//     export
// -----------------------------------------------------------

export function fitRows(rows) {
  return rows.map((row) => row.map(fitCell));
}







// -----------------------------------------------------------
// fileStamp
// -----------------------------------------------------------
//
// The date and time a download's file name carries — year,
// month, day, hours, minutes and seconds, zero-padded and
// joined by dashes — read in the browser's local time, as
// the date cells are. UTC would run two or three hours
// behind in Vilnius, and an export made soon after midnight
// would be named after the day before.
//
// Used by:
//   - employee/export.jsx, manager/export.jsx — the name of
//     the file each export writes
// -----------------------------------------------------------

export function fileStamp(date) {
  const two = (n) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    two(date.getMonth() + 1),
    two(date.getDate()),
    two(date.getHours()),
    two(date.getMinutes()),
    two(date.getSeconds()),
  ].join("-");
}
