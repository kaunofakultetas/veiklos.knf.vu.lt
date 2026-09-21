// -----------------------------------------------------------
//  [*] Committee — evaluate approved activities
//
//  /committee/evaluate: the PATVIRTINTA queue. Each row can
//  be returned to the manager (back to PATEIKTA) or opened in
//  the review modal and scored.
//
//  The score is not typed directly: the member enters how
//  many people carried the activity out and the score becomes
//  1/n rounded to 2 decimals (0 people → score 0). Scoring
//  sets the status to ĮVERTINTA and the row moves to the
//  results page.
//
//  Auth rides in the session cookie; only the X-Active-Role
//  header travels with each request.
//
//  Split into (root component last):
//
//    getActiveRole — activeRole from localStorage
//    statusClass   — status → pill css class
//    formatDate    — ISO → lt-LT date-time
//    EvaluatePage  — queue + modal (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import "@/components/employee.css";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request so a role switch in the header is picked up
// immediately.
//
// Used by:
//   - EvaluatePage (below) — every API call
// -----------------------------------------------------------

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}







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
//   - EvaluatePage (below) — table and modal
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
//   - EvaluatePage (below) — the modal's Sukurta line
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
// EvaluatePage (default export)
// -----------------------------------------------------------
//
// Owns the queue and all state; verdicts go through
// callCommitteeAction (PATCH /api/activities/:id/committee).
// A response whose status left PATVIRTINTA drops out of the
// queue — both scoring and returning do. The modal is an
// inline render helper (renderModal) sharing this state.
//
// Used by:
//   - App.jsx — route /committee/evaluate
// -----------------------------------------------------------

export default function EvaluatePage() {

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [actingId, setActingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);


  // Modal + scoring state: editingScore arms the input, the
  // people count derives the read-only score preview
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [editingScore, setEditingScore] = useState(false);
  const [editScore, setEditScore] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [editCommitteeComments, setEditCommitteeComments] = useState("");
  const [peopleNum, setPeopleNum] = useState("");


  // Load the PATVIRTINTA queue on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const res = await fetch("/api/activities/committee", {
          headers: {
            "X-Active-Role": activeRole,
          },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `${res.status} ${res.statusText}`);
        }

        setItems(data);
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
      setMsg(`Nepavyko atsisiųsti priedo: ${e.message}`);
    } finally {
      setDownloadingId(null);
    }
  };


  // The one PATCH funnel: a status change drops the row from
  // this queue, otherwise it is patched in place
  const callCommitteeAction = async (id, body) => {
    setActingId(id);
    setMsg("");
    try {
      const activeRole = getActiveRole();

      const res = await fetch(`/api/activities/${id}/committee`, {
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

      if (data.status !== "PATVIRTINTA") {
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


  // Opening a row seeds the scoring fields from it, in view
  // mode
  const openModal = (act) => {
    setSelectedActivity(act);
    setEditingScore(false);
    setEditScore(
      act.score !== null && act.score !== undefined ? String(act.score) : ""
    );
    setEditCommitteeComments(act.committee_comments || "");
    setPeopleNum("");
  };

  const closeModal = () => {
    setSelectedActivity(null);
    setEditingScore(false);
    setSavingScore(false);
  };


  const handleReturnToManager = async (act) => {
    if (!window.confirm("Grąžinti veiklą vadybininkei?")) return;
    try {
      await callCommitteeAction(act.id, { action: "return" });
    } catch {
      // ignore — callCommitteeAction already surfaced the error
    }
  };


  // First click arms scoring mode; second click validates the
  // people count, derives score = 1/n and saves. (The empty-
  // count message below is a shipped truncated sentence.)
  const handleEvaluateClick = async () => {
    if (!selectedActivity) return;

    if (!editingScore) {
      setEditingScore(true);
      return;
    }

    if (!peopleNum.trim()) {
      setMsg("Veiklos vykdytojų kiekis");
      return;
    }

      const n = Number(peopleNum);
      if (!Number.isFinite(n) || n < 0) {
        setMsg("Veiklos vykdytojų kiekis turi būti 0 arba teigiamas skaičius.");
        return;
      }
      const num = n === 0 ? 0 : Number((1 / n).toFixed(2));
      setEditScore(String(num));

      try {
        setSavingScore(true);
        const updated = await callCommitteeAction(selectedActivity.id, {
          action: "score",
          score: num,
          committee_comments: editCommitteeComments,
        });

        setSelectedActivity(updated);
        setEditScore(
          updated.score !== null && updated.score !== undefined
            ? String(updated.score)
            : ""
        );
        setEditCommitteeComments(updated.committee_comments || "");
        setEditingScore(false);
        setMsg("Įvertinimas išsaugotas.");

        // Scoring always leaves PATVIRTINTA, so this closes
        // the modal on success
        if (updated.status !== "PATVIRTINTA") {
          closeModal();
        }
      } catch {
        // ignore — callCommitteeAction already surfaced the error
      } finally {
        setSavingScore(false);
      }
    };


  // Inline render helper for the review/scoring modal — kept
  // inside the component because it reads nearly all of the
  // state above
  const renderModal = () => {
    const act = selectedActivity;
    if (!act) return null;

    return (
      <div className="employee-modal-backdrop" onClick={closeModal}>
        <div
          className="employee-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="employee-modal-title">Veiklų įvertinimas</h3>
          <div className="employee-modal-meta">
            Darbuotojas: <strong>{act.full_name}</strong>
            <br />
            Sukurta: {formatDate(act.created_at)}
          </div>

          <div className="employee-modal-grid">
            {/* The activity itself — all read-only here */}
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
                  onClick={() => handleDownload(act)}
                  className="btn btn-secondary btn-sm"
                  disabled={downloadingId === act.id}
                >
                  {downloadingId === act.id
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

            {/* Committee comments — writable only in scoring
                mode */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">
                Komisijos nario komentarai
              </div>
              <textarea
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
                <div className="employee-modal-label">
                  Veiklos vykdytojų kiekis
                </div>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  step="1"
                  value={peopleNum}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPeopleNum(val);

                    const n = Number(val);
                    if (Number.isFinite(n) && n >= 0) {
                      const s = n === 0 ? 0 : Number((1 / n).toFixed(2));
                      setEditScore(String(s));
                    } else {
                      setEditScore("");
                    }
                  }}
                  style={{ maxWidth: "140px" }}
                />
              </div>
            )}

            {/* The derived score — never typed directly */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">
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
                  className="field-input"
                  type="number"
                  value={editScore}
                  readOnly
                  style={{ maxWidth: "140px" }}
                />
              )}
            </div>
          </div>

          <div className="employee-modal-footer">
            <button
              type="button"
              onClick={closeModal}
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
            {loading ? (
              <div className="employee-muted">Kraunama…</div>
            ) : items.length === 0 ? (
              <div className="employee-empty">
                (Šiuo metu nėra patvirtintų veiklų.)
              </div>
            ) : (
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
                              onClick={() => openModal(act)}
                              className="btn btn-secondary btn-sm"
                            >
                              Peržiūrėti
                            </button>

                            <button
                              type="button"
                              onClick={() => handleReturnToManager(act)}
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
            )}

            {msg && (
              <div className="form-status form-status--error">
                {msg}
              </div>
            )}
          </div>
        </section>
      </main>

      {renderModal()}
    </div>
  );
}
