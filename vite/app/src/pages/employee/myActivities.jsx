import { useEffect, useState } from "react";
import { AppSelect } from "../../components/appCommon.jsx";
import "../../components/employee.css";

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}

export default function MyActivitiesPage() {
  const [items, setItems] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [resubmittingId, setResubmittingId] = useState(null);
  const [msg, setMsg] = useState("");
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [editing, setEditing] = useState(false);

  // edit fields for modal
  const [editThemeId, setEditThemeId] = useState("");
  const [editSubthemeId, setEditSubthemeId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAttachmentFile, setEditAttachmentFile] = useState(null);

  // load activities + themes
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
    //ignore
  }, []);

  const statusClass = (status) => {
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
  };

  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("lt-LT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
          // ignore
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
          // ignore
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

  const openModal = (act) => {
    setSelectedActivity(act);
    setEditing(false);
    setEditThemeId(String(act.theme_id));
    setEditSubthemeId(String(act.subtheme_id));
    setEditTitle(act.title || "");
    setEditDescription(act.description || "");
    setEditAttachmentFile(null);
  };

  const closeModal = () => {
    setSelectedActivity(null);
    setEditing(false);
  };

  const canEdit =
    selectedActivity &&
    (selectedActivity.status === "PATEIKTA" ||
      selectedActivity.status === "TIKSLINTI");

  const themeForEdit = themes.find((t) => String(t.id) === editThemeId);
  const subthemesForEdit = themeForEdit?.subthemes || [];

  const handleSaveEdit = async () => {
    if (!selectedActivity) return;
    if (!editThemeId || !editSubthemeId || !editTitle.trim()) {
      setMsg("Prašome užpildyti temą, potemę ir pavadinimą.");
      return;
    }

    try {
      setSavingEdit(true);
      setMsg("");

      const activeRole = getActiveRole();

      const formData = new FormData();
      formData.append("theme_id", editThemeId);
      formData.append("subtheme_id", editSubthemeId);
      formData.append("title", editTitle);
      formData.append("description", editDescription || "");

      // attachment prefix editing
      const themeObj = themes.find((t) => String(t.id) === String(editThemeId));
      const subObj = themeObj?.subthemes?.find(
        (s) => String(s.id) === String(editSubthemeId)
      );
      const themeCode = themeObj?.code || selectedActivity?.theme_code || "unknown_theme_code";
      const subthemeCode = subObj?.code || selectedActivity?.subtheme_code || "unknown_subtheme_code";
      formData.append("theme_code", themeCode);
      formData.append("subtheme_code", subthemeCode);

      if (editAttachmentFile) {
        formData.append("attachment", editAttachmentFile);
      }

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
      setEditing(false);
      setMsg("Veikla sėkmingai atnaujinta.");
    } catch (e) {
      setMsg(`Klaida: Nepavyko atnaujinti: ${e.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const renderModal = () => {
    const act = selectedActivity;
    if (!act) return null;

    return (
      <div className="employee-modal-backdrop" onClick={closeModal}>
        <div
          className="employee-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="employee-modal-title">Veiklos peržiūra</h3>
          <div className="employee-modal-meta">
            Sukurta: {formatDate(act.created_at)}
          </div>

          <div className="employee-modal-grid">
            {/* theme */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Tema</div>
              {!editing ? (
                <div className="employee-modal-value">
                  {act.theme_code} — {act.theme_title}
                </div>
              ) : (
                <AppSelect
                  value={editThemeId}
                  onChange={(val) => {
                    setEditThemeId(val);
                    const t = themes.find(
                      (t) => String(t.id) === String(val)
                    );
                    const firstSub = t?.subthemes?.[0];
                    setEditSubthemeId(
                      firstSub ? String(firstSub.id) : ""
                    );
                  }}
                  options={themes}
                  getLabel={(t) => `${t.code} — ${t.title}`}
                  placeholder="Pasirinkite temą"
                />
              )}
            </div>

            {/* subtheme */}
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
                  value={editSubthemeId}
                  onChange={(val) => setEditSubthemeId(val)}
                  options={subthemesForEdit}
                  getLabel={(s) => `${s.code} — ${s.title}`}
                  placeholder="Pasirinkite potemę"
                />
              )}
            </div>

            {/* title */}
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

            {/* desc */}
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

            {/* status */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Būsena</div>
              <div className="employee-modal-value">
                <span className={statusClass(act.status)}>
                  {act.status}
                </span>
              </div>
            </div>

            {/* attach */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Priedas</div>
              {!editing ? (
                act.attachment_path ? (
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
                  <div className="employee-modal-muted">(nėra)</div>
                )
              ) : (
                <div className="employee-modal-file">
                  <input
                    type="file"
                    onChange={(e) =>
                      setEditAttachmentFile(
                        e.target.files[0] || null
                      )
                    }
                    className="field-input-file"
                  />
                  <div className="employee-file-hint">
                    Palikite tuščią, jei nenorite keisti priedo.
                  </div>
                  {act.attachment_path && !editAttachmentFile && (
                    <div className="employee-file-hint">
                      Dabartinis failas:{" "}
                      {act.attachment_original_name ||
                        act.attachment_path}
                    </div>
                  )}
                  {editAttachmentFile && (
                    <div className="employee-file-hint">
                      Pasirinktas naujas failas:{" "}
                      {editAttachmentFile.name}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="employee-modal-footer">
            <button
              type="button"
              onClick={closeModal}
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
          {loading ? (
            <div className="employee-muted">Kraunama…</div>
          ) : items.length === 0 ? (
            <div className="employee-empty">
              (Dar nepateikėte jokių veiklų.)
            </div>
          ) : (
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
                    <tr key={act.id}>
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
                          <button
                            type="button"
                            onClick={() => handleDownload(act)}
                            className="btn btn-secondary btn-sm"
                            disabled={downloadingId === act.id}
                          >
                            {downloadingId === act.id
                              ? "Atsisiunčiama…"
                              : act.attachment_original_name ||
                                "Atsisiųsti"}
                          </button>
                        ) : (
                          <span className="table-muted">(nėra)</span>
                        )}
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

                          {act.status === "TIKSLINTI" && (
                            <button
                              type="button"
                              onClick={() => handleResubmit(act)}
                              className="btn btn-primary btn-sm"
                              disabled={resubmittingId === act.id}
                            >
                              {resubmittingId === act.id
                                ? "Pateikiama…"
                                : "Pateikti"}
                            </button>
                          )}

                          {act.status !== "PATVIRTINTA" &&
                            act.status !== "ĮVERTINTA" && 
                              act.status !== "ATMESTA" && (
                              <button
                                type="button"
                                onClick={() => handleDelete(act)}
                                className="btn btn-ghost btn-sm btn-danger"
                                disabled={deletingId === act.id}
                              >
                                {deletingId === act.id
                                  ? "Šalinama…"
                                  : "Ištrinti"}
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {msg && <div className="form-status">{msg}</div>}
        </section>
      </main>

      {renderModal()}
    </div>
  );
}
