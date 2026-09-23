// -----------------------------------------------------------
//  [*] Committee — point value & bonus calculator
//
//  /committee/calculate, two panels:
//
//  Left — per-theme score totals, and the calculator: pick a
//  theme, see its budget (total_sum) and its uncapped score
//  sum, then "Skaičiuoti" computes 1 point's value as
//  budget / score-sum (2 decimals) and SAVES it to the theme
//  via PATCH /api/themes/:id/pointvalue in the same click.
//
//  Right — pick an employee (searchable dropdown of everyone
//  with ĮVERTINTA work) and see their per-subtheme score
//  sums. Each row's result is score × the theme's SAVED point
//  value, capped by the subtheme's limit when one is set
//  (cap 0 or null = no cap); "Iš viso" sums the capped
//  results. Rows with a zero result show "—" and don't count.
//
//  So the flow is: save the point value on the left first —
//  the right panel reads the stored theme_pointvalue, not the
//  freshly displayed one.
//
//  Split into (root component last):
//
//    LAYOUT / PANEL / TABLE_STYLE / TH_STYLE / TD_STYLE
//                         — inline styles of the two panels
//    getActiveRole        — activeRole from localStorage
//    rowResult            — one subtheme row's capped result
//    ThemeTotalsTable     — left: per-theme score sums
//    PointValueCalculator — left: theme picker + Skaičiuoti
//    EmployeePicker       — right: searchable employee dropdown
//    EmployeeResultsTable — right: capped rows + Iš viso
//    CalculatePage        — state, loads, save (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import "@/components/employee.css";


// Inline style objects for the two panels — this page skips
// employee.css for its layout, the only page that does
const LAYOUT = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  flexWrap: "nowrap",
};

const PANEL = {
  flex: "0 0 50%",
  minWidth: 0,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 16,
};

const TABLE_STYLE = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const TH_STYLE = {
  borderBottom: "1px solid #e5e7eb",
  padding: "6px 6px",
  textAlign: "left",
  fontWeight: 600,
};

const TD_STYLE = {
  borderBottom: "1px solid #e5e7eb",
  padding: "6px 6px",
  textAlign: "left",
};







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request.
//
// Used by:
//   - CalculatePage (below) — every API call
// -----------------------------------------------------------

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}







// -----------------------------------------------------------
// rowResult
// -----------------------------------------------------------
//
// One employee subtheme row → { score, point, hasRaw,
// resultValue }: result = score × the theme's SAVED point
// value, clamped to the subtheme cap when cap > 0 (cap 0 or
// null = no cap). hasRaw is false when the raw product is 0
// or not finite — such rows display "—" and add nothing to
// "Iš viso".
//
// Used by:
//   - EmployeeResultsTable (below) — every row and the total
// -----------------------------------------------------------

function rowResult(row) {
  const score = Number(row.total_score) || 0;
  const point = Number(row.theme_pointvalue) || 0;
  const cap =
    row.subtheme_cap !== null && row.subtheme_cap !== undefined
      ? Number(row.subtheme_cap)
      : null;

  const rawValue = score * point;
  const hasRaw = Number.isFinite(rawValue) && rawValue > 0;

  let resultValue = hasRaw ? rawValue : 0;
  if (cap !== null && Number.isFinite(cap) && cap > 0) {
    resultValue = Math.min(rawValue, cap);
  }

  return { score, point, hasRaw, resultValue };
}







// -----------------------------------------------------------
// ThemeTotalsTable
// -----------------------------------------------------------
//
// The left panel's top table: every theme with its uncapped
// ĮVERTINTA score sum (total_score, 0 when null). Loading and
// empty states are early returns.
//
// Used by:
//   - CalculatePage (below) — left panel
// -----------------------------------------------------------

function ThemeTotalsTable({ themeTotals, loading }) {
  if (loading) {
    return (
      <div className="employee-muted">
        Kraunama temų informacija…
      </div>
    );
  }

  if (themeTotals.length === 0) {
    return (
      <div className="employee-empty">
        Šiuo metu nėra įvertintų temų.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th style={TH_STYLE}>Tema</th>
            <th style={TH_STYLE}>Pavadinimas</th>
            <th style={TH_STYLE}>Bendra balų suma</th>
          </tr>
        </thead>
        <tbody>
          {themeTotals.map((t) => (
            <tr key={t.theme_id}>
              <td style={TD_STYLE}>{t.theme_code}</td>
              <td style={TD_STYLE}>{t.theme_title}</td>
              <td style={TD_STYLE}>{t.total_score ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}







// -----------------------------------------------------------
// PointValueCalculator
// -----------------------------------------------------------
//
// The left panel's "Skaičiuoklė" block: theme <select>, the
// theme's budget and score sum as read-only inputs (blank
// until a theme is picked), the "Skaičiuoti" button and the
// "1 balo vertė" result box. The button is disabled without
// a theme, when valuePerScore is null/non-finite, or while
// saving; the box shows the value only after a successful
// save (hasCalculated).
//
// Used by:
//   - CalculatePage (below) — left panel
// -----------------------------------------------------------

function PointValueCalculator({
  themeTotals,
  selectedThemeId,
  onSelectTheme,
  totalSum,
  scoreSum,
  valuePerScore,
  hasCalculated,
  saving,
  onSave,
}) {
  return (
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
          onChange={(e) => onSelectTheme(e.target.value)}
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
          value={selectedThemeId ? totalSum : ""}
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
          value={selectedThemeId ? scoreSum : ""}
          placeholder="-"
          className="field-input"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={onSave}
          className="btn btn-primary"
          disabled={
            !selectedThemeId ||
            valuePerScore === null ||
            !Number.isFinite(valuePerScore) ||
            saving
          }
        >
          {saving ? "Saugoma…" : "Skaičiuoti"}
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
  );
}







// -----------------------------------------------------------
// EmployeePicker
// -----------------------------------------------------------
//
// The right panel's employee dropdown — hand-rolled here
// (with a search box) rather than using AppSelect. The
// open/closed and search-term state is its own; picking an
// option reports the eid up, closes the list and clears the
// search. Loading and empty states are early returns.
//
// Used by:
//   - CalculatePage (below) — right panel
// -----------------------------------------------------------

function EmployeePicker({ employees, loading, selectedEid, onSelect }) {

  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");


  const options = employees.map((e) => ({
    id: e.eid,
    label: e.full_name || e.email || e.eid,
  }));

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedLabel =
    options.find((o) => o.id === selectedEid)?.label ||
    "(nepasirinktas)";


  if (loading) {
    return (
      <div className="employee-muted">
        Kraunami darbuotojai…
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="employee-empty">
        Nerasta darbuotojų.
      </div>
    );
  }

  return (
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
        onClick={() => setOpen((o) => !o)}
      >
        <span className="app-select-label">
          {selectedLabel}
        </span>
        <span className="app-select-chevron">▾</span>
      </button>

      {open && (
        <div className="app-select-dropdown">
          <div className="multi-select-search-wrapper">
            <input
              type="text"
              placeholder="Ieškoti darbuotojo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="multi-select-search"
            />
          </div>

          {filteredOptions.length === 0 ? (
            <div className="multi-select-empty">
              (nėra atitinkančių darbuotojų)
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="app-select-option"
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                  setSearchTerm("");
                }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}







// -----------------------------------------------------------
// EmployeeResultsTable
// -----------------------------------------------------------
//
// The selected employee's per-subtheme rows (rowResult each)
// and the "Iš viso" line — the sum of the capped results,
// the same math as the rows. Loading and empty states are
// early returns.
//
// Used by:
//   - CalculatePage (below) — right panel, once an employee
//     is selected
// -----------------------------------------------------------

function EmployeeResultsTable({ rows, loading }) {
  if (loading) {
    return (
      <div className="employee-muted">
        Kraunama…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="employee-empty">
        Šis darbuotojas neturi įvertintų veiklų.
      </div>
    );
  }

  const total = rows.reduce((sum, row) => {
    const { hasRaw, resultValue } = rowResult(row);
    return hasRaw ? sum + resultValue : sum;
  }, 0);

  return (
    <>
      <div className="table-wrapper">
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Tema</th>
              <th style={TH_STYLE}>Potemė</th>
              <th style={TH_STYLE}>Balų suma</th>
              <th style={TH_STYLE}>1 balo vertė</th>
              <th style={TH_STYLE}>Rezultatas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const { score, point, hasRaw, resultValue } = rowResult(row);
              return (
                <tr key={idx}>
                  <td style={TD_STYLE}>
                    {row.theme_code} —{" "}
                    {row.theme_title}
                  </td>
                  <td style={TD_STYLE}>
                    {row.subtheme_code} —{" "}
                    {row.subtheme_title}
                  </td>
                  <td style={TD_STYLE}>{score}</td>
                  <td style={TD_STYLE}>
                    {point
                      ? point.toFixed(2)
                      : "—"}
                  </td>
                  <td style={TD_STYLE}>
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
        Iš viso: {total.toFixed(2)}
      </div>
    </>
  );
}







// -----------------------------------------------------------
// CalculatePage (default export)
// -----------------------------------------------------------
//
// Owns the data and the requests: theme totals and the
// employee list load together on mount, the selected
// employee's subtheme sums load on selection, and
// "Skaičiuoti" computes AND persists the point value. The
// result box only fills after a successful save
// (hasCalculated), and picking another theme blanks it again.
// One error/status line (msg) serves every request.
//
// Used by:
//   - App.jsx — route /committee/calculate
// -----------------------------------------------------------

export default function CalculatePage() {

  const [themeTotals, setThemeTotals] = useState([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState("");

  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployeeEid, setSelectedEmployeeEid] = useState("");
  const [employeeSubthemes, setEmployeeSubthemes] = useState([]);
  const [subthemesLoading, setSubthemesLoading] = useState(false);

  const [msg, setMsg] = useState("");
  const [savingPoint, setSavingPoint] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);


  // Theme totals and employees load in parallel on mount
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


  // Switching themes invalidates the shown point value
  useEffect(() => {
    setHasCalculated(false);
  }, [selectedThemeId]);


  // The selected employee's per-subtheme sums
  useEffect(() => {
    const loadSubthemes = async () => {
      if (!selectedEmployeeEid) {
        setEmployeeSubthemes([]);
        return;
      }

      setSubthemesLoading(true);
      setMsg("");

      try {
        const activeRole = getActiveRole();

        const res = await fetch(
          `/api/activities/evaluated/employee/${selectedEmployeeEid}/subthemes`,
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
  }, [selectedEmployeeEid]);


  const selectedTheme = themeTotals.find(
    (t) => String(t.theme_id) === String(selectedThemeId)
  );

  const selectedThemeScoreSum = selectedTheme
    ? Number(selectedTheme.total_score) || 0
    : 0;

  const selectedThemeTotalSum = selectedTheme
    ? Number(selectedTheme.theme_total_sum) || 0
    : 0;

  // Euros per point; null when either side is 0/missing —
  // that also disables the save button
  const valuePerScore =
    selectedThemeScoreSum > 0 && selectedThemeTotalSum > 0
      ? selectedThemeTotalSum / selectedThemeScoreSum
      : null;


  // "Skaičiuoti" both computes AND persists the point value
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
            <div style={LAYOUT}>

              {/* Left panel — theme totals + the point-value
                  calculator */}
              <div style={PANEL}>
                <h3>Temų balų suvestinė</h3>

                <ThemeTotalsTable
                  themeTotals={themeTotals}
                  loading={themesLoading}
                />

                <PointValueCalculator
                  themeTotals={themeTotals}
                  selectedThemeId={selectedThemeId}
                  onSelectTheme={setSelectedThemeId}
                  totalSum={selectedThemeTotalSum}
                  scoreSum={selectedThemeScoreSum}
                  valuePerScore={valuePerScore}
                  hasCalculated={hasCalculated}
                  saving={savingPoint}
                  onSave={handleSavePointValue}
                />
              </div>

              {/* Right panel — one employee's capped results */}
              <div style={PANEL}>
                <h3>Darbuotojo veiklos pagal temas ir potemes</h3>

                <div style={{ marginBottom: 12, position: "relative" }}>
                  <div className="employee-modal-muted">
                    Pasirinkite darbuotoją
                  </div>
                  <EmployeePicker
                    employees={employees}
                    loading={employeesLoading}
                    selectedEid={selectedEmployeeEid}
                    onSelect={setSelectedEmployeeEid}
                  />
                </div>

                {selectedEmployeeEid && (
                  <div>
                    <h4 style={{ marginTop: 12, marginBottom: 8 }}>
                      Veiklų lentelė pasirinktam darbuotojui
                    </h4>

                    <EmployeeResultsTable
                      rows={employeeSubthemes}
                      loading={subthemesLoading}
                    />
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
