// -----------------------------------------------------------
//  [*] Components — shared form pieces
//
//  AppSelect is a button-driven replacement for <select>,
//  styled via employee.css. Matching is loose on purpose: the
//  selected option is found by String(option.id) ===
//  String(value), so numeric ids and string values from form
//  state still match.
//
//  The DOM stays plain buttons (the page tests click options
//  as buttons by name); the trigger carries aria-haspopup /
//  aria-expanded, the list is a labelled group and the
//  selected option is aria-pressed. Keyboard: ArrowDown /
//  ArrowUp enter the list from the trigger and walk it,
//  Enter / Space pick (a native button click), Escape shuts
//  the list and refocuses the trigger; a mousedown outside
//  the component shuts it too.
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

import { useEffect, useRef, useState } from "react";
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
// getValue(o) = String(o.id), placeholder, disabled, id (goes
// on the trigger, for a page <label htmlFor>), label (the
// list's aria-label, defaults to the placeholder). The list
// shuts after a pick, on Escape and on a mousedown outside;
// a pick or Escape hands focus back to the trigger.
//
// Used by:
//   - employee/newActivity.jsx, employee/myActivities.jsx —
//     theme/subtheme pickers
//   - manager/review.jsx, committee/results.jsx —
//     theme/subtheme reassignment
//   - manager/themes.jsx — a new subtheme's parent theme
// -----------------------------------------------------------

export function AppSelect({
  id,
  label,
  value,
  onChange,
  options,
  getLabel,
  getValue = (o) => String(o.id),
  placeholder = "Pasirinkite",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);

  // The option to focus once the list has rendered: an arrow
  // key on a shut trigger opens the list first, and the option
  // buttons exist only after that render
  const pendingFocus = useRef(null);

  // The list is never shown while disabled, so aria-expanded
  // and the effects below follow this rather than `open`
  const expanded = open && !disabled;

  const selected =
    options.find((o) => String(o.id) === String(value)) || null;


  // A mousedown outside the component shuts the list; the
  // listener exists only while the list shows, so the idle
  // selects on a page cost nothing and an unmount mid-open
  // leaves nothing behind
  useEffect(() => {
    if (!expanded) return undefined;
    const onDocumentMouseDown = (e) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [expanded]);


  // Focus the option an arrow key asked for, now that the list
  // has rendered
  useEffect(() => {
    if (!expanded || pendingFocus.current === null) return;
    optionRefs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  }, [expanded]);


  // A pick shuts the list and returns focus to the trigger, so
  // a keyboard user is not dropped on <body> when the focused
  // option unmounts
  const handleSelect = (newValue) => {
    if (onChange) onChange(newValue);
    setOpen(false);
    triggerRef.current?.focus();
  };


  const toggleOpen = () => {
    if (disabled) return;
    setOpen((o) => !o);
  };


  // Focus option `index`, clamped to the list; a shut list is
  // opened first and the effect above focuses once the buttons
  // exist
  const focusOption = (index) => {
    if (options.length === 0) return;
    const clamped = Math.max(0, Math.min(index, options.length - 1));
    if (expanded) {
      optionRefs.current[clamped]?.focus();
      return;
    }
    pendingFocus.current = clamped;
    setOpen(true);
  };


  // Keys from the trigger or an option: ArrowDown/ArrowUp
  // enter the list at its first/last option from the trigger
  // and walk it from an option; Escape shuts the list and
  // refocuses the trigger. Enter/Space need nothing — they
  // click the button they are on
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (!expanded) return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (disabled) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    const at = optionRefs.current.indexOf(e.target);
    if (at === -1) focusOption(step === 1 ? 0 : options.length - 1);
    else focusOption(at + step);
  };


  return (
    <div
      ref={rootRef}
      className={`app-select${disabled ? " is-disabled" : ""}`}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="field-select app-select-trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={expanded}
      >
        <span className="app-select-label">
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span className="app-select-chevron">▾</span>
      </button>

      {expanded && (
        <div className="app-select-dropdown" role="group" aria-label={label || placeholder}>
          {options.map((opt, i) => (
            <button
              type="button"
              key={opt.id}
              ref={(el) => { optionRefs.current[i] = el; }}
              className="app-select-option"
              aria-pressed={opt === selected}
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
