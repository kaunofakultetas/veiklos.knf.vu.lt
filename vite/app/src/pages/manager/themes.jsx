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


export default function ThemesPage() {

  const [themes, setThemes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [tCode, setTCode] = useState("");
  const [tTitle, setTTitle] = useState("");

  const [subParent, setSubParent] = useState("");
  const [sCode, setSCode] = useState("");
  const [sTitle, setSTitle] = useState("");
  const [sDesc, setSDesc] = useState("");

  const apiFetch = async (url, init = {}) => {
    const activeRole = getActiveRole();

    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        "X-Active-Role": activeRole,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }

    if (!res.ok) {
      throw new Error(data?.error || `${res.status} ${res.statusText}`);
    }
    return data;
  };

  const load = async () => {
    setLoading(true);
    setMsg("");
    try {
      const data = await apiFetch("/api/themes");
      setThemes(data);

      if (!subParent && data[0]) {
        setSubParent(String(data[0].id));
      }

      const def = Object.fromEntries(data.map((t) => [t.id, false]));
      setExpanded(def);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleTheme = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const expandAll = () =>
    setExpanded(Object.fromEntries(themes.map((t) => [t.id, true])));

  const collapseAll = () =>
    setExpanded(Object.fromEntries(themes.map((t) => [t.id, false])));

  const createTheme = async () => {
    setMsg("");
    if (!tCode || !tTitle) {
      setMsg("Įveskite kodą ir pavadinimą.");
      return;
    }
    try {
      await apiFetch("/api/themes", {
        method: "POST",
        body: JSON.stringify({ code: tCode, title: tTitle }),
      });
      setTCode("");
      setTTitle("");
      await load();
      setMsg("Tema sukurta.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  const createSubtheme = async () => {
    setMsg("");
    if (!subParent || !sCode || !sTitle) {
      setMsg("Užpildykite visus laukus.");
      return;
    }
    try {
      await apiFetch(`/api/themes/${subParent}/subthemes`, {
        method: "POST",
        body: JSON.stringify({
          code: sCode,
          title: sTitle,
          description: sDesc || null,
        }),
      });
      setSCode("");
      setSTitle("");
      setSDesc("");
      await load();
      setMsg("Potemė sukurta.");
      setExpanded((prev) => ({
        ...prev,
        [Number(subParent)]: true,
      }));
    } catch (e) {
      setMsg(e.message);
    }
  };

  const deleteTheme = async (id) => {
    setMsg("");
    if (!window.confirm("Ar tikrai pašalinti šią temą ir visas potemes?"))
      return;
    try {
      await apiFetch(`/api/themes/${id}`, { method: "DELETE" });
      await load();
      setMsg("Tema pašalinta.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  const deleteSubtheme = async (id) => {
    setMsg("");
    if (!window.confirm("Ar tikrai pašalinti šią potemę?")) return;
    try {
      await apiFetch(`/api/themes/subthemes/${id}`, { method: "DELETE" });
      await load();
      setMsg("Potemė pašalinta.");
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="themes-layout">
      {/* LEFT SIDE */}
      <section className="card employee-card themes-form-card">
        <div className="card-body">
          <h2 className="section-title">Nauja tema</h2>

          <div className="themes-form-grid">
            {/* theme */}
            <div className="field">
              <label className="field-label">
                Temos numeris <span className="required-mark">*</span>
              </label>
              <input
                className="field-input"
                value={tCode}
                onChange={(e) => setTCode(e.target.value)}
                placeholder="pvz. 6.1."
              />
            </div>

            <div className="field">
              <label className="field-label">
                Temos pavadinimas <span className="required-mark">*</span>
              </label>
              <input
                className="field-input"
                value={tTitle}
                onChange={(e) => setTTitle(e.target.value)}
                placeholder="Pavadinimas"
              />
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={createTheme}
                disabled={!tCode || !tTitle}
              >
                Sukurti temą
              </button>
            </div>

            <hr />

            {/* subtheme */}
            <h2 className="section-title">Nauja potemė</h2>

            <div className="field">
              <label className="field-label">
                Priklauso temai <span className="required-mark">*</span>
              </label>
              <AppSelect
                value={subParent}
                onChange={(val) => setSubParent(val)}
                options={themes}
                getLabel={(t) => `${t.code} — ${t.title}`}
                placeholder="Pasirinkite temą"
              />
            </div>

            <div className="field">
              <label className="field-label">
                Potemės numeris <span className="required-mark">*</span>
              </label>
              <input
                className="field-input"
                value={sCode}
                onChange={(e) => setSCode(e.target.value)}
                placeholder="pvz. 6.1.1."
              />
            </div>

            <div className="field">
              <label className="field-label">
                Potemės pavadinimas <span className="required-mark">*</span>
              </label>
              <input
                className="field-input"
                value={sTitle}
                onChange={(e) => setSTitle(e.target.value)}
                placeholder="Pavadinimas"
              />
            </div>

            <div className="field">
              <label className="field-label">
                Potemės aprašymas <span className="required-mark">*</span>
              </label>
              <textarea
                className="field-textarea"
                value={sDesc}
                onChange={(e) => setSDesc(e.target.value)}
                placeholder="Aprašymas"
              />
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={createSubtheme}
                disabled={!subParent || !sCode || !sTitle}
              >
                Sukurti potemę
              </button>
            </div>
          </div>

          {msg && (
            <div className="form-status" style={{ marginTop: "12px" }}>
              {msg}
            </div>
          )}
        </div>
      </section>

      {/* RIGHT SIDE */}
      <section className="card">
        <div className="card-body">
          <div className="theme-panel-header">
            <h2 className="section-title">Temos ir potemės</h2>
            <div className="theme-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={expandAll}
              >
                Išskleisti viską
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={collapseAll}
              >
                Suskleisti viską
              </button>
            </div>
          </div>

          {loading ? (
            <div className="employee-muted">Kraunama…</div>
          ) : themes.length === 0 ? (
            <div className="employee-empty">(temų nėra)</div>
          ) : (
            <div className="theme-list">
              {themes.map((t) => {
                const isOpen = !!expanded[t.id];
                const sortedSubthemes = [...(t.subthemes || [])].sort((a, b) =>
                compareCodes(a.code, b.code)
                );
                return (
                  <div key={t.id} className="theme-item">
                    <div className="theme-row">
                      <button
                        type="button"
                        className="theme-toggle"
                        aria-expanded={isOpen}
                        onClick={() => toggleTheme(t.id)}
                        title={isOpen ? "Suskleisti" : "Išskleisti"}
                      >
                        <span className="theme-toggle-icon">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        <span className="theme-code-pill">{t.code}</span>
                        <span className="theme-title">{t.title}</span>
                        <span className="theme-count">
                          ({t.subthemes?.length || 0})
                        </span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => deleteTheme(t.id)}
                      >
                        Pašalinti temą
                      </button>
                    </div>

                    {isOpen && (
                      <div className="theme-subthemes">
                        {sortedSubthemes.length ? (
                          sortedSubthemes.map((s) => (
                            <div
                              key={s.id}
                              className="theme-subtheme-row"
                            >
                              <div className="theme-subtheme-meta">
                                <span className="theme-code-pill">
                                  {s.code}
                                </span>
                                <span className="theme-subtheme-title">
                                  {s.title}
                                </span>
                                {s.description && (
                                  <span className="theme-subtheme-description">
                                    — {s.description}
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-danger"
                                onClick={() => deleteSubtheme(s.id)}
                              >
                                Pašalinti
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="employee-modal-muted">
                            (potemių nėra)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
