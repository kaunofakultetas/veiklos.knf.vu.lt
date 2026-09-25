// -----------------------------------------------------------
//  [*] Manager — pending activity review
//
//  /manager/review: the PATEIKTA queue as a table with four
//  actions per row — approve (with confirm), deny and return
//  (each in a modal demanding a comment), and a review modal
//  that can also edit the theme/subtheme and the manager's
//  comments.
//
//  An activity whose status changes (approve/deny/return)
//  leaves the list immediately; a plain edit keeps PATEIKTA
//  and the row is patched in place. Deny and return trigger a
//  notification email to the employee on the backend. Auth
//  rides in the session cookie; only the X-Active-Role
//  header travels.
//
//  Split into (root component last):
//
//    getActiveRole       — activeRole from localStorage
//    codeToNums          — "1.2.3" → [1,2,3]
//    compareCodes        — numeric-aware code ordering
//    sortedSubthemes     — a theme's subthemes, code-ordered
//    statusClass         — status → pill css class
//    formatDate          — ISO → lt-LT date-time
//    QueueTable          — the PATEIKTA rows + four actions
//    ThemeSubthemeFields — theme/subtheme, editable in edit
//                          mode
//    ReviewModal         — review + edit modal (own state)
//    CommentModal        — the deny / return comment prompt
//    ManagerReviewPage   — queue state, requests (default)
// -----------------------------------------------------------

import { useEffect, useId, useState } from "react";
import { AppSelect } from "@/components/appCommon.jsx";
import "@/components/employee.css";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request.
//
// Used by:
//   - ManagerReviewPage (below) — every API call
// -----------------------------------------------------------

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}







// -----------------------------------------------------------
// codeToNums
// -----------------------------------------------------------
//
// Pulls the number runs out of a theme/subtheme code for
// numeric comparison.
//
// Used by:
//   - compareCodes (below)
// -----------------------------------------------------------

function codeToNums(code) {
  const parts = String(code).match(/\d+/g);
  return parts ? parts.map((n) => Number(n)) : [];
}







// -----------------------------------------------------------
// compareCodes
// -----------------------------------------------------------
//
// Sort comparator for codes: "1.9" < "1.10" (plain string
// sort would invert them); ties fall back to localeCompare.
//
// Used by:
//   - sortedSubthemes (below)
// -----------------------------------------------------------

function compareCodes(a, b) {
  const A = codeToNums(a);
  const B = codeToNums(b);

  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const av = A[i] ?? -1;
    const bv = B[i] ?? -1;
    if (av !== bv) return av - bv;
  }

  return String(a).localeCompare(String(b));
}







// -----------------------------------------------------------
// sortedSubthemes
// -----------------------------------------------------------
//
// A theme's subthemes as a new array in compareCodes order;
// a missing theme (or one without subthemes) gives [].
//
// Used by:
//   - ThemeSubthemeFields (below) — the subtheme dropdown
//     and the first-subtheme preselect on theme change
// -----------------------------------------------------------

function sortedSubthemes(theme) {
  return [...(theme?.subthemes || [])].sort((a, b) =>
    compareCodes(a.code, b.code)
  );
}







// -----------------------------------------------------------
// statusClass
// -----------------------------------------------------------
//
// Activity status → status-pill modifier class, TIKSLINTI
// included — though only PATEIKTA rows reach this queue.
//
// Used by:
//   - QueueTable, ReviewModal (below)
// -----------------------------------------------------------

function statusClass(status) {
  switch (status) {
    case "PATEIKTA":
      return "status-pill status-pill--submitted";
    case "PATVIRTINTA":
      return "status-pill status-pill--approved";
    case "ATMESTA":
      return "status-pill status-pill--rejected";
    case "TIKSLINTI":
      return "status-pill status-pill--returned";
    case "ĮVERTINTA":
      return "status-pill status-pill--scored";
    default:
      return "status-pill";
  }
}







// -----------------------------------------------------------
// formatDate
// -----------------------------------------------------------
//
// ISO timestamp → "YYYY-MM-DD HH:MM" in the lt-LT locale;
// empty input renders as an empty string.
//
// Used by:
//   - ReviewModal (below) — the Sukurta line
// -----------------------------------------------------------

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("lt-LT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}







// -----------------------------------------------------------
// QueueTable
// -----------------------------------------------------------
//
// The PATEIKTA queue: one row per activity with Patvirtinti /
// Atmesti / Grąžinti (all three disabled and showing "..."
// while that row's PATCH is in flight) and Peržiūrėti.
// Loading and empty states are early returns.
//
// Used by:
//   - ManagerReviewPage (below)
// -----------------------------------------------------------

function QueueTable({ items, loading, actingId, onApprove, onDeny, onReturn, onOpen }) {
  if (loading) {
    return <div className="employee-muted">Kraunama…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="employee-empty">
        (Šiuo metu nėra pateiktų veiklų.)
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="table my-activities-table">
        <thead>
          <tr>
            <th>Darbuotojas</th>
            <th>Tema</th>
            <th>Potemė</th>
            <th>Veiklos pavadinimas</th>
            <th>Būsena</th>
            <th>Veiksmai</th>
          </tr>
        </thead>
        <tbody>
          {items.map((act) => (
            <tr key={act.id}>
              <td>{act.full_name}</td>
              <td> {act.theme_code} — {act.theme_title} </td>
              <td> {act.subtheme_code} — {act.subtheme_title} </td>
              <td>{act.title}</td>
              <td>
                <span className={statusClass(act.status)}>
                  {act.status}
                </span>
              </td>
              <td>
                <div className="my-activities-actions">
                  <button
                    type="button"
                    onClick={() => onApprove(act)}
                    className="btn btn-primary btn-sm"
                    disabled={actingId === act.id}
                  >
                    {actingId === act.id ? "..." : "Patvirtinti"}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeny(act)}
                    className="btn btn-ghost btn-sm btn-danger"
                    disabled={actingId === act.id}
                  >
                    {actingId === act.id ? "..." : "Atmesti"}
                  </button>

                  <button
                    type="button"
                    onClick={() => onReturn(act)}
                    className="btn btn-secondary btn-sm btn-danger"
                    disabled={actingId === act.id}
                  >
                    {actingId === act.id ? "..." : "Grąžinti"}
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpen(act)}
                    className="btn btn-secondary btn-sm"
                  >
                    Peržiūrėti
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}







// -----------------------------------------------------------
// ThemeSubthemeFields
// -----------------------------------------------------------
//
// The modal's Tema / Potemė fields: the activity's current
// pair as text in view mode, two AppSelects in edit mode.
// Picking a new theme preselects its first (code-ordered)
// subtheme, or "" when it has none — then the subtheme field
// shows "(potemių nėra)".
//
// Used by:
//   - ReviewModal (below)
// -----------------------------------------------------------

function ThemeSubthemeFields({
  act,
  editing,
  themes,
  themeId,
  subthemeId,
  onThemeChange,
  onSubthemeChange,
}) {

  const currentTheme = themes.find((t) => String(t.id) === themeId);
  const subthemes = sortedSubthemes(currentTheme);


  const handleThemeChange = (val) => {
    onThemeChange(val);
    const t = themes.find((tt) => String(tt.id) === String(val));
    const firstSub = sortedSubthemes(t)[0];
    onSubthemeChange(firstSub ? String(firstSub.id) : "");
  };


  return (
    <>
      <div className="employee-modal-field">
        <div className="employee-modal-label">Tema</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.theme_code} — {act.theme_title}
          </div>
        ) : (
          <AppSelect
            value={themeId}
            onChange={handleThemeChange}
            options={themes}
            getLabel={(t) => `${t.code} — ${t.title}`}
            placeholder="Pasirinkite temą"
          />
        )}
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">Potemė</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.subtheme_code} — {act.subtheme_title}
          </div>
        ) : subthemes.length === 0 ? (
          <div className="employee-modal-muted">(potemių nėra)</div>
        ) : (
          <AppSelect
            value={subthemeId}
            onChange={(val) => onSubthemeChange(val)}
            options={subthemes}
            getLabel={(s) => `${s.code} — ${s.title}`}
            placeholder="Pasirinkite potemę"
          />
        )}
      </div>
    </>
  );
}







// -----------------------------------------------------------
// ReviewModal
// -----------------------------------------------------------
//
// The review/edit modal for one PATEIKTA activity. It owns
// the edit state — mounted fresh per opened row, so the
// theme/subtheme ids and the manager's comments seed from
// the row in view mode. "Redaguoti" toggles the pickers and
// the comment textarea writable; "Išsaugoti" (enabled only
// in edit mode) hands { manager_comments, theme_id,
// subtheme_id } to onSave, which resolves with the updated
// activity or throws (the page has already shown the error).
// The employee's title and description are read-only even
// while editing.
//
// Used by:
//   - ManagerReviewPage (below) — while an activity is
//     selected for review
// -----------------------------------------------------------

function ReviewModal({ activity, themes, downloading, onDownload, onSave, onClose, onMessage }) {

  const act = activity;

  const [modalEditing, setModalEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editManagerComments, setEditManagerComments] = useState(act.manager_comments || "");
  const [editThemeId, setEditThemeId] = useState(String(act.theme_id));
  const [editSubthemeId, setEditSubthemeId] = useState(String(act.subtheme_id));


  // Save without an action keyword = plain edit; theme/
  // subtheme only travel when edit mode was on
  const handleSaveEdit = async () => {
    try {
      setSavingEdit(true);

      const body = {
        manager_comments: editManagerComments,
      };

      if (modalEditing) {
        body.theme_id = parseInt(editThemeId, 10);
        body.subtheme_id = parseInt(editSubthemeId, 10);
      }

      const updated = await onSave(body);

      setEditThemeId(String(updated.theme_id));
      setEditSubthemeId(String(updated.subtheme_id));
      setModalEditing(false);
      onMessage("Veikla atnaujinta.");
    } catch {
      // ignore — the page already surfaced the error
    } finally {
      setSavingEdit(false);
    }
  };


  return (
    <div className="employee-modal-backdrop" onClick={onClose}>
      <div
        className="employee-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title">Pateiktos veiklos peržiūra</h3>
        <div className="employee-modal-meta">
          Darbuotojas: <strong>{act.full_name}</strong>
          <br />
          Sukurta: {formatDate(act.created_at)}
        </div>

        <div className="employee-modal-grid">
          <ThemeSubthemeFields
            act={act}
            editing={modalEditing}
            themes={themes}
            themeId={editThemeId}
            subthemeId={editSubthemeId}
            onThemeChange={setEditThemeId}
            onSubthemeChange={setEditSubthemeId}
          />

          {/* Title and description are the employee's — read-
              only even in edit mode */}
          <div className="employee-modal-field">
            <div className="employee-modal-label">Veiklos pavadinimas</div>
            <div className="employee-modal-value">{act.title}</div>
          </div>

          <div className="employee-modal-field">
            <div className="employee-modal-label">Veiklos aprašymas</div>
            {act.description ? (
              <div className="employee-modal-value">
                {act.description}
              </div>
            ) : (
              <div className="employee-modal-muted">(nenurodyta)</div>
            )}
          </div>

          {/* Status */}
          <div className="employee-modal-field">
            <div className="employee-modal-label">Būsena</div>
            <div className="employee-modal-value">
              <span className={statusClass(act.status)}>{act.status}</span>
            </div>
          </div>

          {/* Attachment download */}
          <div className="employee-modal-field">
            <div className="employee-modal-label">Priedas</div>
            {act.attachment_path ? (
              <button
                type="button"
                onClick={() => onDownload(act)}
                className="btn btn-secondary btn-sm"
                disabled={downloading}
              >
                {downloading
                  ? "Atsisiunčiama…"
                  : act.attachment_original_name || "Atsisiųsti priedą"}
              </button>
            ) : (
              <div className="employee-modal-muted">(nėra priedo)</div>
            )}
          </div>

          {/* Manager comments — writable only in edit mode. A
              real <label> names the textarea for assistive
              tech; block, so the class's bottom margin still
              applies */}
          <div className="employee-modal-field">
            <label
              className="employee-modal-label"
              htmlFor="review-manager-comments"
              style={{ display: "block" }}
            >
              Vadybininkės komentarai
            </label>
            <textarea
              id="review-manager-comments"
              className="field-textarea"
              value={editManagerComments}
              onChange={(e) => setEditManagerComments(e.target.value)}
              readOnly={!modalEditing}
            />
          </div>
        </div>

        <div className="employee-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={savingEdit}
          >
            Uždaryti
          </button>

          <button
            type="button"
            onClick={() => setModalEditing((v) => !v)}
            className="btn btn-ghost btn-sm"
            disabled={savingEdit}
          >
            {modalEditing ? "Atšaukti redagavimą" : "Redaguoti"}
          </button>

          <button
            type="button"
            onClick={handleSaveEdit}
            className="btn btn-primary btn-sm"
            disabled={savingEdit || !modalEditing}
          >
            {savingEdit ? "Saugoma…" : "Išsaugoti"}
          </button>
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// CommentModal
// -----------------------------------------------------------
//
// The deny and return prompts share this one shape: employee
// + activity meta, a comment textarea (the comment the
// backend emails to the employee) and Atšaukti / confirm
// buttons. The comment is required — an empty one raises
// `emptyMessage` through onMessage and keeps the modal open.
// Confirming hands the comment to onConfirm; the modal closes
// on success and stays open (re-enabled) on failure, the page
// having shown the error.
//
// Used by:
//   - ManagerReviewPage (below) — once as the deny prompt,
//     once as the return prompt
// -----------------------------------------------------------

function CommentModal({
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
  onMessage,
}) {

  const act = activity;

  // The deny and return prompts are two instances of this
  // modal, so the textarea's id cannot be a fixed string
  const commentId = useId();

  const [comment, setComment] = useState(initialComment);
  const [saving, setSaving] = useState(false);


  const handleConfirm = async () => {
    if (!comment.trim()) {
      onMessage(emptyMessage);
      return;
    }
    try {
      setSaving(true);
      await onConfirm(comment);
      onClose();
    } catch {
      setSaving(false);
    }
  };


  return (
    <div className="employee-modal-backdrop" onClick={onClose}>
      <div
        className="employee-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title">{title}</h3>
        <div className="employee-modal-meta">
          Darbuotojas: <strong>{act.full_name}</strong>
          <br />
          Veikla: <strong>{act.title}</strong>
        </div>

        {/* The label names the textarea for assistive tech;
            block, so the class's bottom margin still applies */}
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







// -----------------------------------------------------------
// ManagerReviewPage (default export)
// -----------------------------------------------------------
//
// Owns the queue, the theme tree, which activity each of the
// three modals is open for, and every API call; all verdicts
// funnel through callManagerAction, which PATCHes
// /api/activities/:id/manager and reconciles the local list
// from the response — a status that left PATEIKTA drops out
// of the queue, a plain edit is patched in place. One status
// line (msg) serves everything.
//
// Used by:
//   - App.jsx — route /manager/review
// -----------------------------------------------------------

export default function ManagerReviewPage() {

  const [items, setItems] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [actingId, setActingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Which activity each modal is open for (null = closed)
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [rejectingActivity, setRejectingActivity] = useState(null);
  const [returningActivity, setReturningActivity] = useState(null);


  // Pending queue and the theme tree load in parallel on
  // mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [actsRes, themesRes] = await Promise.all([
          fetch("/api/activities/pending", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
          fetch("/api/themes", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
        ]);

        const actsData = await actsRes.json().catch(() => ({}));
        if (!actsRes.ok) {
          throw new Error(
            actsData?.error || `${actsRes.status} ${actsRes.statusText}`
          );
        }

        // A 200 whose body is not the queue array would throw
        // on render (items.map) and blank the page — refuse it
        if (!Array.isArray(actsData)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        const themesData = await themesRes.json().catch(() => ({}));
        if (!themesRes.ok) {
          throw new Error(
            themesData?.error || `${themesRes.status} ${themesRes.statusText}`
          );
        }

        // The same for the theme tree (themes.find in the modal)
        if (!Array.isArray(themesData)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        setItems(actsData);
        setThemes(themesData);
      } catch (e) {
        setMsg(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);


  // Attachment download via fetch + blob so the X-Active-Role
  // header can travel along
  const handleDownload = async (act) => {
    if (!act.attachment_path) return;
    try {
      setDownloadingId(act.id);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(`/api/activities/${act.id}/attachment`, {
        headers: {
          "X-Active-Role": activeRole,
        },
      });

      if (!res.ok) {
        let errText = `${res.status} ${res.statusText}`;
        try {
          const data = await res.json();
          if (data?.error) errText = data.error;
        } catch {
          // ignore — keep the HTTP status text
        }
        throw new Error(errText);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = act.attachment_original_name || "priedas";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setMsg(`Klaida: Nepavyko atsisiųsti priedo: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  };


  // The one PATCH funnel: a response that left PATEIKTA drops
  // out of the queue, a plain edit is patched in place
  const callManagerAction = async (id, body) => {
    setActingId(id);
    setMsg("");
    try {
      const activeRole = getActiveRole();

      const res = await fetch(`/api/activities/${id}/manager`, {
        method: "PATCH",
        headers: {
          "X-Active-Role": activeRole,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      if (data.status !== "PATEIKTA") {
        setItems((prev) => prev.filter((x) => x.id !== id));
      } else {
        setItems((prev) => prev.map((x) => (x.id === id ? data : x)));
      }

      return data;
    } catch (e) {
      setMsg(`Klaida: ${e.message}`);
      throw e;
    } finally {
      setActingId(null);
    }
  };


  const handleApprove = async (act) => {
    if (!window.confirm("Patvirtinti šią veiklą?")) return;
    try {
      await callManagerAction(act.id, { action: "approve" });
    } catch {
      // ignore — callManagerAction already surfaced the error
    }
  };


  // Opening the deny / return prompts also clears the status
  // line
  const handleDeny = (act) => {
    setRejectingActivity(act);
    setMsg("");
  };

  const handleReturn = (act) => {
    setReturningActivity(act);
    setMsg("");
  };


  // The review modal's save: the PATCH result also replaces
  // the selected activity, so the modal shows the saved row
  const handleSave = async (body) => {
    const updated = await callManagerAction(selectedActivity.id, body);
    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setSelectedActivity(updated);
    return updated;
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Darbuotojų veiklų peržiūra</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          <QueueTable
            items={items}
            loading={loading}
            actingId={actingId}
            onApprove={handleApprove}
            onDeny={handleDeny}
            onReturn={handleReturn}
            onOpen={setSelectedActivity}
          />

          {msg && <div className="form-status">{msg}</div>}
        </section>
      </main>

      {/* Each modal mounts fresh for its activity, seeding its
          own fields from it */}
      {selectedActivity && (
        <ReviewModal
          activity={selectedActivity}
          themes={themes}
          downloading={downloadingId === selectedActivity.id}
          onDownload={handleDownload}
          onSave={handleSave}
          onClose={() => setSelectedActivity(null)}
          onMessage={setMsg}
        />
      )}

      {rejectingActivity && (
        <CommentModal
          activity={rejectingActivity}
          title="Atmesti veiklą"
          label="Atmetimo komentaras"
          placeholder="Paaiškinkite, kodėl veikla atmetama"
          initialComment={rejectingActivity.rejection_comment || ""}
          confirmLabel="Patvirtinti atmetimą"
          busyLabel="Atmetama…"
          emptyMessage="Klaida: Atmetimui būtinas komentaras."
          onConfirm={(comment) =>
            callManagerAction(rejectingActivity.id, {
              action: "deny",
              rejection_comment: comment,
            })
          }
          onClose={() => setRejectingActivity(null)}
          onMessage={setMsg}
        />
      )}

      {returningActivity && (
        <CommentModal
          activity={returningActivity}
          title="Grąžinti veiklą tikslinimui"
          label="Tikslinimo komentaras"
          placeholder="Paaiškinkite, ką reikia patikslinti"
          initialComment=""
          confirmLabel="Patvirtinti grąžinimą"
          busyLabel="Grąžinama…"
          emptyMessage="Klaida: Tikslinimui būtinas komentaras."
          onConfirm={(comment) =>
            callManagerAction(returningActivity.id, {
              action: "return",
              rejection_comment: comment,
            })
          }
          onClose={() => setReturningActivity(null)}
          onMessage={setMsg}
        />
      )}
    </div>
  );
}
