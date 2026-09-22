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
//  Split into (root component last):
//
//    getActiveRole       — activeRole from localStorage
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
import { AppSelect, ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_BIG } from "@/components/appCommon.jsx";
import "@/components/employee.css";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request.
//
// Used by:
//   - MyActivitiesPage (below) — every API call
// -----------------------------------------------------------

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}







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
// per-row busy ids are turned into booleans per row. Loading
// and empty states are early returns.
//
// Used by:
//   - MyActivitiesPage (below)
// -----------------------------------------------------------

function ActivitiesTable({
  items,
  loading,
  downloadingId,
  deletingId,
  resubmittingId,
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
              downloading={downloadingId === act.id}
              deleting={deletingId === act.id}
              resubmitting={resubmittingId === act.id}
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
// the subtheme field shows "(potemių nėra)".
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


  const handleThemeChange = (val) => {
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
        ) : subthemesForEdit.length === 0 ? (
          <div className="employee-modal-muted">(potemių nėra)</div>
        ) : (
          <AppSelect
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
      <div className="employee-modal-label">Priedas</div>
      <div className="employee-modal-file">
        <input
          type="file"
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
// The review/edit modal for one activity. It owns the edit
// state — mounted fresh per opened row, so the fields seed
// from the row in view mode. "Redaguoti" appears only for
// PATEIKTA / TIKSLINTI activities; "Išsaugoti" validates
// theme, subtheme and title, builds the multipart body —
// theme_code / subtheme_code go along (before any file) so a
// replacement attachment gets the right filename prefix on
// the backend — and hands it to onSave, which resolves with
// the updated activity or throws. Status text goes up through
// onMessage.
//
// Used by:
//   - MyActivitiesPage (below) — while an activity is selected
// -----------------------------------------------------------

function ActivityModal({ activity, themes, downloading, onDownload, onSave, onClose, onMessage }) {

  const act = activity;

  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Edit-form state, seeded from the row and read when saving
  const [editThemeId, setEditThemeId] = useState(String(act.theme_id));
  const [editSubthemeId, setEditSubthemeId] = useState(String(act.subtheme_id));
  const [editTitle, setEditTitle] = useState(act.title || "");
  const [editDescription, setEditDescription] = useState(act.description || "");
  const [editAttachmentFile, setEditAttachmentFile] = useState(null);


  const canEdit =
    act.status === "PATEIKTA" ||
    act.status === "TIKSLINTI";


  // An oversized pick is refused on the spot and the input
  // cleared, so nothing is sent
  const handleFileChange = (picked, input) => {
    if (picked && picked.size > ATTACHMENT_MAX_BYTES) {
      onMessage(ATTACHMENT_TOO_BIG);
      setEditAttachmentFile(null);
      if (input) input.value = "";
      return;
    }
    onMessage("");
    setEditAttachmentFile(picked);
  };


  const handleSaveEdit = async () => {
    if (!editThemeId || !editSubthemeId || !editTitle.trim()) {
      onMessage("Prašome užpildyti temą, potemę ir pavadinimą.");
      return;
    }
    if (editAttachmentFile && editAttachmentFile.size > ATTACHMENT_MAX_BYTES) {
      onMessage(ATTACHMENT_TOO_BIG);
      return;
    }

    try {
      setSavingEdit(true);
      onMessage("");

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

      await onSave(formData);

      setEditing(false);
      onMessage("Veikla sėkmingai atnaujinta.");
    } catch (e) {
      onMessage(`Klaida: Nepavyko atnaujinti: ${e.message}`);
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
        <h3 className="employee-modal-title">Veiklos peržiūra</h3>
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
            <div className="employee-modal-label">
              Veiklos pavadinimas
            </div>
            {!editing ? (
              <div className="employee-modal-value">{act.title}</div>
            ) : (
              <input
                className="field-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            )}
          </div>

          {/* Description */}
          <div className="employee-modal-field">
            <div className="employee-modal-label">
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
            onDownload={onDownload}
            file={editAttachmentFile}
            onFileChange={handleFileChange}
          />
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
// per-row busy ids (downloadingId / deletingId /
// resubmittingId — each disables only the touched row's
// button) and every request. All mutations patch the local
// list in place; a resubmit or save also refreshes the open
// modal's activity. One status line (msg) serves everything.
//
// Used by:
//   - App.jsx — route /employee/my
// -----------------------------------------------------------

export default function MyActivitiesPage() {

  const [items, setItems] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [resubmittingId, setResubmittingId] = useState(null);
  const [msg, setMsg] = useState("");
  const [selectedActivity, setSelectedActivity] = useState(null);


  // Activities and themes load in parallel on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [actsRes, themesRes] = await Promise.all([
          fetch("/api/activities/my", {
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

        const themesData = await themesRes.json().catch(() => ({}));
        if (!themesRes.ok) {
          throw new Error(
            themesData?.error || `${themesRes.status} ${themesRes.statusText}`
          );
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


  const handleDelete = async (act) => {
    if (!window.confirm("Ar tikrai norite ištrinti šią veiklą?")) return;
    try {
      setDeletingId(act.id);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(`/api/activities/${act.id}`, {
        method: "DELETE",
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

      setItems((prev) => prev.filter((x) => x.id !== act.id));
      setMsg("Veikla sėkmingai ištrinta.");
    } catch (e) {
      setMsg(`Klaida: Nepavyko ištrinti veiklos: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };


  const handleResubmit = async (act) => {
    if (act.status !== "TIKSLINTI") return;
    if (!window.confirm("Ar tikrai norite pateikti veiklą iš naujo?")) return;

    try {
      setResubmittingId(act.id);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(`/api/activities/${act.id}/resubmit`, {
        method: "POST",
        headers: {
          "X-Active-Role": activeRole,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      // Patch the row (and the open modal) with the returned
      // fresh copy
      setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      if (selectedActivity && selectedActivity.id === data.id) {
        setSelectedActivity(data);
      }

      setMsg("Veikla sėkmingai pateikta iš naujo.");
    } catch (e) {
      setMsg(`Klaida: Nepavyko pateikti iš naujo: ${e.message}`);
    } finally {
      setResubmittingId(null);
    }
  };


  // The modal's save: multipart PATCH, then patch the row and
  // the open modal in place. Throws on a failed response —
  // the modal shows the message
  const handleSave = async (formData) => {
    const activeRole = getActiveRole();

    const res = await fetch(`/api/activities/${selectedActivity.id}`, {
      method: "PATCH",
      headers: {
        "X-Active-Role": activeRole,
      },
      body: formData,
    });

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
          <h1 className="page-title">Mano veiklos</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          <ActivitiesTable
            items={items}
            loading={loading}
            downloadingId={downloadingId}
            deletingId={deletingId}
            resubmittingId={resubmittingId}
            onDownload={handleDownload}
            onOpen={setSelectedActivity}
            onResubmit={handleResubmit}
            onDelete={handleDelete}
          />

          {msg && <div className="form-status">{msg}</div>}
        </section>
      </main>

      {/* Mounted fresh per opened row — the modal seeds its
          edit fields from the activity on mount */}
      {selectedActivity && (
        <ActivityModal
          activity={selectedActivity}
          themes={themes}
          downloading={downloadingId === selectedActivity.id}
          onDownload={handleDownload}
          onSave={handleSave}
          onClose={() => setSelectedActivity(null)}
          onMessage={setMsg}
        />
      )}
    </div>
  );
}
