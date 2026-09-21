// -----------------------------------------------------------
//  [*] Committee — evaluated activities & re-scoring
//
//  /committee/results: every ĮVERTINTA activity with its
//  score. A row opens the modal, where "Pervertinti" redoes
//  the evaluation: theme/subtheme can be reassigned, the
//  comments edited, and the score re-derived from a fresh
//  people count (score = 1/n, 2 decimals, 0 people → 0).
//
//  Re-scoring keeps the activity ĮVERTINTA, so the row stays
//  in this list and is patched in place. Auth rides in the
//  session cookie; only the X-Active-Role header travels.
//
//  Split into (root component last):
//
//    getActiveRole       — activeRole from localStorage
//    codeToNums          — "1.2.3" → [1,2,3]
//    compareCodes        — numeric-aware code ordering
//    sortedSubthemes     — a theme's subthemes, code-ordered
//    statusClass         — status → pill css class
//    formatDate          — ISO → lt-LT date-time
//    ResultsTable        — the ĮVERTINTA rows with scores
//    ThemeSubthemeFields — theme/subtheme, editable while
//                          re-scoring
//    ActivityDetails     — the modal's read-only fields
//    ResultsModal        — review + re-scoring modal
//    ResultsPage         — list state, requests (default)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
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
//   - ResultsPage (below) — every API call
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
// Activity status → status-pill modifier class; like the
// evaluate page's copy this one has no TIKSLINTI case, which
// never shows here anyway.
//
// Used by:
//   - ResultsTable, ActivityDetails (below)
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
//   - ResultsModal (below) — the Sukurta line
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
// ResultsTable
// -----------------------------------------------------------
//
// Every ĮVERTINTA activity with its score ("(nėra)" when
// null) and a "Peržiūrėti" button that opens the modal.
// Loading and empty states are early returns.
//
// Used by:
//   - ResultsPage (below)
// -----------------------------------------------------------

function ResultsTable({ items, loading, onOpen }) {
  if (loading) {
    return <div className="employee-muted">Kraunama…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="employee-empty">
        (Šiuo metu nėra įvertintų veiklų.)
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
            <th>Įvertinimas</th>
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
                {act.score !== null &&
                act.score !== undefined ? (
                  act.score
                ) : (
                  <span className="table-muted">(nėra)</span>
                )}
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
// pair as text in view mode, two AppSelects while re-scoring.
// Picking a new theme preselects its first (code-ordered)
// subtheme, or "" when it has none — then the subtheme field
// shows "(potemių nėra)".
//
// Used by:
//   - ResultsModal (below)
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

  const currentTheme = themes.find((t) => String(t.id) === String(themeId));
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
// ActivityDetails
// -----------------------------------------------------------
//
// The modal's read-only fields: title, description, status
// pill, the attachment download button (relabelled while
// `downloading`) and the manager's comments. Missing
// optional values render as muted placeholders.
//
// Used by:
//   - ResultsModal (below)
// -----------------------------------------------------------

function ActivityDetails({ act, downloading, onDownload }) {
  return (
    <>
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
// ResultsModal
// -----------------------------------------------------------
//
// The review/re-scoring modal for one activity. It owns the
// edit state — mounted fresh per opened row, so the fields
// seed from the row: theme/subtheme ids, committee comments,
// the people count (blank) and the score preview.
// "Pervertinti" arms re-scoring; "Išsaugoti įvertinimą"
// validates the people count, derives score = 1/n (2
// decimals, 0 people → 0) and hands { action: "score", …,
// theme_id, subtheme_id } to onRescore, which resolves with
// the updated activity or throws. Re-scoring keeps ĮVERTINTA,
// so the modal stays open showing the saved values. Status
// text goes up through onMessage — including the shipped
// truncated "Veiklos vykdytojų kiekis" for an empty count.
//
// Used by:
//   - ResultsPage (below) — while an activity is selected
// -----------------------------------------------------------

function ResultsModal({ activity, themes, downloading, onDownload, onRescore, onClose, onMessage }) {

  const act = activity;

  // editingScore arms the inputs, the people count derives
  // the read-only score preview
  const [editingScore, setEditingScore] = useState(false);
  const [editScore, setEditScore] = useState(
    act.score !== null && act.score !== undefined ? String(act.score) : ""
  );
  const [savingScore, setSavingScore] = useState(false);
  const [editCommitteeComments, setEditCommitteeComments] = useState(
    act.committee_comments || ""
  );
  const [peopleNum, setPeopleNum] = useState("");

  // Theme reassignment
  const [editThemeId, setEditThemeId] = useState(String(act.theme_id));
  const [editSubthemeId, setEditSubthemeId] = useState(String(act.subtheme_id));


  // Typing a count previews 1/n live; a bad count blanks it
  const handlePeopleNumChange = (e) => {
    const val = e.target.value;
    setPeopleNum(val);

    const n = Number(val);
    if (Number.isFinite(n) && n >= 0) {
      const s = n === 0 ? 0 : Number((1 / n).toFixed(2));
      setEditScore(String(s));
    } else {
      setEditScore("");
    }
  };


  // First click arms re-scoring; second click validates the
  // people count, derives score = 1/n and saves with the
  // theme/subtheme too
  const handleReevaluateClick = async () => {
    if (!editingScore) {
      setEditingScore(true);
      return;
    }

    if (!peopleNum.trim()) {
      onMessage("Veiklos vykdytojų kiekis");
      return;
    }

    const n = Number(peopleNum);
    if (!Number.isFinite(n) || n < 0) {
      onMessage("Veiklos vykdytojų kiekis turi būti 0 arba teigiamas skaičius.");
      return;
    }

    const num = n === 0 ? 0 : Number((1 / n).toFixed(2));
    setEditScore(String(num));

    try {
      setSavingScore(true);
      const data = await onRescore({
        action: "score",
        score: num,
        committee_comments: editCommitteeComments,
        theme_id: editThemeId ? parseInt(editThemeId, 10) : null,
        subtheme_id: editSubthemeId ? parseInt(editSubthemeId, 10) : null,
      });

      // Re-scoring keeps ĮVERTINTA — refresh the fields from
      // the saved row and drop back to view mode
      setEditThemeId(String(data.theme_id ?? ""));
      setEditSubthemeId(String(data.subtheme_id ?? ""));
      setEditScore(
        data.score !== null && data.score !== undefined
          ? String(data.score)
          : ""
      );
      setEditCommitteeComments(data.committee_comments || "");
      setEditingScore(false);
      onMessage("Įvertinimas atnaujintas.");
    } catch (e) {
      onMessage(`Klaida: ${e.message}`);
    } finally {
      setSavingScore(false);
    }
  };


  return (
    <div className="employee-modal-backdrop" onClick={onClose}>
      <div
        className="employee-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title">
          Įvertintos veiklos rezultatas
        </h3>

        <div className="employee-modal-meta">
          Darbuotojas: <strong>{act.full_name}</strong>
          <br />
          Sukurta: {formatDate(act.created_at)}
        </div>

        <div className="employee-modal-grid">
          {/* Theme/subtheme — editable in re-scoring mode */}
          <ThemeSubthemeFields
            act={act}
            editing={editingScore}
            themes={themes}
            themeId={editThemeId}
            subthemeId={editSubthemeId}
            onThemeChange={setEditThemeId}
            onSubthemeChange={setEditSubthemeId}
          />

          {/* The activity itself — read-only */}
          <ActivityDetails
            act={act}
            downloading={downloading}
            onDownload={onDownload}
          />

          {/* Committee comments — writable only while
              re-scoring */}
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
                onChange={handlePeopleNumChange}
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
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={savingScore}
          >
            Uždaryti
          </button>

          <button
            type="button"
            onClick={handleReevaluateClick}
            className="btn btn-primary btn-sm"
            disabled={savingScore}
          >
            {editingScore
              ? savingScore
                ? "Saugoma…"
                : "Išsaugoti įvertinimą"
              : "Pervertinti"}
          </button>
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// ResultsPage (default export)
// -----------------------------------------------------------
//
// Owns the list, the theme tree, the selected activity and
// every request: /api/activities/evaluated and /api/themes
// load in parallel on mount; re-scoring PATCHes
// /api/activities/:id/committee with action "score" plus the
// (possibly reassigned) theme/subtheme ids and patches the
// row and the open modal in place. One error/status line
// (msg) serves the table and the modal.
//
// Used by:
//   - App.jsx — route /committee/results
// -----------------------------------------------------------

export default function ResultsPage() {

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [themes, setThemes] = useState([]);


  // Evaluated activities and themes load in parallel on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [actsRes, themesRes] = await Promise.all([
          fetch("/api/activities/evaluated", {
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
          throw new Error(actsData?.error || `${actsRes.status} ${actsRes.statusText}`);
        }

        const themesData = await themesRes.json().catch(() => ({}));
        if (!themesRes.ok) {
          throw new Error(themesData?.error || `${themesRes.status} ${themesRes.statusText}`);
        }

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
          // ignore JSON
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


  // Opening a row also clears the status line
  const openModal = (act) => {
    setSelectedActivity(act);
    setMsg("");
  };


  // The modal's save: PATCH, then patch the row and the open
  // modal in place (re-scoring keeps ĮVERTINTA). Throws on a
  // failed response — the modal shows the message
  const handleRescore = async (body) => {
    const activeRole = getActiveRole();

    const res = await fetch(
      `/api/activities/${selectedActivity.id}/committee`,
      {
        method: "PATCH",
        headers: {
          "X-Active-Role": activeRole,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `${res.status} ${res.statusText}`);
    }

    setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
    setSelectedActivity(data);
    return data;
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Įvertinimai</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          <div className="card-body">
            <ResultsTable
              items={items}
              loading={loading}
              onOpen={openModal}
            />

            {msg && (
              <div className="form-status form-status--error">
                {msg}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Mounted fresh per opened row — the modal seeds its
          edit fields from the activity on mount */}
      {selectedActivity && (
        <ResultsModal
          activity={selectedActivity}
          themes={themes}
          downloading={downloadingId === selectedActivity.id}
          onDownload={handleDownload}
          onRescore={handleRescore}
          onClose={() => setSelectedActivity(null)}
          onMessage={setMsg}
        />
      )}
    </div>
  );
}
