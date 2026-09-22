// -----------------------------------------------------------
//  [*] Components — shared form pieces
//
//  AppSelect is a button-driven replacement for <select>,
//  styled via employee.css. Matching is loose on purpose: the
//  selected option is found by String(option.id) ===
//  String(value), so numeric ids and string values from form
//  state still match.
//
//  Gotcha: getValue defaults to String(o.id) and is applied
//  when an option is PICKED, but the "which option is
//  selected" lookup always compares o.id — a custom getValue
//  that doesn't return the id will select correctly yet
//  display nothing.
//
//  Split into (root component last):
//
//    ATTACHMENT_ACCEPT    — accept= list for attachment inputs
//    ATTACHMENT_MAX_BYTES — the 100 MB attachment size limit
//    ATTACHMENT_TOO_BIG   — the message for an oversized pick
//    AppSelect            — the shared custom dropdown
// -----------------------------------------------------------

import { useState } from "react";
import "@/components/employee.css";







// -----------------------------------------------------------
// ATTACHMENT_ACCEPT
// -----------------------------------------------------------
//
// The attachment types the backend accepts (routes/
// activities.js ALLOWED_ATTACHMENTS) as an accept= value, so
// the file pickers filter up front; the backend still
// refuses anything else.
//
// Used by:
//   - employee/newActivity.jsx, employee/myActivities.jsx —
//     the attachment <input type="file">
// -----------------------------------------------------------

export const ATTACHMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp";







// -----------------------------------------------------------
// ATTACHMENT_MAX_BYTES / ATTACHMENT_TOO_BIG
// -----------------------------------------------------------
//
// The attachment size limit, the same 100 MB the backend
// enforces (routes/activities.js MAX_ATTACHMENT_BYTES) and
// the ingress caps bodies at — checked at pick time and again
// at submit, so an oversized file is refused before a byte
// is sent, with the same wording the backend would answer.
//
// Used by:
//   - employee/newActivity.jsx, employee/myActivities.jsx —
//     the attachment <input type="file"> and the submit
// -----------------------------------------------------------

export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export const ATTACHMENT_TOO_BIG = "Klaida: priedas per didelis (iki 100 MB)";







// -----------------------------------------------------------
// AppSelect
// -----------------------------------------------------------
//
// Props: value, onChange(newValue), options, getLabel(o),
// getValue(o) = String(o.id), placeholder, disabled. Closes
// after a pick; no outside-click handling — the dropdown only
// closes on trigger toggle or selection.
//
// Used by:
//   - employee/newActivity.jsx, employee/myActivities.jsx —
//     theme/subtheme pickers
//   - manager/review.jsx — theme/subtheme reassignment
//   - committee/evaluate.jsx, committee/results.jsx
// -----------------------------------------------------------

export function AppSelect({
  value,
  onChange,
  options,
  getLabel,
  getValue = (o) => String(o.id),
  placeholder = "Pasirinkite",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);

  const selected =
    options.find((o) => String(o.id) === String(value)) || null;

  const handleSelect = (newValue) => {
    if (onChange) onChange(newValue);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((o) => !o);
  };

  return (
    <div className={`app-select${disabled ? " is-disabled" : ""}`}>
      <button
        type="button"
        className="field-select app-select-trigger"
        onClick={toggleOpen}
        disabled={disabled}
      >
        <span className="app-select-label">
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span className="app-select-chevron">▾</span>
      </button>

      {open && !disabled && (
        <div className="app-select-dropdown">
          {options.map((opt) => (
            <button
              type="button"
              key={opt.id}
              className="app-select-option"
              onClick={() => handleSelect(getValue(opt))}
            >
              {getLabel(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
