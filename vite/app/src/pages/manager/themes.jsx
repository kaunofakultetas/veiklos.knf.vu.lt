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
//    codeToNums      — "1.2.3" → [1,2,3]
//    compareCodes    — numeric-aware code ordering
//    sortedSubthemes — a theme's subthemes, code-ordered
//    NewThemeForm    — left: code + title
//    NewSubthemeForm — left: parent theme + code/title/desc
//    SubthemeRow     — right: one subtheme line + delete
//    ThemeItem       — right: one collapsible theme
//    ThemeTree       — right: the list (loading/empty/items)
//    ThemesPage      — state, load, mutations (default)
// -----------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { AppSelect } from "@/components/appCommon.jsx";
import { apiJson, apiSend } from "@/components/api.js";
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
// a theme without subthemes gives [].
//
// Used by:
//   - ThemeItem (below)
// -----------------------------------------------------------

function sortedSubthemes(theme) {
  return [...(theme.subthemes || [])].sort((a, b) =>
    compareCodes(a.code, b.code)
  );
}







// -----------------------------------------------------------
// NewThemeForm
// -----------------------------------------------------------
//
// "Nauja tema": code + title, both required (the button is
// disabled until both are filled, and while the create is in
// flight, so a double-click cannot create the theme twice).
// Owns its two fields and hands { code, title } plus a reset
// callback to onSubmit, which clears the fields once the
// theme is saved; the button waits for onSubmit's promise.
//
// Used by:
//   - ThemesPage (below) — left panel
// -----------------------------------------------------------

function NewThemeForm({ onSubmit }) {

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);


  const reset = () => {
    setCode("");
    setTitle("");
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({ code, title }, reset);
    } finally {
      setSaving(false);
    }
  };


  return (
    <>
      <h2 className="section-title">Nauja tema</h2>

      <div className="field">
        <label className="field-label" htmlFor="theme-code">
          Temos numeris <span className="required-mark">*</span>
        </label>
        <input
          id="theme-code"
          className="field-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="pvz. 6.1."
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="theme-title">
          Temos pavadinimas <span className="required-mark">*</span>
        </label>
        <input
          id="theme-title"
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pavadinimas"
        />
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={saving || !code || !title}
        >
          Sukurti temą
        </button>
      </div>
    </>
  );
}







// -----------------------------------------------------------
// NewSubthemeForm
// -----------------------------------------------------------
//
// "Nauja potemė": parent theme (an AppSelect over the loaded
// themes, named by its caption, its value owned by the page
// since load() seeds it), code, title and description. Code
// and title are required; the description is marked required
// in the UI but checked as required by neither this form nor
// the backend. Hands { code, title, description } plus a
// reset callback (the three own fields, not the parent) to
// onSubmit, and keeps the button disabled until onSubmit's
// promise settles, so a double-click cannot create the
// subtheme twice.
//
// Used by:
//   - ThemesPage (below) — left panel
// -----------------------------------------------------------

function NewSubthemeForm({ themes, parentId, onParentChange, onSubmit }) {

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);


  const reset = () => {
    setCode("");
    setTitle("");
    setDescription("");
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({ code, title, description }, reset);
    } finally {
      setSaving(false);
    }
  };


  return (
    <>
      <h2 className="section-title">Nauja potemė</h2>

      <div className="field">
        <label className="field-label" id="subtheme-parent-label">
          Priklauso temai <span className="required-mark">*</span>
        </label>
        <AppSelect
          labelledBy="subtheme-parent-label"
          value={parentId}
          onChange={(val) => onParentChange(val)}
          options={themes}
          getLabel={(t) => `${t.code} — ${t.title}`}
          placeholder="Pasirinkite temą"
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="subtheme-code">
          Potemės numeris <span className="required-mark">*</span>
        </label>
        <input
          id="subtheme-code"
          className="field-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="pvz. 6.1.1."
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="subtheme-title">
          Potemės pavadinimas <span className="required-mark">*</span>
        </label>
        <input
          id="subtheme-title"
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pavadinimas"
        />
      </div>

      {/* Marked required in the UI, but only checked as
          required by neither this form nor the backend */}
      <div className="field">
        <label className="field-label" htmlFor="subtheme-description">
          Potemės aprašymas <span className="required-mark">*</span>
        </label>
        <textarea
          id="subtheme-description"
          className="field-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Aprašymas"
        />
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={saving || !parentId || !code || !title}
        >
          Sukurti potemę
        </button>
      </div>
    </>
  );
}







// -----------------------------------------------------------
// SubthemeRow
// -----------------------------------------------------------
//
// One subtheme line under an expanded theme: code pill, title,
// the description when there is one, and its delete button.
//
// Used by:
//   - ThemeItem (below)
// -----------------------------------------------------------

function SubthemeRow({ subtheme, onDelete }) {
  return (
    <div className="theme-subtheme-row">
      <div className="theme-subtheme-meta">
        <span className="theme-code-pill">
          {subtheme.code}
        </span>
        <span className="theme-subtheme-title">
          {subtheme.title}
        </span>
        {subtheme.description && (
          <span className="theme-subtheme-description">
            — {subtheme.description}
          </span>
        )}
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-sm btn-danger"
        onClick={() => onDelete(subtheme.id)}
      >
        Pašalinti
      </button>
    </div>
  );
}







// -----------------------------------------------------------
// ThemeItem
// -----------------------------------------------------------
//
// One collapsible theme: the toggle row (chevron, code pill,
// title, subtheme count) with its delete button, and — while
// open — the code-ordered subthemes or "(potemių nėra)".
//
// Used by:
//   - ThemeTree (below)
// -----------------------------------------------------------

function ThemeItem({ theme, isOpen, onToggle, onDelete, onDeleteSubtheme }) {

  const subthemes = sortedSubthemes(theme);


  return (
    <div className="theme-item">
      <div className="theme-row">
        <button
          type="button"
          className="theme-toggle"
          aria-expanded={isOpen}
          onClick={() => onToggle(theme.id)}
          title={isOpen ? "Suskleisti" : "Išskleisti"}
        >
          <span className="theme-toggle-icon">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="theme-code-pill">{theme.code}</span>
          <span className="theme-title">{theme.title}</span>
          <span className="theme-count">
            ({theme.subthemes?.length || 0})
          </span>
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          onClick={() => onDelete(theme.id)}
        >
          Pašalinti temą
        </button>
      </div>

      {isOpen && (
        <div className="theme-subthemes">
          {subthemes.length ? (
            subthemes.map((s) => (
              <SubthemeRow
                key={s.id}
                subtheme={s}
                onDelete={onDeleteSubtheme}
              />
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
}







// -----------------------------------------------------------
// ThemeTree
// -----------------------------------------------------------
//
// The right panel's list of ThemeItems, each open or closed
// per the `expanded` map. Loading and empty states are early
// returns.
//
// Used by:
//   - ThemesPage (below)
// -----------------------------------------------------------

function ThemeTree({ themes, loading, expanded, onToggle, onDeleteTheme, onDeleteSubtheme }) {
  if (loading) {
    return <div className="employee-muted">Kraunama…</div>;
  }

  if (themes.length === 0) {
    return <div className="employee-empty">(temų nėra)</div>;
  }

  return (
    <div className="theme-list">
      {themes.map((t) => (
        <ThemeItem
          key={t.id}
          theme={t}
          isOpen={!!expanded[t.id]}
          onToggle={onToggle}
          onDelete={onDeleteTheme}
          onDeleteSubtheme={onDeleteSubtheme}
        />
      ))}
    </div>
  );
}







// -----------------------------------------------------------
// ThemesPage (default export)
// -----------------------------------------------------------
//
// Owns the tree, the expanded map, the subtheme form's parent
// theme and one status line shared by both forms, which shows
// the backend's text for a refused request; every successful
// mutation reloads the whole tree. Each load keeps the parent
// only while it still names a theme in the tree and otherwise
// seeds the first theme, or nothing when no theme is left, so
// the form never posts under a deleted theme.
//
// Used by:
//   - App.jsx — route /manager/themes
// -----------------------------------------------------------

export default function ThemesPage() {

  const [themes, setThemes] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [subParent, setSubParent] = useState("");


  // (Re)load the tree; every mutation calls this again.
  // Reloading collapses all themes — expanded is rebuilt as
  // all-false. Stable across renders (useCallback, no deps)
  // so the mount effect can list it without re-running: it
  // reads no state — the parent seed goes through the updater
  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const data = await apiJson("/api/themes");

      // A 200 whose body is not the tree array would throw on
      // render (themes.map) and blank the page — refuse it
      if (!Array.isArray(data)) throw new Error("Klaida: netikėtas serverio atsakymas.");

      setThemes(data);

      // The subtheme form's parent stays while it names a
      // theme still in the tree — a pick survives a reload, a
      // deleted theme does not — and otherwise falls to the
      // first theme, or to nothing when the tree is empty
      setSubParent((prev) => {
        if (data.some((t) => String(t.id) === prev)) return prev;
        return data[0] ? String(data[0].id) : "";
      });

      const def = Object.fromEntries(data.map((t) => [t.id, false]));
      setExpanded(def);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);


  const toggleTheme = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const expandAll = () =>
    setExpanded(Object.fromEntries(themes.map((t) => [t.id, true])));

  const collapseAll = () =>
    setExpanded(Object.fromEntries(themes.map((t) => [t.id, false])));


  // The forms hand over their values and a reset callback;
  // the fields clear only once the POST succeeded. Required
  // fields are enforced by the forms' disabled buttons
  const createTheme = async ({ code, title }, reset) => {
    setMsg("");
    try {
      await apiSend("/api/themes", {
        method: "POST",
        json: { code, title },
      });
      reset();
      await load();
      setMsg("Tema sukurta.");
    } catch (e) {
      setMsg(e.message);
    }
  };


  const createSubtheme = async ({ code, title, description }, reset) => {
    setMsg("");
    try {
      await apiSend(`/api/themes/${subParent}/subthemes`, {
        method: "POST",
        json: {
          code,
          title,
          description: description || null,
        },
      });
      reset();
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
      await apiSend(`/api/themes/${id}`, { method: "DELETE" });
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
      await apiSend(`/api/themes/subthemes/${id}`, { method: "DELETE" });
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
          <div className="themes-form-grid">
            <NewThemeForm onSubmit={createTheme} />

            <hr />

            <NewSubthemeForm
              themes={themes}
              parentId={subParent}
              onParentChange={setSubParent}
              onSubmit={createSubtheme}
            />
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

          <ThemeTree
            themes={themes}
            loading={loading}
            expanded={expanded}
            onToggle={toggleTheme}
            onDeleteTheme={deleteTheme}
            onDeleteSubtheme={deleteSubtheme}
          />
        </div>
      </section>
    </div>
  );
}
