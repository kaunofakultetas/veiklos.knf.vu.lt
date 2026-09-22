// -----------------------------------------------------------
//  [*] Employee — new activity form
//
//  /employee/new: pick theme + subtheme, name and describe
//  the activity, optionally attach a file, POST it as
//  multipart to /api/activities. A successful submit resets
//  the form in place (theme/subtheme selection survives).
//
//  The FormData field order matters: theme_code and
//  subtheme_code are appended BEFORE the attachment so
//  multer's filename callback on the backend already has them
//  when the file arrives — they become the stored filename's
//  prefix.
//
//  Split into (root component last):
//
//    codeToNums       — "1.2.3" → [1,2,3]
//    compareCodes     — numeric-aware code ordering
//    getActiveRole    — activeRole from localStorage
//    NewActivityPage  — the form (default export)
// -----------------------------------------------------------

import { useEffect, useState, useRef } from "react";
import { AppSelect, ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TOO_BIG } from "@/components/appCommon.jsx";
import "@/components/employee.css";







// -----------------------------------------------------------
// codeToNums
// -----------------------------------------------------------
//
// Pulls the number runs out of a theme/subtheme code, so
// "1.10" can be compared numerically instead of as text.
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
// Sort comparator for codes: number-run by number-run, so
// "1.9" < "1.10" (plain string sort would invert them);
// missing runs sort first, full ties fall back to
// localeCompare.
//
// Used by:
//   - NewActivityPage (below) — subtheme dropdown ordering
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
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header — read fresh
// per request rather than kept in state, so a role switch in
// the header is picked up immediately.
//
// Used by:
//   - NewActivityPage (below) — both API calls
// -----------------------------------------------------------

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}







// -----------------------------------------------------------
// NewActivityPage (default export)
// -----------------------------------------------------------
//
// Loads the theme tree once on mount and preselects the first
// theme + its first subtheme. Title and description are
// required in the UI (the backend only requires the title).
//
// Used by:
//   - App.jsx — route /employee/new
// -----------------------------------------------------------

export default function NewActivityPage() {

  const [themes, setThemes] = useState([]);
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [selectedSubthemeId, setSelectedSubthemeId] = useState("");

  const [activityName, setActivityName] = useState("");
  const [activityDescription, setActivityDescription] = useState("");
  const [file, setFile] = useState(null);

  const [loadingThemes, setLoadingThemes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  // Clearing a file input needs both a value reset and a
  // remount (the key) to work across browsers
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef(null);


  // Load the theme tree once; preselect the first theme and
  // its first subtheme so the form starts valid
  useEffect(() => {
    const loadThemes = async () => {
      setLoadingThemes(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();
        const res = await fetch("/api/themes", {
          headers: {
            "X-Active-Role": activeRole,
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `${res.status} ${res.statusText}`);
        }
        setThemes(data);
        if (data.length > 0) {
          setSelectedThemeId(String(data[0].id));
          const firstSub = data[0].subthemes?.[0];
          if (firstSub) setSelectedSubthemeId(String(firstSub.id));
        }
      } catch (e) {
        setMsg(e.message);
      } finally {
        setLoadingThemes(false);
      }
    };
    loadThemes();
  }, []);


  const currentTheme = themes.find((t) => String(t.id) === selectedThemeId);
  const subthemes = [...(currentTheme?.subthemes || [])].sort((a, b) =>
    compareCodes(a.code, b.code)
  );
  const currentSubtheme = subthemes.find((s) => String(s.id) === selectedSubthemeId);


  // Multipart submit — see the header on why the codes are
  // appended before the file
  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg("");

    if (
      !selectedThemeId ||
      !selectedSubthemeId ||
      !activityName.trim() ||
      !activityDescription.trim()
    ) {
      setMsg("Klaida: Užpildykite visus privalomus laukus.");
      return;
    }
    if (file && file.size > ATTACHMENT_MAX_BYTES) {
      setMsg(ATTACHMENT_TOO_BIG);
      return;
    }

    try {
      setSubmitting(true);
      const activeRole = getActiveRole();

      const formData = new FormData();
      formData.append("theme_id", selectedThemeId);
      formData.append("subtheme_id", selectedSubthemeId);
      formData.append("title", activityName);
      formData.append("description", activityDescription || "");
      formData.append("theme_code", currentTheme?.code || "");
      formData.append("subtheme_code", currentSubtheme?.code || "");
      if (file) {
        formData.append("attachment", file);
      }

      const res = await fetch("/api/activities", {
        method: "POST",
        headers: {
          "X-Active-Role": activeRole,
        },
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      // Reset the text fields and file, keep the selection —
      // registering several activities in a row usually stays
      // within one theme
      setActivityName("");
      setActivityDescription("");
      setFile(null);

      setFileInputKey((k) => k + 1);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      setMsg("Veikla sėkmingai pateikta.");
    } catch (e) {
      setMsg(`Nepavyko pateikti: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Nauja veikla</h1>
          <p className="page-subtitle">
            Užpildykite formą, kad pateikti naują veiklą vertinimui.
          </p>
        </div>
      </header>

      <main className="page-content">
        <section className="card employee-card">
          <div className="card-body">
            <form onSubmit={onSubmit} className="employee-form">

              {/* Theme picker — changing it re-sorts and
                  preselects the new theme's first subtheme */}
              <div className="field">
                <label className="field-label">
                  Pasirinkite temą <span className="required-mark">*</span>
                </label>
                {loadingThemes ? (
                  <div className="employee-muted">Kraunamos temos…</div>
                ) : (
                  <AppSelect
                    value={selectedThemeId}
                    onChange={(val) => {
                      setSelectedThemeId(val);
                      const t = themes.find(
                        (theme) => String(theme.id) === String(val)
                      );
                      const sorted = [...(t?.subthemes || [])].sort((a, b) =>
                        compareCodes(a.code, b.code)
                      );
                      const firstSub = sorted[0];
                      setSelectedSubthemeId(firstSub ? String(firstSub.id) : "");
                    }}
                    options={themes}
                    getLabel={(t) => `${t.code} — ${t.title}`}
                    placeholder="Pasirinkite temą"
                    disabled={loadingThemes || themes.length === 0}
                  />
                )}
              </div>

              {/* Subtheme picker */}
              <div className="field">
                <label className="field-label">
                  Pasirinkite potemę <span className="required-mark">*</span>
                </label>
                <AppSelect
                  value={selectedSubthemeId}
                  onChange={(val) => setSelectedSubthemeId(val)}
                  options={subthemes}
                  getLabel={(s) => `${s.code} — ${s.title}`}
                  placeholder={
                    subthemes.length ? "Pasirinkite potemę" : "(potemių nėra)"
                  }
                  disabled={!subthemes.length}
                />
              </div>

              {/* The chosen subtheme's description, read-only */}
              <div className="field">
                <label className="field-label">
                  Pasirinktos potemės aprašymas
                </label>
                <div className="info-box">
                  {currentSubtheme?.description ? (
                    currentSubtheme.description
                  ) : (
                    <span className="info-box-muted">
                      (aprašymas nenurodytas)
                    </span>
                  )}
                </div>
              </div>

              {/* Activity title */}
              <div className="field">
                <label className="field-label">
                  Registuojamos veiklos pavadinimas{" "}
                  <span className="required-mark">*</span>
                </label>
                <input
                  className="field-input"
                  type="text"
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                  placeholder="Įveskite veiklos pavadinimą"
                />
              </div>

              {/* Activity description */}
              <div className="field">
                <label className="field-label">
                  Registuojamos veiklos aprašymas{" "}
                  <span className="required-mark">*</span>
                </label>
                <textarea
                  className="field-textarea"
                  value={activityDescription}
                  onChange={(e) => setActivityDescription(e.target.value)}
                  placeholder="Aprašykite veiklą"
                />
              </div>

              {/* Optional attachment */}
              <div className="field">
                <label className="field-label">
                  Pridėkite failą (jei reikia)
                </label>
                <input
                  key={fileInputKey}
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  ref={fileInputRef}
                  onChange={(e) => {
                    const picked = e.target.files[0] || null;
                    // Refuse an oversized pick on the spot —
                    // the input is cleared so nothing is sent
                    if (picked && picked.size > ATTACHMENT_MAX_BYTES) {
                      setMsg(ATTACHMENT_TOO_BIG);
                      setFile(null);
                      setFileInputKey((k) => k + 1);
                      return;
                    }
                    setMsg("");
                    setFile(picked);
                  }}
                  className="field-input-file"
                />
                {file && (
                  <div className="employee-file-hint">
                    Pasirinktas failas: {file.name}
                  </div>
                )}
              </div>

              {msg && <div className="form-status">{msg}</div>}

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || loadingThemes}
                >
                  {submitting ? "Pateikiama…" : "Pateikti veiklą"}
                </button>
              </div>

            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
