// -----------------------------------------------------------
//  [*] Committee — evaluate approved activities
//
//  /committee/evaluate: the PATVIRTINTA queue. Each row can
//  be returned to the manager (back to PATEIKTA) or opened in
//  the review modal and scored. A return needs a reason,
//  asked for in the shared CommentModal: the backend mails it
//  to the managers and their queue shows it under the title.
//
//  The score is not typed directly: the member enters how
//  many people carried the activity out and the score becomes
//  1/n rounded to 2 decimals (0 people → score 0). Only a
//  whole count gives a score: a blank, negative or
//  fractional one previews nothing and is refused before any
//  request. Scoring sets the status to ĮVERTINTA and the row
//  moves to the results page. A success answer that is not
//  the activity does not say the verdict was stored, so it is
//  refused and the row kept.
//
//  The review modal is a dialog that takes the focus and
//  gives it back. Its backdrop closes it only on a press and
//  release of its own and never while a save is in flight,
//  and a save's answer touches the modal only while it still
//  shows that activity.
//
//  Auth rides in the session cookie; only the X-Active-Role
//  header travels with each request.
//
//  Split into (root component last):
//
//    statusClass     — status → pill css class
//    formatDate      — ISO → lt-LT date-time
//    scoreForCount   — a people count → its score
//    QueueTable      — the PATVIRTINTA rows + row actions
//    ActivityDetails — the modal's read-only fields
//    EvaluateModal   — review + scoring modal (own state)
//    EvaluatePage    — queue state, requests (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import { CommentModal, ModalStatus } from "@/components/appCommon.jsx";
import { useBackdropClose, useModalDialog } from "@/components/sharedHooks.js";
import { apiJson, downloadAttachment, reasonOf } from "@/components/api.js";
import "@/components/employee.css";







// -----------------------------------------------------------
// statusClass
// -----------------------------------------------------------
//
// Activity status → status-pill modifier class. This copy has
// no TIKSLINTI case (the other pages' copies do) — a
// TIKSLINTI pill here would render unstyled, though only
// PATVIRTINTA rows normally reach this page.
//
// Used by:
//   - QueueTable, ActivityDetails (below)
// -----------------------------------------------------------

function statusClass(status) {
  switch (status) {
    case "PATEIKTA":
      return "status-pill status-pill--submitted";
    case "PATVIRTINTA":
      return "status-pill status-pill--approved";
    case "ATMESTA":
      return "status-pill status-pill--rejected";
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
//   - EvaluateModal (below) — the Sukurta line
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
// scoreForCount
// -----------------------------------------------------------
//
// The score a people count gives — 1/n rounded to 2
// decimals, 0 for nobody — or null for a count the save
// refuses: blank, negative or not a whole number. The live
// preview and the save both ask it, so the preview never
// shows a score that would not be sent. The results page
// keeps a copy of the same rule.
//
// Used by:
//   - EvaluateModal (below) — the preview and the save
// -----------------------------------------------------------

function scoreForCount(count) {
  if (!count.trim()) return null;
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) return null;
  return n === 0 ? 0 : Number((1 / n).toFixed(2));
}







// -----------------------------------------------------------
// QueueTable
// -----------------------------------------------------------
//
// The PATVIRTINTA queue: one row per activity with
// "Peržiūrėti" (opens the modal) and "Grąžinti vadybininkei"
// (opens the reason prompt; disabled and relabelled while
// that row's PATCH is in flight). Loading and empty states
// are early returns.
//
// Used by:
//   - EvaluatePage (below)
// -----------------------------------------------------------

function QueueTable({ items, loading, actingId, onOpen, onReturn }) {
  if (loading) {
    return <div className="employee-muted">Kraunama…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="employee-empty">
        (Šiuo metu nėra patvirtintų veiklų.)
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
              <td>
                {act.theme_code} — {act.theme_title}
              </td>
              <td>
                {act.subtheme_code} — {act.subtheme_title}
              </td>
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
                    onClick={() => onOpen(act)}
                    className="btn btn-secondary btn-sm"
                  >
                    Peržiūrėti
                  </button>

                  <button
                    type="button"
                    onClick={() => onReturn(act)}
                    className="btn btn-ghost btn-sm btn-danger"
                    disabled={actingId === act.id}
                  >
                    {actingId === act.id
                      ? "Grąžinama…"
                      : "Grąžinti vadybininkei"}
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
// ActivityDetails
// -----------------------------------------------------------
//
// The modal's read-only half: theme, subtheme, title,
// description, status pill, the attachment download button
// (relabelled while `downloading`) and the manager's
// comments. Missing optional values render as muted
// placeholders.
//
// Used by:
//   - EvaluateModal (below)
// -----------------------------------------------------------

function ActivityDetails({ act, downloading, onDownload }) {
  return (
    <>
      <div className="employee-modal-field">
        <div className="employee-modal-label">Tema</div>
        <div className="employee-modal-value">
          {act.theme_code} — {act.theme_title}
        </div>
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">Potemė</div>
        <div className="employee-modal-value">
          {act.subtheme_code} — {act.subtheme_title}
        </div>
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">
          Veiklos pavadinimas
        </div>
        <div className="employee-modal-value">{act.title}</div>
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">
          Veiklos aprašymas
        </div>
        {act.description ? (
          <div className="employee-modal-value">
            {act.description}
          </div>
        ) : (
          <div className="employee-modal-muted">(nenurodyta)</div>
        )}
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">Būsena</div>
        <div className="employee-modal-value">
          <span className={statusClass(act.status)}>
            {act.status}
          </span>
        </div>
      </div>

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
              : act.attachment_original_name || "Atsisiųsti"}
          </button>
        ) : (
          <div className="employee-modal-muted">(nėra priedo)</div>
        )}
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label">
          Vadybininkės komentarai
        </div>
        {act.manager_comments ? (
          <div className="employee-modal-value">
            {act.manager_comments}
          </div>
        ) : (
          <div className="employee-modal-muted">(nėra)</div>
        )}
      </div>
    </>
  );
}







// -----------------------------------------------------------
// EvaluateModal
// -----------------------------------------------------------
//
// The review/scoring modal for one activity. It owns the
// scoring state — mounted fresh per opened row, keyed by its
// id, so the fields seed from the row: committee comments,
// the people count (blank) and the score preview.
// "Įvertinti" arms scoring mode; "Išsaugoti įvertinimą"
// validates the people count — given, not negative, whole —
// derives its score (scoreForCount) and hands
// { action: "score", … } to onScore, which resolves with the
// updated activity or rejects with the text to show. Scoring
// always leaves PATVIRTINTA, so the page closes the modal on
// a successful save and confirms it on its own line. The box
// is a dialog named by its title that takes the focus; the
// backdrop closes it only on a press and release of its own
// and not while the save is in flight. The validation
// refusals, a refused save and a refused download show on
// the modal's own status line, inside the box.
//
// Used by:
//   - EvaluatePage (below) — while an activity is selected
// -----------------------------------------------------------

function EvaluateModal({ activity, downloading, onDownload, onScore, onClose }) {

  const act = activity;

  // editingScore arms the input, the people count derives the
  // read-only score preview
  const [editingScore, setEditingScore] = useState(false);
  const [editScore, setEditScore] = useState(
    act.score !== null && act.score !== undefined ? String(act.score) : ""
  );
  const [savingScore, setSavingScore] = useState(false);
  const [editCommitteeComments, setEditCommitteeComments] = useState(
    act.committee_comments || ""
  );
  const [peopleNum, setPeopleNum] = useState("");
  const [status, setStatus] = useState(null);
  const backdrop = useBackdropClose(onClose, savingScore);
  const dialogRef = useModalDialog();


  // Typing a count previews its score live; a count the save
  // would refuse — a cleared one included — previews nothing
  const handlePeopleNumChange = (e) => {
    const val = e.target.value;
    setPeopleNum(val);

    const s = scoreForCount(val);
    setEditScore(s === null ? "" : String(s));
  };


  // First click arms scoring mode; second click validates the
  // people count, derives its score and saves
  const handleEvaluateClick = async () => {
    if (!editingScore) {
      setEditingScore(true);
      return;
    }

    if (!peopleNum.trim()) {
      setStatus({ text: "Klaida: Įveskite veiklos vykdytojų kiekį.", error: true });
      return;
    }

    const n = Number(peopleNum);
    if (!Number.isFinite(n) || n < 0) {
      setStatus({ text: "Veiklos vykdytojų kiekis turi būti 0 arba teigiamas skaičius.", error: true });
      return;
    }

    // People are counted whole: a fraction would give a score
    // no real count gives, above one for a count below one
    if (!Number.isInteger(n)) {
      setStatus({ text: "Klaida: Veiklos vykdytojų kiekis turi būti sveikas skaičius.", error: true });
      return;
    }
    const num = scoreForCount(peopleNum);
    setEditScore(String(num));

    try {
      setSavingScore(true);
      setStatus(null);
      const updated = await onScore({
        action: "score",
        score: num,
        committee_comments: editCommitteeComments,
      });

      // The page has already closed the modal when the answer
      // left PATVIRTINTA, as scoring always does; otherwise
      // the modal shows the saved row, back in view mode
      setEditScore(
        updated.score !== null && updated.score !== undefined
          ? String(updated.score)
          : ""
      );
      setEditCommitteeComments(updated.committee_comments || "");
      setEditingScore(false);
    } catch (e) {
      setStatus({ text: e.message, error: true });
    } finally {
      setSavingScore(false);
    }
  };


  // A refused download is told here, not behind the overlay
  const download = async (a) => {
    setStatus(null);
    try {
      await onDownload(a);
    } catch (e) {
      setStatus({ text: e.message, error: true });
    }
  };


  return (
    <div className="employee-modal-backdrop" {...backdrop}>
      <div
        ref={dialogRef}
        className="employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evaluate-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title" id="evaluate-modal-title">Veiklų įvertinimas</h3>
        <div className="employee-modal-meta">
          Darbuotojas: <strong>{act.full_name}</strong>
          <br />
          Sukurta: {formatDate(act.created_at)}
        </div>

        <div className="employee-modal-grid">
          {/* The activity itself — all read-only here */}
          <ActivityDetails
            act={act}
            downloading={downloading}
            onDownload={download}
          />

          {/* Committee comments — writable only in scoring
              mode. The label is forced block: a <label> is
              inline and .employee-modal-label sets no display,
              so the control would otherwise sit beside it */}
          <div className="employee-modal-field">
            <label
              className="employee-modal-label"
              htmlFor="evaluate-committee-comments"
              style={{ display: "block" }}
            >
              Komisijos nario komentarai
            </label>
            <textarea
              id="evaluate-committee-comments"
              className="field-textarea"
              value={editCommitteeComments}
              onChange={(e) =>
                setEditCommitteeComments(e.target.value)
              }
              readOnly={!editingScore}
            />
          </div>

          {/* People count → live 1/n score preview */}
          {editingScore && (
            <div className="employee-modal-field">
              <label
                className="employee-modal-label"
                htmlFor="evaluate-people-num"
                style={{ display: "block" }}
              >
                Veiklos vykdytojų kiekis
              </label>
              <input
                id="evaluate-people-num"
                className="field-input"
                type="number"
                min="0"
                step="1"
                value={peopleNum}
                onChange={handlePeopleNumChange}
                style={{ maxWidth: "140px" }}
              />
            </div>
          )}

          {/* The derived score — never typed directly; the
              read-only input is named by the caption */}
          <div className="employee-modal-field">
            <div className="employee-modal-label" id="evaluate-score-label">
              Įvertinimas
            </div>
            {!editingScore ? (
              <div className="employee-modal-value">
                {act.score !== null && act.score !== undefined ? (
                  act.score
                ) : (
                  <span className="employee-modal-muted">(nėra)</span>
                )}
              </div>
            ) : (
              <input
                aria-labelledby="evaluate-score-label"
                className="field-input"
                type="number"
                value={editScore}
                readOnly
                style={{ maxWidth: "140px" }}
              />
            )}
          </div>
        </div>

        <ModalStatus status={status} />

        <div className="employee-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={savingScore}
          >
            Uždaryti
          </button>

          <button
            type="button"
            onClick={handleEvaluateClick}
            className="btn btn-primary btn-sm"
            disabled={savingScore}
          >
            {editingScore
              ? savingScore
                ? "Saugoma…"
                : "Išsaugoti įvertinimą"
              : "Įvertinti"}
          </button>
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// EvaluatePage (default export)
// -----------------------------------------------------------
//
// Owns the queue, which activity the review modal and the
// return prompt are open for, and every request; verdicts go
// through callCommitteeAction (PATCH
// /api/activities/:id/committee), which refuses a success
// answer that is not the activity. A response whose status
// left PATVIRTINTA drops out of the queue — both scoring and
// returning do. A score's answer updates or closes the modal
// only while it still shows that activity.
// callCommitteeAction and handleDownload reject with the text
// to show, which the modal and the prompt show on their own
// status lines; the page's line serves the queue — the load
// and the saved confirmation, styled as an error only when
// it is one — and opening a row clears it.
//
// Used by:
//   - App.jsx — route /committee/evaluate
// -----------------------------------------------------------

export default function EvaluatePage() {

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // The page's line: { text, error } or null
  const [status, setStatus] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Which activity the review modal and the return prompt are
  // open for (null = closed)
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [returningActivity, setReturningActivity] = useState(null);


  // Load the PATVIRTINTA queue on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setStatus(null);
      try {
        const data = await apiJson("/api/activities/committee");

        // A non-list 200 body (an object, null, a string)
        // would blow up the row map on the next render
        if (!Array.isArray(data)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        setItems(data);
      } catch (e) {
        setStatus({ text: e.message, error: true });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);


  // The attachment through the API client, which sends the
  // X-Active-Role header a plain link could not
  const handleDownload = async (act) => {
    if (!act.attachment_path) return;
    try {
      setDownloadingId(act.id);
      await downloadAttachment(act);
    } catch (e) {
      throw new Error(`Klaida: Nepavyko atsisiųsti priedo: ${reasonOf(e)}`);
    } finally {
      setDownloadingId(null);
    }
  };


  // The one PATCH funnel: a status change drops the row from
  // this queue, otherwise it is patched in place
  const callCommitteeAction = async (id, body) => {
    setActingId(id);
    setStatus(null);
    try {
      const data = await apiJson(`/api/activities/${id}/committee`, { method: "PATCH", json: body });

      // A 2xx answer that is not this activity — the client
      // hands back {} for a body that is not JSON — does not
      // say the verdict was stored
      if (String(data?.id) !== String(id) || typeof data.status !== "string") {
        throw new Error("Klaida: netikėtas serverio atsakymas.");
      }

      if (data.status !== "PATVIRTINTA") {
        setItems((prev) => prev.filter((x) => x.id !== id));
      } else {
        setItems((prev) => prev.map((x) => (x.id === id ? data : x)));
      }

      return data;
    } catch (e) {
      throw new Error(`Klaida: ${reasonOf(e)}`);
    } finally {
      setActingId(null);
    }
  };


  // Opening a row also clears the status line, which spoke of
  // the row before
  const openModal = (act) => {
    setSelectedActivity(act);
    setStatus(null);
  };


  // Opening the return prompt also clears the status line
  const handleReturn = (act) => {
    setReturningActivity(act);
    setStatus(null);
  };


  // The modal's save. Its answer reaches the modal only while
  // the modal still shows this activity: a status that left
  // PATVIRTINTA closes it, any other replaces its row with
  // the saved one. A modal closed or moved on to another row
  // in the meantime is left as it is. The confirmation goes
  // on the page's line, which the closed modal uncovers
  const handleScore = async (body) => {
    const id = selectedActivity.id;
    const updated = await callCommitteeAction(id, body);
    setSelectedActivity((cur) => {
      if (cur?.id !== id) return cur;
      return updated.status !== "PATVIRTINTA" ? null : updated;
    });
    setStatus({ text: "Įvertinimas išsaugotas.", error: false });
    return updated;
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Įvertinti veiklas</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          <div className="card-body">
            <QueueTable
              items={items}
              loading={loading}
              actingId={actingId}
              onOpen={openModal}
              onReturn={handleReturn}
            />

            {status && (
              <div className={status.error ? "form-status form-status--error" : "form-status"}>
                {status.text}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Mounted fresh per opened row — keyed by the
          activity, so a row opened straight from another one
          does not inherit its scoring fields, which the
          modal seeds from the activity on mount */}
      {selectedActivity && (
        <EvaluateModal
          key={selectedActivity.id}
          activity={selectedActivity}
          downloading={downloadingId === selectedActivity.id}
          onDownload={handleDownload}
          onScore={handleScore}
          onClose={() => setSelectedActivity(null)}
        />
      )}

      {returningActivity && (
        <CommentModal
          activity={returningActivity}
          title="Grąžinti veiklą vadybininkei"
          label="Grąžinimo priežastis"
          placeholder="Paaiškinkite, kodėl veikla grąžinama vadybininkei"
          initialComment={returningActivity.committee_comments || ""}
          confirmLabel="Patvirtinti grąžinimą"
          busyLabel="Grąžinama…"
          emptyMessage="Klaida: Grąžinimui būtinas komentaras."
          onConfirm={(comment) =>
            callCommitteeAction(returningActivity.id, {
              action: "return",
              committee_comments: comment,
            })
          }
          onClose={() => setReturningActivity(null)}
        />
      )}
    </div>
  );
}
