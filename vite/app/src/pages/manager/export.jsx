import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
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
    case "TIKSLINTI":
      return "status-pill status-pill--returned";
    case "ĮVERTINTA":
      return "status-pill status-pill--scored";
    default:
      return "status-pill";
  }
}

function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onChange,
  placeholder = "(visi)",
  withSearch = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const toggleOpen = () => setOpen((o) => !o);

  const visibleOptions = useMemo(() => {
    if (!withSearch || !search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, withSearch]);

  const handleToggle = (id) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  let summary = placeholder;
  if (selectedIds.length === 1) {
    const opt = options.find((o) => o.id === selectedIds[0]);
    summary = opt ? opt.label : placeholder;
  } else if (selectedIds.length > 1) {
    summary = `${selectedIds.length} pasirinkti`;
  }

  return (
    <div className="multi-select">
      <label className="field-label multi-select-label">{label}</label>

      <button
        type="button"
        className="field-select multi-select-trigger"
        onClick={toggleOpen}
      >
        <span className="multi-select-summary">{summary}</span>
        <span className="multi-select-chevron">▼</span>
      </button>

      {open && (
        <div className="multi-select-menu">
          {withSearch && (
            <div className="multi-select-search-wrapper">
              <input
                type="text"
                className="field-input multi-select-search"
                placeholder="Ieškoti…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}

          {visibleOptions.length === 0 ? (
            <div className="multi-select-empty">(nėra pasirinkimų)</div>
          ) : (
            visibleOptions.map((opt) => (
              <label key={opt.id} className="multi-select-option">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(opt.id)}
                  onChange={() => handleToggle(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ManagerExportPage() {

  const [themes, setThemes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [filterEmployeeIds, setFilterEmployeeIds] = useState([]);
  const [filterThemeIds, setFilterThemeIds] = useState([]);
  const [filterSubthemeIds, setFilterSubthemeIds] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [actsRes, themesRes] = await Promise.all([
          fetch("/api/activities/all", {
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

        setActivities(actsData);
        setThemes(themesData);
      } catch (e) {
        setMsg(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

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

  const employeeOptions = useMemo(() => {
    const map = new Map();
    for (const a of activities) {
      if (!a.employee_oid) continue;
      if (!map.has(a.employee_oid)) {
        map.set(a.employee_oid, {
          id: String(a.employee_oid),
          label: a.full_name || a.employee_oid,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "lt-LT")
    );
  }, [activities]);

  const themeOptions = useMemo(
    () =>
      themes.map((t) => ({
        id: String(t.id),
        label: `${t.code} — ${t.title}`,
      })),
    [themes]
  );

  const allSubthemes = useMemo(() => {
    const list = [];
    for (const t of themes) {
      for (const s of t.subthemes || []) {
        list.push({
          id: String(s.id),
          themeId: String(t.id),
          code: s.code || "",
          label: `${s.code} — ${s.title}`,
        });
      }
    }
    return list;
  }, [themes]);

  const subthemeOptions = useMemo(() => {
    const filtered = !filterThemeIds.length
      ? allSubthemes
      : allSubthemes.filter((s) => filterThemeIds.includes(s.themeId));

    return [...filtered].sort((a, b) => compareCodes(a.code, b.code));
  }, [allSubthemes, filterThemeIds]);

  const statusOptions = [
    { id: "PATEIKTA", label: "PATEIKTA" },
    { id: "PATVIRTINTA", label: "PATVIRTINTA" },
    { id: "ATMESTA", label: "ATMESTA" },
    { id: "TIKSLINTI", label: "TIKSLINTI" },
    { id: "ĮVERTINTA", label: "ĮVERTINTA" },
  ];

  // filter

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      const empId = String(a.employee_oid);
      const themeId = String(a.theme_id);
      const subthemeId = String(a.subtheme_id);

      if (filterEmployeeIds.length && !filterEmployeeIds.includes(empId))
        return false;
      if (filterThemeIds.length && !filterThemeIds.includes(themeId))
        return false;
      if (filterSubthemeIds.length && !filterSubthemeIds.includes(subthemeId))
        return false;
      if (filterStatuses.length && !filterStatuses.includes(a.status))
        return false;

      return true;
    });
  }, [
    activities,
    filterEmployeeIds,
    filterThemeIds,
    filterSubthemeIds,
    filterStatuses,
  ]);

  // XLSX 
  const exportXLSX = () => {
    if (!filteredActivities.length) {
      setMsg("Nėra veiklų eksportui.");
      return;
    }

    const header = [
      "Data",
      "Darbuotojas",
      "Temos kodas",
      "Temos pavadinimas",
      "Potemės kodas",
      "Potemės pavadinimas",
      "Veiklos pavadinimas",
      "Veiklos aprašymas",
      "Būsena",
      "Įvertinimas",
      "Atmetimo komentaras",
      "Vadybininko komentarai",
      "Komisijos nario komentarai",
    ];

    const rows = filteredActivities.map((a) => [
      formatDate(a.created_at),
      a.full_name ?? "",
      a.theme_code ?? "",
      a.theme_title ?? "",
      a.subtheme_code ?? "",
      a.subtheme_title ?? "",
      a.title ?? "",
      a.description ?? "",
      a.status ?? "",
      a.score ?? "",
      a.rejection_comment ?? "",
      a.manager_comments ?? "",
      a.committee_comments ?? "",
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Veiklos");

    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(workbook, `veiklos-eksportas-vadybininkas-${ts}.xlsx`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Darbuotojų veiklų eksportas</h1>
        </div>
      </header>

      <main className="page-content">
        {/* filters */}
        <section className="card card-wide">
          <div className="card-body">
            <div className="export-filters-row">
              <MultiSelectDropdown
                label="Darbuotojas"
                options={employeeOptions}
                selectedIds={filterEmployeeIds}
                onChange={setFilterEmployeeIds}
                placeholder="(visi darbuotojai)"
                withSearch
              />

              <MultiSelectDropdown
                label="Tema"
                options={themeOptions}
                selectedIds={filterThemeIds}
                onChange={(ids) => {
                  setFilterThemeIds(ids);
                  setFilterSubthemeIds([]);
                }}
                placeholder="(visos temos)"
              />

              <MultiSelectDropdown
                label="Potemė"
                options={subthemeOptions}
                selectedIds={filterSubthemeIds}
                onChange={setFilterSubthemeIds}
                placeholder="(visos potemės)"
              />

              <MultiSelectDropdown
                label="Būsena"
                options={statusOptions}
                selectedIds={filterStatuses}
                onChange={setFilterStatuses}
                placeholder="(visos būsenos)"
              />

              <div className="export-filters-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={exportXLSX}
                  disabled={loading}
                >
                  Eksportuoti
                </button>
              </div>
            </div>

            {msg && <div className="form-status">{msg}</div>}
          </div>
        </section>

        {/* table */}
        <section className="card card-wide">
          <div className="card-body">
            <h3 className="section-title">Filtruotos veiklos</h3>

            {loading ? (
              <div className="employee-muted">Kraunama…</div>
            ) : filteredActivities.length === 0 ? (
              <div className="employee-empty">(Nėra veiklų.)</div>
            ) : (
              <div className="table-wrapper">
                <table className="table my-activities-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Darbuotojas</th>
                      <th>Tema</th>
                      <th>Potemė</th>
                      <th>Veiklos pavadinimas</th>
                      <th>Būsena</th>
                      <th>Įvertinimas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivities.map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.created_at)}</td>
                        <td>{a.full_name}</td>
                        <td>
                          {a.theme_code} — {a.theme_title}
                        </td>
                        <td>
                          {a.subtheme_code} — {a.subtheme_title}
                        </td>
                        <td>{a.title}</td>
                        <td>
                          <span className={statusClass(a.status)}>
                            {a.status}
                          </span>
                        </td>
                        <td>
                          {a.score !== null && a.score !== undefined ? (
                            a.score
                          ) : (
                            <span className="table-muted">(nėra)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
