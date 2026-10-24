// -----------------------------------------------------------
//  [*] Employee — my activities list
//
//  /employee/my: every activity the employee has submitted,
//  as a table with status pills, the manager's comment, the
//  score and the attachment. A row opens the review modal;
//  PATEIKTA/TIKSLINTI activities can be edited there,
//  TIKSLINTI ones resubmitted, and anything not yet approved/
//  scored/rejected deleted.
//
//  Activities and the theme tree load together on mount; all
//  mutations patch the local list in place instead of
//  refetching. Auth rides in the session cookie; only the
//  X-Active-Role header travels.
//
//  The review modal is a modal dialog keyed by its activity:
//  opening another activity always mounts a fresh one, and a
//  save or resubmit answer refreshes it only while it still
//  shows that activity. Its backdrop closes it only on a
//  press and release of its own, never mid-save. The row
//  actions keep their busy flags per row, so one row's
//  request never re-enables another row's buttons.
//
//  Split into (root component last):
//
//    statusClass         — status → pill css class
//    formatDate          — ISO → lt-LT date-time
//    AttachmentButton    — download button with busy label
//    ActivityRow         — one table row + its actions
//    ActivitiesTable     — the list (loading/empty/rows)
//    ThemeSubthemeFields — theme/subtheme, editable in edit
//                          mode
//    AttachmentField     — download in view, replace in edit
//    ActivityModal       — review + edit modal (own state)
//    MyActivitiesPage    — list state, requests (default)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import {
  AppSelect,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TOO_BIG,
  ModalStatus,
} from "@/components/appCommon.jsx";
import { useBackdropClose, useBusyIds, useModalDialog } from "@/components/sharedHooks.js";
import { apiJson, apiJsonAll, apiSend, downloadAttachment, reasonOf } from "@/components/api.js";
import "@/components/employee.css";







// -----------------------------------------------------------
// statusClass
// -----------------------------------------------------------
//
// Activity status → status-pill modifier class; this copy
// knows TIKSLINTI (the committee pages' copies don't).
//
// Used by:
//   - ActivityRow, ActivityModal (below)
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
//   - ActivityRow (below) — the Data column
//   - ActivityModal (below) — the Sukurta line
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
// AttachmentButton
// -----------------------------------------------------------
//
// The attachment download button — labelled with the original
// filename (or "Atsisiųsti"), "Atsisiunčiama…" and disabled
// while this activity's download is in flight. Callers render
// their own "(nėra)" when there is no attachment.
//
// Used by:
//   - ActivityRow, AttachmentField (below)
// -----------------------------------------------------------

function AttachmentButton({ act, downloading, onDownload }) {
  return (
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
  );
}







// -----------------------------------------------------------
// ActivityRow
// -----------------------------------------------------------
//
// One table row: date, theme, subtheme, title, status pill,
// the manager's rejection comment, the score, the attachment
// button and the actions — review always; resubmit only for
// TIKSLINTI; delete until the activity is approved, scored or
// rejected. The busy flags disable only this row's buttons.
//
// Used by:
//   - ActivitiesTable (below)
// -----------------------------------------------------------

function ActivityRow({
  act,
  downloading,
  deleting,
  resubmitting,
  onDownload,
  onOpen,
  onResubmit,
  onDelete,
}) {
  return (
    <tr>
      <td>{formatDate(act.created_at)}</td>
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
        {act.rejection_comment ? (
          act.rejection_comment
        ) : (
          <span className="table-muted">(nėra)</span>
        )}
      </td>
      <td>
        {act.score !== null && act.score !== undefined ? (
          act.score
        ) : (
          <span className="table-muted">(nėra)</span>
        )}
      </td>
      <td>
        {act.attachment_path ? (
          <AttachmentButton
            act={act}
            downloading={downloading}
            onDownload={onDownload}
          />
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

          {act.status === "TIKSLINTI" && (
            <button
              type="button"
              onClick={() => onResubmit(act)}
              className="btn btn-primary btn-sm"
              disabled={resubmitting}
            >
              {resubmitting ? "Pateikiama…" : "Pateikti"}
            </button>
          )}

          {act.status !== "PATVIRTINTA" &&
            act.status !== "ĮVERTINTA" &&
            act.status !== "ATMESTA" && (
              <button
                type="button"
                onClick={() => onDelete(act)}
                className="btn btn-ghost btn-sm btn-danger"
                disabled={deleting}
              >
                {deleting ? "Šalinama…" : "Ištrinti"}
              </button>
            )}
        </div>
      </td>
    </tr>
  );
}







// -----------------------------------------------------------
// ActivitiesTable
// -----------------------------------------------------------
//
// The employee's activities as a table of ActivityRows; the
// page's per-row busy flags are asked about each row and
// handed down as booleans. Loading and empty states are early
// returns.
//
// Used by:
//   - MyActivitiesPage (below)
// -----------------------------------------------------------

function ActivitiesTable({
  items,
  loading,
  isDownloading,
  isDeleting,
  isResubmitting,
  onDownload,
  onOpen,
  onResubmit,
  onDelete,
}) {
  if (loading) {
    return <div className="employee-muted">Kraunama…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="employee-empty">
        (Dar nepateikėte jokių veiklų.)
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="table my-activities-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Tema</th>
            <th>Potemė</th>
            <th>Veiklos pavadinimas</th>
            <th>Būsena</th>
            <th>Komentaras</th>
            <th>Įvertinimas</th>
            <th>Priedas</th>
            <th>Veiksmai</th>
          </tr>
        </thead>
        <tbody>
          {items.map((act) => (
            <ActivityRow
              key={act.id}
              act={act}
              downloading={isDownloading(act.id)}
              deleting={isDeleting(act.id)}
              resubmitting={isResubmitting(act.id)}
              onDownload={onDownload}
              onOpen={onOpen}
              onResubmit={onResubmit}
              onDelete={onDelete}
            />
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
// Picking a new theme preselects its first subtheme (in the
// order the API returned them), or "" when it has none — then
// the subtheme field shows "(potemių nėra)". Picking the
// theme already shown changes nothing, so the activity's
// subtheme survives a re-pick. The pickers are named by the
// captions (ids activity-edit-theme-label and
// activity-edit-subtheme-label) through labelledBy.
//
// Used by:
//   - ActivityModal (below)
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

  const themeForEdit = themes.find((t) => String(t.id) === themeId);
  const subthemesForEdit = themeForEdit?.subthemes || [];


  // AppSelect reports a click on the option already selected
  // like any other pick; answering it would swap the
  // activity's subtheme for the theme's first, so a pick of
  // the theme already shown is ignored
  const handleThemeChange = (val) => {
    if (String(val) === String(themeId)) return;
    onThemeChange(val);
    const t = themes.find(
      (t) => String(t.id) === String(val)
    );
    const firstSub = t?.subthemes?.[0];
    onSubthemeChange(
      firstSub ? String(firstSub.id) : ""
    );
  };


  return (
    <>
      <div className="employee-modal-field">
        <div className="employee-modal-label" id="activity-edit-theme-label">Tema</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.theme_code} — {act.theme_title}
          </div>
        ) : (
          <AppSelect
            labelledBy="activity-edit-theme-label"
            value={themeId}
            onChange={handleThemeChange}
            options={themes}
            getLabel={(t) => `${t.code} — ${t.title}`}
            placeholder="Pasirinkite temą"
          />
        )}
      </div>

      <div className="employee-modal-field">
        <div className="employee-modal-label" id="activity-edit-subtheme-label">Potemė</div>
        {!editing ? (
          <div className="employee-modal-value">
            {act.subtheme_code} — {act.subtheme_title}
          </div>
        ) : subthemesForEdit.length === 0 ? (
          <div className="employee-modal-muted">(potemių nėra)</div>
        ) : (
          <AppSelect
            labelledBy="activity-edit-subtheme-label"
            value={subthemeId}
            onChange={(val) => onSubthemeChange(val)}
            options={subthemesForEdit}
            getLabel={(s) => `${s.code} — ${s.title}`}
            placeholder="Pasirinkite potemę"
          />
        )}
      </div>
    </>
  );
}







// -----------------------------------------------------------
// AttachmentField
// -----------------------------------------------------------
//
// The modal's Priedas field: the download button (or "(nėra)")
// in view mode; in edit mode a file input whose empty state
// keeps the current attachment, with hints naming the current
// file and the newly picked one. onFileChange(file, input)
// gets the input too, so an oversized pick can be cleared.
// The file input is named by the "Priedas" caption through
// aria-labelledby — see ActivityModal on why not a <label>.
//
// Used by:
//   - ActivityModal (below)
// -----------------------------------------------------------

function AttachmentField({ act, editing, downloading, onDownload, file, onFileChange }) {
  if (!editing) {
    return (
      <div className="employee-modal-field">
        <div className="employee-modal-label">Priedas</div>
        {act.attachment_path ? (
          <AttachmentButton
            act={act}
            downloading={downloading}
            onDownload={onDownload}
          />
        ) : (
          <div className="employee-modal-muted">(nėra)</div>
        )}
      </div>
    );
  }

  return (
    <div className="employee-modal-field">
      <div className="employee-modal-label" id="activity-edit-attachment-label">Priedas</div>
      <div className="employee-modal-file">
        <input
          type="file"
          aria-labelledby="activity-edit-attachment-label"
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => onFileChange(e.target.files[0] || null, e.target)}
          className="field-input-file"
        />
        <div className="employee-file-hint">
          Palikite tuščią, jei nenorite keisti priedo.
        </div>
        {act.attachment_path && !file && (
          <div className="employee-file-hint">
            Dabartinis failas:{" "}
            {act.attachment_original_name ||
              act.attachment_path}
          </div>
        )}
        {file && (
          <div className="employee-file-hint">
            Pasirinktas naujas failas:{" "}
            {file.name}
          </div>
        )}
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// ActivityModal
// -----------------------------------------------------------
//
// The review/edit dialog for one activity. It owns the edit
// state and is keyed by the activity's id, so another
// activity always mounts a fresh dialog whose fields seed
// from its row in view mode, while an answer for the same
// activity only swaps `activity` and keeps the edit state.
// "Redaguoti" appears only for PATEIKTA / TIKSLINTI
// activities; "Išsaugoti" validates theme, subtheme and
// title, builds the multipart body — theme_code /
// subtheme_code go along (before any file) so a replacement
// attachment gets the right filename prefix on the backend —
// and hands it to onSave with the dialog's own activity id,
// which resolves with the updated activity or throws. A
// successful save clears the picked file, so the next edit
// starts with none. A file that reaches the 100 MB limit is
// refused at the pick and again at the save, the way the
// backend would refuse it. The dialog's status — those
// refusals, a refused save or download, and the saved
// confirmation — shows on its own line, inside the box.
//
// The box is a modal dialog named by its title: the focus
// moves in when it opens and back to the opener when it
// closes. The backdrop closes it only on a press and release
// of its own — a selection dragged out of a field does not —
// and not at all while a save is in flight, when Uždaryti is
// disabled too.
//
// The field captions are divs, not <label>s —
// .employee-modal-label counts on the div's block display and
// an inline <label> would share the input's line — so the
// edit inputs and pickers take their accessible names from
// the captions through aria-labelledby (ids
// activity-edit-*-label).
//
// Used by:
//   - MyActivitiesPage (below) — while an activity is selected
// -----------------------------------------------------------

function ActivityModal({ activity, themes, downloading, onDownload, onSave, onClose }) {

  const act = activity;

  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Edit-form state, seeded from the row and read when saving
  const [editThemeId, setEditThemeId] = useState(String(act.theme_id));
  const [editSubthemeId, setEditSubthemeId] = useState(String(act.subtheme_id));
  const [editTitle, setEditTitle] = useState(act.title || "");
  const [editDescription, setEditDescription] = useState(act.description || "");
  const [editAttachmentFile, setEditAttachmentFile] = useState(null);
  const [status, setStatus] = useState(null);

  // The backdrop stays as shut as Uždaryti while a save is in
  // flight, so the answer always finds this dialog open
  const backdrop = useBackdropClose(onClose, savingEdit);
  const dialogRef = useModalDialog();


  const canEdit =
    act.status === "PATEIKTA" ||
    act.status === "TIKSLINTI";


  // An oversized pick is refused on the spot and the input
  // cleared, so nothing is sent. A file of exactly the limit
  // counts: the backend turns away one that reaches it
  const handleFileChange = (picked, input) => {
    if (picked && picked.size >= ATTACHMENT_MAX_BYTES) {
      setStatus({ text: ATTACHMENT_TOO_BIG, error: true });
      setEditAttachmentFile(null);
      if (input) input.value = "";
      return;
    }
    setStatus(null);
    setEditAttachmentFile(picked);
  };


  const handleSaveEdit = async () => {
    if (!editThemeId || !editSubthemeId || !editTitle.trim()) {
      setStatus({ text: "Prašome užpildyti temą, potemę ir pavadinimą.", error: true });
      return;
    }
    if (editAttachmentFile && editAttachmentFile.size >= ATTACHMENT_MAX_BYTES) {
      setStatus({ text: ATTACHMENT_TOO_BIG, error: true });
      return;
    }

    try {
      setSavingEdit(true);
      setStatus(null);

      const formData = new FormData();
      formData.append("theme_id", editThemeId);
      formData.append("subtheme_id", editSubthemeId);
      formData.append("title", editTitle);
      formData.append("description", editDescription || "");

      const themeObj = themes.find((t) => String(t.id) === String(editThemeId));
      const subObj = themeObj?.subthemes?.find(
        (s) => String(s.id) === String(editSubthemeId)
      );
      const themeCode = themeObj?.code || act?.theme_code || "unknown_theme_code";
      const subthemeCode = subObj?.code || act?.subtheme_code || "unknown_subtheme_code";
      formData.append("theme_code", themeCode);
      formData.append("subtheme_code", subthemeCode);

      if (editAttachmentFile) {
        formData.append("attachment", editAttachmentFile);
      }

      // The save goes to this dialog's own activity, never to
      // whatever the page has selected by now
      await onSave(act.id, formData);

      // The pick has been uploaded and the file input leaves
      // with the edit form, so the next edit starts with
      // nothing picked instead of sending the file again
      setEditAttachmentFile(null);
      setEditing(false);
      setStatus({ text: "Veikla sėkmingai atnaujinta.", error: false });
    } catch (e) {
      setStatus({ text: `Klaida: Nepavyko atnaujinti: ${reasonOf(e)}`, error: true });
    } finally {
      setSavingEdit(false);
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
        aria-labelledby="activity-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="employee-modal-title" id="activity-dialog-title">Veiklos peržiūra</h3>
        <div className="employee-modal-meta">
          Sukurta: {formatDate(act.created_at)}
        </div>

        <div className="employee-modal-grid">
          <ThemeSubthemeFields
            act={act}
            editing={editing}
            themes={themes}
            themeId={editThemeId}
            subthemeId={editSubthemeId}
            onThemeChange={setEditThemeId}
            onSubthemeChange={setEditSubthemeId}
          />

          {/* Title */}
          <div className="employee-modal-field">
            <div className="employee-modal-label" id="activity-edit-title-label">
              Veiklos pavadinimas
            </div>
            {!editing ? (
              <div className="employee-modal-value">{act.title}</div>
            ) : (
              <input
                aria-labelledby="activity-edit-title-label"
                className="field-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            )}
          </div>

          {/* Description */}
          <div className="employee-modal-field">
            <div className="employee-modal-label" id="activity-edit-description-label">
              Veiklos aprašymas
            </div>
            {!editing ? (
              act.description ? (
                <div className="employee-modal-value">
                  {act.description}
                </div>
              ) : (
                <div className="employee-modal-muted">(nenurodyta)</div>
              )
            ) : (
              <textarea
                aria-labelledby="activity-edit-description-label"
                className="field-textarea"
                value={editDescription}
                onChange={(e) =>
                  setEditDescription(e.target.value)
                }
              />
            )}
          </div>

          {/* Status — never editable */}
          <div className="employee-modal-field">
            <div className="employee-modal-label">Būsena</div>
            <div className="employee-modal-value">
              <span className={statusClass(act.status)}>
                {act.status}
              </span>
            </div>
          </div>

          <AttachmentField
            act={act}
            editing={editing}
            downloading={downloading}
            onDownload={download}
            file={editAttachmentFile}
            onFileChange={handleFileChange}
          />
        </div>

        <ModalStatus status={status} />

        <div className="employee-modal-footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={savingEdit}
          >
            Uždaryti
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={editing ? handleSaveEdit : () => setEditing(true)}
              className="btn btn-primary btn-sm"
              disabled={savingEdit}
            >
              {editing
                ? savingEdit
                  ? "Saugoma…"
                  : "Išsaugoti"
                : "Redaguoti"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// MyActivitiesPage (default export)
// -----------------------------------------------------------
//
// Owns the list, the theme tree, the selected activity, the
// per-row busy flags for downloads, deletes and resubmits
// (useBusyIds — a row stays busy until its own request
// answers, however many run at once) and every request. All
// mutations patch the local list in place; a resubmit or
// save answer also refreshes the open dialog, but only while
// it still shows that activity — it may have been opened,
// closed or switched to another row since the click.
// handleDownload rejects with the text to show: the dialog
// shows it on its own status line, a row's download on the
// page's line, which also serves the load, the deletes and
// the resubmits.
//
// Used by:
//   - App.jsx — route /employee/my
// -----------------------------------------------------------

export default function MyActivitiesPage() {

  const [items, setItems] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selectedActivity, setSelectedActivity] = useState(null);

  // Kept per row, so a second row's request never re-enables
  // the first row's buttons while its own is in flight
  const downloading = useBusyIds();
  const deleting = useBusyIds();
  const resubmitting = useBusyIds();


  // Activities and themes load in parallel on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const [actsData, themesData] = await apiJsonAll([["/api/activities/my"], ["/api/themes"]]);

        // Anything but the array (an object, null…) would
        // blank the page at items.map() on the next render
        if (!Array.isArray(actsData)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        // Same for the tree: the modal's pickers run .find()
        // over it and would blank the page when one opens
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
      downloading.start(act.id);
      await downloadAttachment(act);
    } catch (e) {
      throw new Error(`Klaida: Nepavyko atsisiųsti priedo: ${reasonOf(e)}`);
    } finally {
      downloading.stop(act.id);
    }
  };


  // A row's download reports on the page's line
  const downloadFromRow = async (act) => {
    setMsg("");
    try {
      await handleDownload(act);
    } catch (e) {
      setMsg(e.message);
    }
  };


  const handleDelete = async (act) => {
    if (!window.confirm("Ar tikrai norite ištrinti šią veiklą?")) return;
    try {
      deleting.start(act.id);
      setMsg("");
      await apiSend(`/api/activities/${act.id}`, { method: "DELETE" });

      setItems((prev) => prev.filter((x) => x.id !== act.id));
      setMsg("Veikla sėkmingai ištrinta.");
    } catch (e) {
      setMsg(`Klaida: Nepavyko ištrinti veiklos: ${reasonOf(e)}`);
    } finally {
      deleting.stop(act.id);
    }
  };


  const handleResubmit = async (act) => {
    if (act.status !== "TIKSLINTI") return;
    if (!window.confirm("Ar tikrai norite pateikti veiklą iš naujo?")) return;

    try {
      resubmitting.start(act.id);
      setMsg("");
      const data = await apiJson(`/api/activities/${act.id}/resubmit`, { method: "POST" });

      // Patch the row with the returned fresh copy, and the
      // dialog if it shows this activity when the answer
      // arrives — it may have been opened since the click, so
      // the selection of that moment is no guide
      setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      setSelectedActivity((cur) => (cur && cur.id === data.id ? data : cur));

      setMsg("Veikla sėkmingai pateikta iš naujo.");
    } catch (e) {
      setMsg(`Klaida: Nepavyko pateikti iš naujo: ${reasonOf(e)}`);
    } finally {
      resubmitting.stop(act.id);
    }
  };


  // The dialog's save: multipart PATCH of the activity the
  // dialog was opened for, then patch the row in place, and
  // the dialog only while it still shows that activity —
  // another row's dialog may be open by the time the answer
  // arrives, and a closed one stays closed. Throws on a
  // failed response; the dialog reports it
  const handleSave = async (id, formData) => {
    const data = await apiJson(`/api/activities/${id}`, { method: "PATCH", form: formData });

    setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
    setSelectedActivity((cur) => (cur && cur.id === data.id ? data : cur));
    return data;
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Mano veiklos</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          <ActivitiesTable
            items={items}
            loading={loading}
            isDownloading={downloading.isBusy}
            isDeleting={deleting.isBusy}
            isResubmitting={resubmitting.isBusy}
            onDownload={downloadFromRow}
            onOpen={setSelectedActivity}
            onResubmit={handleResubmit}
            onDelete={handleDelete}
          />

          {msg && <div className="form-status">{msg}</div>}
        </section>
      </main>

      {/* Keyed by the activity: another row always mounts a
          fresh dialog, which seeds its edit fields from the
          activity on mount, while an answer for the activity
          shown refreshes it in place */}
      {selectedActivity && (
        <ActivityModal
          key={selectedActivity.id}
          activity={selectedActivity}
          themes={themes}
          downloading={downloading.isBusy(selectedActivity.id)}
          onDownload={handleDownload}
          onSave={handleSave}
          onClose={() => setSelectedActivity(null)}
        />
      )}
    </div>
  );
}
