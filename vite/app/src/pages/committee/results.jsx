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

export default function ResultsPage() {

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const [selectedActivity, setSelectedActivity] = useState(null);
  const [editingScore, setEditingScore] = useState(false);
  const [editScore, setEditScore] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [editCommitteeComments, setEditCommitteeComments] = useState("");
  const [peopleNum, setPeopleNum] = useState("");

  const [themes, setThemes] = useState([]);
  const [editThemeId, setEditThemeId] = useState("");
  const [editSubthemeId, setEditSubthemeId] = useState("");

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

  const openModal = (act) => {
    setSelectedActivity(act);
    setEditingScore(false);
    setEditScore( act.score !== null && act.score !== undefined ? String(act.score) : "");
    setEditCommitteeComments(act.committee_comments || "");
    setPeopleNum("");
    setMsg("");
    setEditThemeId(String(act.theme_id));
    setEditSubthemeId(String(act.subtheme_id));
  };

  const closeModal = () => {
    setSelectedActivity(null);
    setEditingScore(false);
    setSavingScore(false);
  };

  // reevaluate
  const handleReevaluateClick = async () => {
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
      const activeRole = getActiveRole();

      const res = await fetch(
        `/api/activities/${selectedActivity.id}/committee`,
        {
          method: "PATCH",
          headers: {
            "X-Active-Role": activeRole,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "score",
            score: num,
            committee_comments: editCommitteeComments,
            theme_id: editThemeId ? parseInt(editThemeId, 10) : null,
            subtheme_id: editSubthemeId ? parseInt(editSubthemeId, 10) : null,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      // update list 
      setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      setSelectedActivity(data);
      setEditThemeId(String(data.theme_id ?? ""));
      setEditSubthemeId(String(data.subtheme_id ?? ""));
      setEditScore(
        data.score !== null && data.score !== undefined
          ? String(data.score)
          : ""
      );
      setEditCommitteeComments(data.committee_comments || "");
      setEditingScore(false);
      setMsg("Įvertinimas atnaujintas.");
    } catch (e) {
      setMsg(`Klaida: ${e.message}`);
    } finally {
      setSavingScore(false);
    }
  };

  const renderModal = () => {
    const act = selectedActivity;
    if (!act) return null;

    const currentTheme = themes.find((t) => String(t.id) === String(editThemeId));
    const modalSubthemes = [...(currentTheme?.subthemes || [])].sort((a, b) =>
      compareCodes(a.code, b.code)
    );

    return (
      <div className="employee-modal-backdrop" onClick={closeModal}>
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
            {/* theme */}
            <div className="employee-modal-field">
              <div className="employee-modal-label">Tema</div>
              {!editingScore ? (
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
              {!editingScore ? (
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
              <div className="employee-modal-label">
                Veiklos pavadinimas
              </div>
              <div className="employee-modal-value">{act.title}</div>
            </div>

            {/* desc */}
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

            {/* state */}
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

            {/* manager comms */}
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

            {/* committee comms*/}
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

            {/* peopleNum */}
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

            {/* score */}
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
            {loading ? (
              <div className="employee-muted">Kraunama…</div>
            ) : items.length === 0 ? (
              <div className="employee-empty">
                (Šiuo metu nėra įvertintų veiklų.)
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
                              onClick={() => openModal(act)}
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
