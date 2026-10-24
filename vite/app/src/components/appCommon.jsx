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
//  the component, or the focus leaving it, shuts it too.
//
//  Gotcha: getValue defaults to String(o.id) and is applied
//  when an option is PICKED, but the "which option is
//  selected" lookup always compares o.id — a custom getValue
//  that doesn't return the id will select correctly yet
//  display nothing.
//
//  CommentModal is the prompt for a verdict that must carry a
//  reason — the manager's deny and return, the committee's
//  return — and refuses to confirm with an empty comment.
//
//  CommentModal's backdrop and focus come from the hooks in
//  sharedHooks.js, which the pages' own dialogs use too.
//  Every dialog reports what was done in it — a refusal, or
//  the confirmation when it stays open — on a ModalStatus
//  line of its own, inside the box: the page's status line
//  sits behind the overlay.
//
//  Split into (root component last):
//
//    ATTACHMENT_ACCEPT    — accept= list for attachment inputs
//    ATTACHMENT_MAX_BYTES — the 100 MB attachment size limit
//    ATTACHMENT_TOO_BIG   — the message for an oversized pick
//    AppSelect            — the shared custom dropdown
//    ModalStatus          — a dialog's own status line
//    CommentModal         — the required-comment prompt
// -----------------------------------------------------------

import { useEffect, useId, useRef, useState } from "react";
import { useBackdropClose, useModalDialog } from "./sharedHooks.js";
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
// the ingress caps bodies at. A file reaching it counts as
// too big — the backend's upload limit trips at that exact
// size — and is refused at pick time and again at submit,
// before a byte is sent, with the wording the backend would
// answer.
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
// on the trigger, for a page <label htmlFor>), labelledBy
// (the id of the caption the page shows above it: the trigger
// is then named by that caption followed by the value it
// shows, the listbox-button pattern), label (the list's
// aria-label, defaults to the placeholder). The chevron is
// decoration, hidden from assistive tech. The list shuts
// after a pick, on Escape, on a mousedown outside and when
// the focus leaves the component (a keyboard user tabbing
// on); a pick or Escape hands focus back to the trigger.
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
  labelledBy,
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

  // The trigger names itself after the caption, so it needs
  // an id of its own even when the page gives none
  const ownId = useId();
  const triggerId = id || ownId;

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


  // Focus moving anywhere outside the component — tabbing on
  // past the last option — shuts the list, like an outside
  // mousedown; moving between the trigger and the options
  // keeps it open
  const onBlur = (e) => {
    if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
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
      onBlur={onBlur}
    >
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="field-select app-select-trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-labelledby={labelledBy ? `${labelledBy} ${triggerId}` : undefined}
      >
        <span className="app-select-label">
          {selected ? getLabel(selected) : placeholder}
        </span>
        <span className="app-select-chevron" aria-hidden="true">▾</span>
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







// -----------------------------------------------------------
// ModalStatus
// -----------------------------------------------------------
//
// A dialog's own status line, shown inside the box: the
// refusal of what was just tried in the dialog, or the
// confirmation of a save after which it stays open. `status`
// is null or { text, error }; an error is styled as one and
// is an alert, so a screen reader announces it, and a
// confirmation is a polite status. Nothing renders without a
// text.
//
// Used by:
//   - CommentModal (below)
//   - employee/myActivities.jsx, manager/review.jsx,
//     committee/evaluate.jsx, committee/results.jsx — their
//     dialogs
// -----------------------------------------------------------

export function ModalStatus({ status }) {
  if (!status?.text) return null;
  return (
    <div
      className={status.error ? "form-status form-status--error" : "form-status"}
      role={status.error ? "alert" : "status"}
    >
      {status.text}
    </div>
  );
}







// -----------------------------------------------------------
// CommentModal
// -----------------------------------------------------------
//
// The prompt behind every verdict that must carry a reason:
// the employee and the activity named, a comment textarea
// under its label and Atšaukti / confirm buttons. The
// comment is required — an empty one shows `emptyMessage` in
// the prompt and keeps it open — and the backend mails it on
// with the verdict. Confirming hands the comment to
// onConfirm, which resolves on success or rejects with the
// text to show; the prompt closes on success and on failure
// stays open, re-enabled, with that text on its own status
// line. The backdrop closes it only on a click of its
// own and not while the confirm is in flight, so neither a
// stray drag nor an impatient click loses the comment.
//
// Used by:
//   - manager/review.jsx — the deny and the return prompts
//   - committee/evaluate.jsx — the return to the manager
// -----------------------------------------------------------

export function CommentModal({
  activity,
  title,
  label,
  placeholder,
  initialComment,
  confirmLabel,
  busyLabel,
  emptyMessage,
  onConfirm,
  onClose,
}) {

  const act = activity;

  // A page can mount more than one of these prompts, so the
  // textarea's id cannot be a fixed string
  const commentId = useId();
  const titleId = useId();

  const [comment, setComment] = useState(initialComment);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const backdrop = useBackdropClose(onClose, saving);
  const dialogRef = useModalDialog();


  const handleConfirm = async () => {
    if (!comment.trim()) {
      setStatus({ text: emptyMessage, error: true });
      return;
    }
    try {
      setSaving(true);
      setStatus(null);
      await onConfirm(comment);
      onClose();
    } catch (e) {
      setStatus({ text: e.message, error: true });
      setSaving(false);
    }
  };


  return (
    <div className="employee-modal-backdrop" {...backdrop}>
      <div
        ref={dialogRef}
        className="employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title" id={titleId}>{title}</h3>
        <div className="employee-modal-meta">
          Darbuotojas: <strong>{act.full_name}</strong>
          <br />
          Veikla: <strong>{act.title}</strong>
        </div>

        {/* The label names the textarea for assistive tech;
            block, so the class's bottom margin still
            applies */}
        <div className="employee-modal-field">
          <label
            className="employee-modal-label"
            htmlFor={commentId}
            style={{ display: "block" }}
          >
            {label}
          </label>
          <textarea
            id={commentId}
            className="field-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={placeholder}
          />
        </div>

        <ModalStatus status={status} />

        <div className="employee-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={saving}
          >
            Atšaukti
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="btn btn-primary btn-sm"
            disabled={saving}
          >
            {saving ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
