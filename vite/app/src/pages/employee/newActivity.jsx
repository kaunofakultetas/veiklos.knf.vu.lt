import { useEffect, useState, useRef } from "react";
import { AppSelect } from "../../components/appCommon.jsx";
import "../../components/employee.css";

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

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}

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

  // force-remount file input
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef(null);

  // load themes + subthemes
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

    try {
      setSubmitting(true);
      const activeRole = getActiveRole();

      const formData = new FormData();
      formData.append("theme_id", selectedThemeId);
      formData.append("subtheme_id", selectedSubthemeId);
      formData.append("title", activityName);
      formData.append("description", activityDescription || "");
      // for file prefix
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

      // reset form
      setActivityName("");
      setActivityDescription("");
      setFile(null);

      // force file input
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
              {/* theme */}
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

              {/* subtheme */}
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

              {/* desc */}
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

              {/* title */}
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

              {/* desc */}
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

              {/* attach */}
              <div className="field">
                <label className="field-label">
                  Pridėkite failą (jei reikia)
                </label>
                <input
                  key={fileInputKey}
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => setFile(e.target.files[0] || null)}
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
