import { useEffect, useState } from "react";
import { AppSelect } from "../../components/appCommon.jsx";
import "../../components/employee.css";

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}

function codeToNums(code) {
  const parts = String(code).match(/\d+/g);
  return parts ? parts.map((n) => Number(n)) : [];
}

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

export default function ManagerReviewPage() {

  const [items, setItems] = useState([]);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [actingId, setActingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // edit modal
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [editManagerComments, setEditManagerComments] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [modalEditing, setModalEditing] = useState(false);
  const [editThemeId, setEditThemeId] = useState("");
  const [editSubthemeId, setEditSubthemeId] = useState("");

  //return modal
  const [returningActivity, setReturningActivity] = useState(null);
  const [returnComment, setReturnComment] = useState("");
  const [savingReturn, setSavingReturn] = useState(false);

  // reject modal
  const [rejectingActivity, setRejectingActivity] = useState(null);
  const [rejectComment, setRejectComment] = useState("");
  const [savingReject, setSavingReject] = useState(false);

  // load activities
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

      // remove from list
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
      // ignore
    }
  };



  const handleDeny = (act) => {
    setRejectingActivity(act);
    setRejectComment(act.rejection_comment || "");
    setMsg("");
  };

  const openEditModal = (act) => {
    setSelectedActivity(act);
    setEditManagerComments(act.manager_comments || "");
    setEditThemeId(String(act.theme_id));
    setEditSubthemeId(String(act.subtheme_id));
    setModalEditing(false);
  };

  const closeEditModal = () => {
    setSelectedActivity(null);
    setSavingEdit(false);
    setModalEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedActivity) return;

    try {
      setSavingEdit(true);

      const body = {
        manager_comments: editManagerComments,
      };

      if (modalEditing) {
        body.theme_id = parseInt(editThemeId, 10);
        body.subtheme_id = parseInt(editSubthemeId, 10);
      }

      const updated = await callManagerAction(selectedActivity.id, body);

      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setSelectedActivity(updated);
      setEditThemeId(String(updated.theme_id));
      setEditSubthemeId(String(updated.subtheme_id));
      setModalEditing(false);
      setMsg("Veikla atnaujinta.");
    } catch {
      // ignore
    } finally {
      setSavingEdit(false);
    }
  };

  const closeRejectModal = () => {
    setRejectingActivity(null);
    setSavingReject(false);
  };

  const handleConfirmDeny = async () => {
    if (!rejectingActivity) return;
    if (!rejectComment.trim()) {
      setMsg("Klaida: Atmetimui būtinas komentaras.");
      return;
    }
    try {
      setSavingReject(true);
      await callManagerAction(rejectingActivity.id, {
        action: "deny",
        rejection_comment: rejectComment,
      });
      closeRejectModal();
    } catch {
      setSavingReject(false);
    }
  };

      const handleReturn = (act) => {
      setReturningActivity(act);
      setReturnComment("");
      setMsg("");
    };

    const closeReturnModal = () => {
      setReturningActivity(null);
      setSavingReturn(false);
    };

  const handleConfirmReturn = async () => {
    if (!returningActivity) return;
    if (!returnComment.trim()) {
      setMsg("Klaida: Tikslinimui būtinas komentaras.");
      return;
    }

    try {
      setSavingReturn(true);
      await callManagerAction(returningActivity.id, {
        action: "return",
        rejection_comment: returnComment,
      });
      closeReturnModal();
    } catch {
      setSavingReturn(false);
    }
  };




  const renderModal = () => {
    const act = selectedActivity;
    if (!act) return null;

    const currentTheme = themes.find((t) => String(t.id) === editThemeId);
    const modalSubthemes = [...(currentTheme?.subthemes || [])].sort((a, b) =>
      compareCodes(a.code, b.code)
    );

    return (
      <div className="employee-modal-backdrop" onClick={closeEditModal}>
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
            {/* theme */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Tema</div>
              {!modalEditing ? (
                <div className="employee-modal-value">
                  {act.theme_code} — {act.theme_title}
                </div>
              ) : (
                <AppSelect
                  value={editThemeId}
                  onChange={(val) => {
                    setEditThemeId(val);
                    const t = themes.find((tt) => String(tt.id) === String(val));
                    const sorted = [...(t?.subthemes || [])].sort((a, b) =>
                      compareCodes(a.code, b.code)
                    );
                    const firstSub = sorted[0];
                    setEditSubthemeId(firstSub ? String(firstSub.id) : "");
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
              {!modalEditing ? (
                <div className="employee-modal-value">
                  {act.subtheme_code} — {act.subtheme_title}
                </div>
              ) : modalSubthemes.length === 0 ? (
                <div className="employee-modal-muted">(potemių nėra)</div>
              ) : (
                <AppSelect
                  value={editSubthemeId}
                  onChange={(val) => setEditSubthemeId(val)}
                  options={modalSubthemes}
                  getLabel={(s) => `${s.code} — ${s.title}`}
                  placeholder="Pasirinkite potemę"
                />
              )}
            </div>

            {/* title */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Veiklos pavadinimas</div>
              <div className="employee-modal-value">{act.title}</div>
            </div>

            {/* desc */}
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

            {/* status */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Būsena</div>
              <div className="employee-modal-value">
                <span className={statusClass(act.status)}>{act.status}</span>
              </div>
            </div>

            {/* attach */}
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
                    : act.attachment_original_name || "Atsisiųsti priedą"}
                </button>
              ) : (
                <div className="employee-modal-muted">(nėra priedo)</div>
              )}
            </div>

            {/* manager comms */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Vadybininkės komentarai</div>
              <textarea
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
              onClick={closeEditModal}
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
  };

  const renderRejectModal = () => {
    const act = rejectingActivity;
    if (!act) return null;

    return (
      <div className="employee-modal-backdrop" onClick={closeRejectModal}>
        <div
          className="employee-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="employee-modal-title">Atmesti veiklą</h3>
          <div className="employee-modal-meta">
            Darbuotojas: <strong>{act.full_name}</strong>
            <br />
            Veikla: <strong>{act.title}</strong>
          </div>

          <div className="employee-modal-field">
            <div className="employee-modal-label">Atmetimo komentaras</div>
            <textarea
              className="field-textarea"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Paaiškinkite, kodėl veikla atmetama"
            />
          </div>

          <div className="employee-modal-footer">
            <button
              type="button"
              onClick={closeRejectModal}
              className="btn btn-secondary btn-sm"
              disabled={savingReject}
            >
              Atšaukti
            </button>
            <button
              type="button"
              onClick={handleConfirmDeny}
              className="btn btn-primary btn-sm"
              disabled={savingReject}
            >
              {savingReject ? "Atmetama…" : "Patvirtinti atmetimą"}
            </button>
          </div>
        </div>
      </div>
    );
  };

    const renderReturnModal = () => {
    const act = returningActivity;
    if (!act) return null;

    return (
      <div className="employee-modal-backdrop" onClick={closeReturnModal}>
        <div
          className="employee-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="employee-modal-title">Grąžinti veiklą tikslinimui</h3>
          <div className="employee-modal-meta">
            Darbuotojas: <strong>{act.full_name}</strong>
            <br />
            Veikla: <strong>{act.title}</strong>
          </div>

          <div className="employee-modal-field">
            <div className="employee-modal-label">Tikslinimo komentaras</div>
            <textarea
              className="field-textarea"
              value={returnComment}
              onChange={(e) => setReturnComment(e.target.value)}
              placeholder="Paaiškinkite, ką reikia patikslinti"
            />
          </div>

          <div className="employee-modal-footer">
            <button
              type="button"
              onClick={closeReturnModal}
              className="btn btn-secondary btn-sm"
              disabled={savingReturn}
            >
              Atšaukti
            </button>
            <button
              type="button"
              onClick={handleConfirmReturn}
              className="btn btn-primary btn-sm"
              disabled={savingReturn}
            >
              {savingReturn ? "Grąžinama…" : "Patvirtinti grąžinimą"}
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
          <h1 className="page-title">Darbuotojų veiklų peržiūra</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card my-activities-card">
          {loading ? (
            <div className="employee-muted">Kraunama…</div>
          ) : items.length === 0 ? (
            <div className="employee-empty">
              (Šiuo metu nėra pateiktų veiklų.)
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
                            onClick={() => handleApprove(act)}
                            className="btn btn-primary btn-sm"
                            disabled={actingId === act.id}
                          >
                            {actingId === act.id ? "..." : "Patvirtinti"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeny(act)}
                            className="btn btn-ghost btn-sm btn-danger"
                            disabled={actingId === act.id}
                          >
                            {actingId === act.id ? "..." : "Atmesti"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleReturn(act)}
                            className="btn btn-secondary btn-sm btn-danger"
                            disabled={actingId === act.id}
                          >
                            {actingId === act.id ? "..." : "Grąžinti"}
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditModal(act)}
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
          )}

          {msg && <div className="form-status">{msg}</div>}
        </section>
      </main>

      {renderModal()}
      {renderRejectModal()}
      {renderReturnModal()}
    </div>
  );
}
