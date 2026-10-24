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
//  Only a whole people count gives a score — a blank,
//  negative or fractional one previews nothing and is refused
//  before any request — and a theme without subthemes cannot
//  be saved: with no subtheme to send, the backend would pair
//  the new theme with the activity's old subtheme and refuse
//  it. A success answer that is not the activity is refused
//  too. The modal is a dialog that takes the focus and gives
//  it back; its backdrop closes it only on a press and
//  release of its own and never while a save is in flight,
//  and a save's answer touches the modal only while it still
//  shows that activity.
//
//  Split into (root component last):
//
//    codeToNums          — "1.2.3" → [1,2,3]
//    compareCodes        — numeric-aware code ordering
//    sortedSubthemes     — a theme's subthemes, code-ordered
//    statusClass         — status → pill css class
//    formatDate          — ISO → lt-LT date-time
//    scoreForCount       — a people count → its score
//    ResultsTable        — the ĮVERTINTA rows with scores
//    ThemeSubthemeFields — theme/subtheme, editable while
//                          re-scoring
//    ActivityDetails     — the modal's read-only fields
//    ResultsModal        — review + re-scoring modal
//    ResultsPage         — list state, requests (default)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import { AppSelect, ModalStatus } from "@/components/appCommon.jsx";
import { useBackdropClose, useModalDialog } from "@/components/sharedHooks.js";
import { apiJson, apiJsonAll, downloadAttachment, reasonOf } from "@/components/api.js";
import "@/components/employee.css";







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
// scoreForCount
// -----------------------------------------------------------
//
// The score a people count gives — 1/n rounded to 2
// decimals, 0 for nobody — or null for a count the save
// refuses: blank, negative or not a whole number. The live
// preview and the save both ask it, so the preview never
// shows a score that would not be sent. The evaluate page
// keeps a copy of the same rule.
//
// Used by:
//   - ResultsModal (below) — the preview and the save
// -----------------------------------------------------------

function scoreForCount(count) {
  if (!count.trim()) return null;
  const n = Number(count);
  if (!Number.isInteger(n) || n < 0) return null;
  return n === 0 ? 0 : Number((1 / n).toFixed(2));
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
// shows "(potemių nėra)". The pickers are named by the
// captions through labelledBy.
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
        <div className="employee-modal-label" id="results-theme-label">Tema</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.theme_code} — {act.theme_title}
          </div>
        ) : (
          <AppSelect
            labelledBy="results-theme-label"
            value={themeId}
            onChange={handleThemeChange}
            options={themes}
            getLabel={(t) => `${t.code} — ${t.title}`}
            placeholder="Pasirinkite temą"
          />
        )}
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label" id="results-subtheme-label">Potemė</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.subtheme_code} — {act.subtheme_title}
          </div>
        ) : subthemes.length === 0 ? (
          <div className="employee-modal-muted">(potemių nėra)</div>
        ) : (
          <AppSelect
            labelledBy="results-subtheme-label"
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
// edit state — mounted fresh per opened row, keyed by its
// id, so the fields seed from the row: theme/subtheme ids,
// committee comments, the people count (blank) and the score
// preview. "Pervertinti" arms re-scoring; "Išsaugoti
// įvertinimą" — disabled while the picked theme leaves no
// subtheme to save — validates the people count (given, not
// negative, whole), derives its score (scoreForCount) and
// hands { action: "score", …, theme_id, subtheme_id } to
// onRescore, which resolves with the updated activity or
// throws. Re-scoring keeps ĮVERTINTA, so the modal stays
// open showing the saved values. The box is a dialog named
// by its title that takes the focus; the backdrop closes it
// only on a press and release of its own and not while the
// save is in flight. The validation refusals, the saved
// confirmation, a refused save's "Klaida: …" and a refused
// download show on the modal's own status line, inside the
// box.
//
// Used by:
//   - ResultsPage (below) — while an activity is selected
// -----------------------------------------------------------

function ResultsModal({ activity, themes, downloading, onDownload, onRescore, onClose }) {

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
  const [status, setStatus] = useState(null);
  const backdrop = useBackdropClose(onClose, savingScore);
  const dialogRef = useModalDialog();

  // Theme reassignment
  const [editThemeId, setEditThemeId] = useState(String(act.theme_id));
  const [editSubthemeId, setEditSubthemeId] = useState(String(act.subtheme_id));

  // A theme without subthemes leaves no subtheme to send, and
  // the backend would then pair the new theme with the old
  // subtheme and refuse it — so the save waits for a theme
  // that has subthemes
  const noSubtheme = editingScore && !editSubthemeId;


  // Typing a count previews its score live; a count the save
  // would refuse — a cleared one included — previews nothing
  const handlePeopleNumChange = (e) => {
    const val = e.target.value;
    setPeopleNum(val);

    const s = scoreForCount(val);
    setEditScore(s === null ? "" : String(s));
  };


  // First click arms re-scoring; second click validates the
  // people count, derives its score and saves with the
  // theme/subtheme too
  const handleReevaluateClick = async () => {
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
      setStatus({ text: "Įvertinimas atnaujintas.", error: false });
    } catch (e) {
      setStatus({ text: `Klaida: ${reasonOf(e)}`, error: true });
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
        aria-labelledby="results-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title" id="results-modal-title">
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
            onDownload={download}
          />

          {/* Committee comments — writable only while
              re-scoring. The label is forced block: a <label>
              is inline and .employee-modal-label sets no
              display, so the control would otherwise sit
              beside it */}
          <div className="employee-modal-field">
            <label
              className="employee-modal-label"
              htmlFor="results-committee-comments"
              style={{ display: "block" }}
            >
              Komisijos nario komentarai
            </label>
            <textarea
              id="results-committee-comments"
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
                htmlFor="results-people-num"
                style={{ display: "block" }}
              >
                Veiklos vykdytojų kiekis
              </label>
              <input
                id="results-people-num"
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
            <div className="employee-modal-label" id="results-score-label">
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
                aria-labelledby="results-score-label"
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
            onClick={handleReevaluateClick}
            className="btn btn-primary btn-sm"
            disabled={savingScore || noSubtheme}
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
// (possibly reassigned) theme/subtheme ids, refuses a
// success answer that is not the activity, and patches the
// row in place — and the open modal too, while it still
// shows that activity. handleDownload rejects with the text
// to show, which the modal shows on its own status line, as
// it does its save's outcome; the page's line serves the
// load, and opening a row clears it.
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
        const [actsData, themesData] = await apiJsonAll([["/api/activities/evaluated"], ["/api/themes"]]);

        // A non-list 200 body (an object, null, a string)
        // would blow up the rows or the modal's theme lookup
        if (!Array.isArray(actsData)) throw new Error("Klaida: netikėtas serverio atsakymas.");
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


  // Opening a row also clears the status line
  const openModal = (act) => {
    setSelectedActivity(act);
    setMsg("");
  };


  // The modal's save: PATCH, then patch the row in place
  // (re-scoring keeps ĮVERTINTA), and the modal while it
  // still shows this activity — one closed or moved on to
  // another row in the meantime is left as it is. Throws on a
  // failed response, and on a 2xx answer that is not this
  // activity — the client hands back {} for a body that is
  // not JSON, which does not say the score was stored. The
  // modal shows the message
  const handleRescore = async (body) => {
    const id = selectedActivity.id;
    const data = await apiJson(`/api/activities/${id}/committee`, { method: "PATCH", json: body });
    if (String(data?.id) !== String(id) || typeof data.status !== "string") {
      throw new Error("Klaida: netikėtas serverio atsakymas.");
    }

    setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
    setSelectedActivity((cur) => (cur?.id === id ? data : cur));
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

      {/* Mounted fresh per opened row — keyed by the
          activity, so a row opened straight from another one
          does not inherit its edit fields, which the modal
          seeds from the activity on mount */}
      {selectedActivity && (
        <ResultsModal
          key={selectedActivity.id}
          activity={selectedActivity}
          themes={themes}
          downloading={downloadingId === selectedActivity.id}
          onDownload={handleDownload}
          onRescore={handleRescore}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
  );
}
