// -----------------------------------------------------------
//  [*] Manager — theme & subtheme administration
//
//  /manager/themes, two panels: creation forms on the left
//  (new theme; new subtheme under a chosen theme), the
//  collapsible theme tree with delete buttons on the right.
//
//  Creation and deletion only — there is no editing here,
//  even though the backend has PATCH routes for it. Every
//  successful change reloads the whole tree; creating a
//  subtheme also expands its parent so the new row is
//  visible.
//
//  Split into (root component last):
//
//    getActiveRole  — activeRole from localStorage
//    codeToNums     — "1.2.3" → [1,2,3]
//    compareCodes   — numeric-aware code ordering
//    ThemesPage     — both panels (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import { AppSelect } from "../../components/appCommon.jsx";
import "../../components/employee.css";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request.
//
// Used by:
//   - ThemesPage (below) — apiFetch
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
//   - ThemesPage (below) — subtheme ordering in the tree
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
// ThemesPage (default export)
// -----------------------------------------------------------
//
// All API calls go through the local apiFetch, which stamps
// the auth headers on every request and throws the backend's
// error message for the shared status line.
//
// Used by:
//   - App.jsx — route /manager/themes
// -----------------------------------------------------------

export default function ThemesPage() {

  const [themes, setThemes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // New-theme form
  const [tCode, setTCode] = useState("");
  const [tTitle, setTTitle] = useState("");

  // New-subtheme form
  const [subParent, setSubParent] = useState("");
  const [sCode, setSCode] = useState("");
  const [sTitle, setSTitle] = useState("");
  const [sDesc, setSDesc] = useState("");


  // fetch wrapper: auth headers always, Content-Type only
  // when there is a body, backend error text as the thrown
  // message
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
      // ignore — 204s have no body
    }

    if (!res.ok) {
      throw new Error(data?.error || `${res.status} ${res.statusText}`);
    }
    return data;
  };


  // (Re)load the tree; every mutation calls this again.
  // Reloading collapses all themes — expanded is rebuilt as
  // all-false
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
      // load() collapsed everything — reopen the parent so
      // the new subtheme is visible
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

      {/* Left panel — the two creation forms sharing one
          status line */}
      <section className="card employee-card themes-form-card">
        <div className="card-body">
          <h2 className="section-title">Nauja tema</h2>

          <div className="themes-form-grid">
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

            {/* Marked required in the UI, but only checked as
                required by neither this form nor the backend */}
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

      {/* Right panel — the collapsible tree */}
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
