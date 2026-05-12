import { useEffect, useState } from "react";
import "../../components/employee.css";

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}

export default function CalculatePage() {

  const [themeTotals, setThemeTotals] = useState([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState("");

  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployeeOid, setSelectedEmployeeOid] = useState("");
  const [employeeSubthemes, setEmployeeSubthemes] = useState([]);
  const [subthemesLoading, setSubthemesLoading] = useState(false);

  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState("");

  const [msg, setMsg] = useState("");
  const [savingPoint, setSavingPoint] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);

  useEffect(() => {
    const load = async () => {
      setThemesLoading(true);
      setEmployeesLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [themesRes, employeesRes] = await Promise.all([
          fetch("/api/activities/evaluated/theme-totals", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
          fetch("/api/activities/evaluated/employees", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
        ]);

        const themesData = await themesRes.json().catch(() => ({}));
        if (!themesRes.ok) {
          throw new Error(
            themesData?.error || `${themesRes.status} ${themesRes.statusText}`
          );
        }

        const employeesData = await employeesRes.json().catch(() => ({}));
        if (!employeesRes.ok) {
          throw new Error(
            employeesData?.error || `${employeesRes.status} ${employeesRes.statusText}`
          );
        }

        setThemeTotals(themesData);
        setEmployees(employeesData);
      } catch (e) {
        console.error("Skaičiuoklė load error:", e);
        setMsg(e.message || "Klaida: Nepavyko užkrauti duomenų skaičiuoklei.");
      } finally {
        setThemesLoading(false);
        setEmployeesLoading(false);
      }
    };

    load();
  }, []);

  // reset calculator on theme change
  useEffect(() => {
    setHasCalculated(false);
  }, [selectedThemeId]);

  // load subtheme totals
  useEffect(() => {
    const loadSubthemes = async () => {
      if (!selectedEmployeeOid) {
        setEmployeeSubthemes([]);
        return;
      }

      setSubthemesLoading(true);
      setMsg("");

      try {
        const activeRole = getActiveRole();

        const res = await fetch(
          `/api/activities/evaluated/employee/${selectedEmployeeOid}/subthemes`,
          {
            headers: {
              "X-Active-Role": activeRole,
            },
          }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `${res.status} ${res.statusText}`);
        }

        setEmployeeSubthemes(data);
      } catch (e) {
        console.error("load employee subthemes error:", e);
        setMsg(e.message || "Klaida: Nepavyko užkrauti darbuotojo veiklų skaičiuoklei.");
      } finally {
        setSubthemesLoading(false);
      }
    };

    loadSubthemes();
  }, [selectedEmployeeOid]);

  const selectedTheme = themeTotals.find(
    (t) => String(t.theme_id) === String(selectedThemeId)
  );

  const selectedThemeScoreSum = selectedTheme
    ? Number(selectedTheme.total_score) || 0
    : 0;

  const selectedThemeTotalSum = selectedTheme
    ? Number(selectedTheme.theme_total_sum) || 0
    : 0;

  // pointvalue
  const valuePerScore =
    selectedThemeScoreSum > 0 && selectedThemeTotalSum > 0
      ? selectedThemeTotalSum / selectedThemeScoreSum
      : null;

  // total sum of Rezultatas
  const totalRezultatas = employeeSubthemes.reduce((sum, row) => {
    const score = Number(row.total_score) || 0;
    const point = Number(row.theme_pointvalue) || 0;
    const cap =
      row.subtheme_cap !== null && row.subtheme_cap !== undefined
        ? Number(row.subtheme_cap)
        : null;

    const rawValue = score * point;
    const hasRaw = Number.isFinite(rawValue) && rawValue > 0;
    if (!hasRaw) return sum;

    let resultValue = rawValue;
    if (cap !== null && Number.isFinite(cap) && cap > 0) {
      resultValue = Math.min(rawValue, cap);
    }
    return sum + resultValue;
  }, 0);

  const handleSavePointValue = async () => {
    if (!selectedTheme) {
      setMsg("Pasirinkite temą.");
      return;
    }
    if (valuePerScore === null || !Number.isFinite(valuePerScore)) {
      setMsg("Klaida: Negalima apskaičiuoti 1 balo vertės.");
      return;
    }

    const rounded = Number(valuePerScore.toFixed(2));

    try {
      setSavingPoint(true);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(
        `/api/themes/${selectedTheme.theme_id}/pointvalue`,
        {
          method: "PATCH",
          headers: {
            "X-Active-Role": activeRole,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pointvalue: rounded }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      setThemeTotals((prev) =>
        prev.map((t) =>
          t.theme_id === selectedTheme.theme_id
            ? { ...t, theme_pointvalue: rounded }
            : t
        )
      );

      setHasCalculated(true);
      setMsg("1 balo vertė išsaugota.");
    } catch (e) {
      console.error("failed to save pointvalue:", e);
      setMsg(e.message || "Klaida: Nepavyko išsaugoti 1 balo vertės.");
    } finally {
      setSavingPoint(false);
    }
  };

  // employees dropdown
  const employeeOptions = employees.map((e) => ({
    id: e.oid,
    label: e.full_name || e.email || e.oid,
  }));

  const filteredEmployeeOptions = employeeOptions.filter((opt) =>
    opt.label.toLowerCase().includes(employeeSearchTerm.toLowerCase())
  );

  const selectedEmployeeLabel =
    employeeOptions.find((o) => o.id === selectedEmployeeOid)?.label ||
    "(nepasirinktas)";
    
    const themeOptions = themeTotals.map((t) => ({
      value: String(t.theme_id),
      label: `${t.theme_code} — ${t.theme_title}`,
    }));

  const layout = {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "nowrap",
  };

  const panel = {
    flex: "0 0 50%",
    minWidth: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: 16,
  };

  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  };
  const thStyle = {
    borderBottom: "1px solid #e5e7eb",
    padding: "6px 6px",
    textAlign: "left",
    fontWeight: 600,
  };
  const tdStyle = {
    borderBottom: "1px solid #e5e7eb",
    padding: "6px 6px",
    textAlign: "left",
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Skaičiuoklė</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card">
          <div className="card-body">
            <div style={layout}>
              {/* LEFT SIDE */}
              <div style={panel}>
                <h3>Temų balų suvestinė</h3>

                {themesLoading ? (
                  <div className="employee-muted">
                    Kraunama temų informacija…
                  </div>
                ) : themeTotals.length === 0 ? (
                  <div className="employee-empty">
                    Šiuo metu nėra įvertintų temų.
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Tema</th>
                          <th style={thStyle}>Pavadinimas</th>
                          <th style={thStyle}>Bendra balų suma</th>
                        </tr>
                      </thead>
                      <tbody>
                        {themeTotals.map((t) => (
                          <tr key={t.theme_id}>
                            <td style={tdStyle}>{t.theme_code}</td>
                            <td style={tdStyle}>{t.theme_title}</td>
                            <td style={tdStyle}>{t.total_score ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div
                  className="calc-theme-block"
                  style={{
                    marginTop: 20,
                    marginBottom: 8,
                    borderTop: "1px solid #e5e7eb",
                    paddingTop: 12,
                  }}
                >
                  <h3>Skaičiuoklė</h3>

                  <div style={{ marginBottom: 10 }}>
                    <label
                      className="field-label"
                      htmlFor="calc-theme-select"
                    >
                      Pasirinkite temą
                    </label>
                    <select
                      id="calc-theme-select"
                      value={selectedThemeId}
                      onChange={(e) => setSelectedThemeId(e.target.value)}
                      className="field-select calc-theme-select"
                    >
                      <option value="">(nepasirinkta)</option>
                      {themeTotals.map((t) => (
                        <option key={t.theme_id} value={t.theme_id}>
                          {t.theme_code} — {t.theme_title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div className="employee-modal-muted">
                      Temai nustatyta bendra suma:
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={selectedThemeId ? selectedThemeTotalSum : ""}
                      placeholder="-"
                      className="field-input"
                    />
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div className="employee-modal-muted">
                      Bendra temos balų suma:
                    </div>
                    <input
                      type="text"
                      readOnly
                      value={selectedThemeId ? selectedThemeScoreSum : ""}
                      placeholder="-"
                      className="field-input"
                    />
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={handleSavePointValue}
                      className="btn btn-primary"
                      disabled={
                        !selectedThemeId ||
                        valuePerScore === null ||
                        !Number.isFinite(valuePerScore) ||
                        savingPoint
                      }
                    >
                      {savingPoint ? "Saugoma…" : "Skaičiuoti"}
                    </button>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="employee-modal-muted">
                      1 balo vertė:
                    </div>
                      <div className="calc-result-box">
                        {hasCalculated && valuePerScore !== null && Number.isFinite(valuePerScore)
                          ? valuePerScore.toFixed(2)
                          : "—"}
                      </div>
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE */}
              <div style={panel}>
                <h3>Darbuotojo veiklos pagal temas ir potemes</h3>

                <div style={{ marginBottom: 12, position: "relative" }}>
                  <div className="employee-modal-muted">
                    Pasirinkite darbuotoją
                  </div>
                  {employeesLoading ? (
                    <div className="employee-muted">
                      Kraunami darbuotojai…
                    </div>
                  ) : employees.length === 0 ? (
                    <div className="employee-empty">
                      Nerasta darbuotojų.
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="field-select app-select-trigger"
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                        onClick={() =>
                          setEmployeeDropdownOpen((o) => !o)
                        }
                      >
                        <span className="app-select-label">
                          {selectedEmployeeLabel}
                        </span>
                        <span className="app-select-chevron">▾</span>
                      </button>

                      {employeeDropdownOpen && (
                        <div className="app-select-dropdown">
                          <div className="multi-select-search-wrapper">
                            <input
                              type="text"
                              placeholder="Ieškoti darbuotojo..."
                              value={employeeSearchTerm}
                              onChange={(e) =>
                                setEmployeeSearchTerm(e.target.value)
                              }
                              className="multi-select-search"
                            />
                          </div>

                          {filteredEmployeeOptions.length === 0 ? (
                            <div className="multi-select-empty">
                              (nėra atitinkančių darbuotojų)
                            </div>
                          ) : (
                            filteredEmployeeOptions.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                className="app-select-option"
                                onClick={() => {
                                  setSelectedEmployeeOid(opt.id);
                                  setEmployeeDropdownOpen(false);
                                  setEmployeeSearchTerm("");
                                }}
                              >
                                {opt.label}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {selectedEmployeeOid && (
                  <div>
                    <h4 style={{ marginTop: 12, marginBottom: 8 }}>
                      Veiklų lentelė pasirinktam darbuotojui
                    </h4>

                    {subthemesLoading ? (
                      <div className="employee-muted">
                        Kraunama…
                      </div>
                    ) : employeeSubthemes.length === 0 ? (
                      <div className="employee-empty">
                        Šis darbuotojas neturi įvertintų veiklų.
                      </div>
                    ) : (
                      <>
                        <div className="table-wrapper">
                          <table style={tableStyle}>
                            <thead>
                              <tr>
                                <th style={thStyle}>Tema</th>
                                <th style={thStyle}>Potemė</th>
                                <th style={thStyle}>Balų suma</th>
                                <th style={thStyle}>1 balo vertė</th>
                                <th style={thStyle}>Rezultatas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {employeeSubthemes.map((row, idx) => {
                                const score = Number(row.total_score) || 0;
                                const point =
                                  Number(row.theme_pointvalue) || 0;
                                const cap =
                                  row.subtheme_cap !== null &&
                                  row.subtheme_cap !== undefined
                                    ? Number(row.subtheme_cap)
                                    : null;

                                const rawValue = score * point;
                                const hasRaw =
                                  Number.isFinite(rawValue) &&
                                  rawValue > 0;

                                let resultValue = hasRaw ? rawValue : 0;
                                if (
                                  cap !== null && 
                                  Number.isFinite(cap) &&
                                  cap > 0
                                ) {
                                  resultValue = Math.min(
                                    rawValue,
                                    cap
                                  );
                                }

                                return (
                                  <tr key={idx}>
                                    <td style={tdStyle}>
                                      {row.theme_code} —{" "}
                                      {row.theme_title}
                                    </td>
                                    <td style={tdStyle}>
                                      {row.subtheme_code} —{" "}
                                      {row.subtheme_title}
                                    </td>
                                    <td style={tdStyle}>{score}</td>
                                    <td style={tdStyle}>
                                      {point
                                        ? point.toFixed(2)
                                        : "—"}
                                    </td>
                                    <td style={tdStyle}>
                                      {hasRaw
                                        ? resultValue.toFixed(2)
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div
                          style={{
                            marginTop: 12,
                            fontSize: 14,
                            fontWeight: 600,
                            textAlign: "right",
                            paddingRight: 8,
                          }}
                        >
                          Iš viso: {totalRezultatas.toFixed(2)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {msg && (
              <div className="form-status form-status--error">
                {msg}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
