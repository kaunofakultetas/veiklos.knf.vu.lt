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
}) {
  const [open, setOpen] = useState(false);

  const toggleOpen = () => setOpen((o) => !o);

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
    summary = `${selectedIds.length} pasirinkta`;
  }

  return (
    <div className="multi-select">
      <label className="multi-select-label">{label}</label>

      <button
        type="button"
        className="multi-select-trigger"
        onClick={toggleOpen}
      >
        <span className="multi-select-summary">{summary}</span>
        <span className="multi-select-chevron">▾</span>
      </button>

      {open && (
        <div className="multi-select-menu">
          {options.length === 0 ? (
            <div className="multi-select-empty">(nėra pasirinkimų)</div>
          ) : (
            options.map((opt) => (
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

export default function ExportPage() {

  const [themes, setThemes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // filters
  const [filterThemeIds, setFilterThemeIds] = useState([]);
  const [filterSubthemeIds, setFilterSubthemeIds] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const activeRole = getActiveRole();

        const [themesRes, actsRes] = await Promise.all([
          fetch("/api/themes", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
          fetch("/api/activities/my", {
            headers: {
              "X-Active-Role": activeRole,
            },
          }),
        ]);

        const themesData = await themesRes.json().catch(() => ({}));
        if (!themesRes.ok) {
          throw new Error(
            themesData?.error ||
              `${themesRes.status} ${themesRes.statusText}`
          );
        }

        const actsData = await actsRes.json().catch(() => ({}));
        if (!actsRes.ok) {
          throw new Error(
            actsData?.error || `${actsRes.status} ${actsRes.statusText}`
          );
        }

        setThemes(themesData);
        setActivities(actsData);
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

  // options
  const themeOptions = useMemo(
    () =>
      themes.map((t) => ({
        id: String(t.id),
        label: `${t.code} — ${t.title}`,
      })),
    [themes]
  );

  // filter
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

  // filter logic
  const filteredActivities = useMemo(
    () =>
      activities.filter((a) => {
        const themeId = String(a.theme_id);
        const subthemeId = String(a.subtheme_id);

        if (filterThemeIds.length && !filterThemeIds.includes(themeId))
          return false;
        if (
          filterSubthemeIds.length &&
          !filterSubthemeIds.includes(subthemeId)
        )
          return false;
        if (filterStatuses.length && !filterStatuses.includes(a.status))
          return false;

        return true;
      }),
    [activities, filterThemeIds, filterSubthemeIds, filterStatuses]
  );

  // xlsx export
  const exportXLSX = () => {
    if (!filteredActivities.length) {
      setMsg("Nėra veiklų eksportui.");
      return;
    }

    const header = [
      "Data",
      "Temos kodas",
      "Temos pavadinimas",
      "Potemės kodas",
      "Potemės pavadinimas",
      "Veiklos pavadinimas",
      "Veiklos aprašymas",
      "Būsena",
      "Įvertinimas",
    ];

    const rows = filteredActivities.map((a) => [
      formatDate(a.created_at),
      a.theme_code ?? "",
      a.theme_title ?? "",
      a.subtheme_code ?? "",
      a.subtheme_title ?? "",
      a.title ?? "",
      a.description ?? "",
      a.status ?? "",
      a.score ?? "",
    ]);

    const xlsxData = [header, ...rows];

    const worksheet = XLSX.utils.aoa_to_sheet(xlsxData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Veiklos");

    const now = new Date();
    const ts = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(workbook, `veiklos-eksportas-${ts}.xlsx`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Eksportas</h1>
        </div>
      </header>

      <main className="page-content">
        {/* filters / export button */}
        <section className="card">
          <div className="card-body">
            <div className="export-filters-row">
              {/* theme */}
              <MultiSelectDropdown
                label="Tema"
                options={themeOptions}
                selectedIds={filterThemeIds}
                onChange={(ids) => {
                  setFilterThemeIds(ids);
                  setFilterSubthemeIds([]); // reset subthemes on themes change
                }}
                placeholder="(visos temos)"
              />

              {/* subthemes */}
              <MultiSelectDropdown
                label="Potemė"
                options={subthemeOptions}
                selectedIds={filterSubthemeIds}
                onChange={setFilterSubthemeIds}
                placeholder="(visos potemės)"
              />

              {/* status */}
              <MultiSelectDropdown
                label="Būsena"
                options={statusOptions}
                selectedIds={filterStatuses}
                onChange={setFilterStatuses}
                placeholder="(visos būsenos)"
              />

              {/* export button */}
              <div className="export-filters-actions">
                <button
                  type="button"
                  onClick={exportXLSX}
                  className="btn btn-primary"
                  disabled={loading}
                >
                  Eksportuoti
                </button>
              </div>
            </div>

            {msg && (
              <div className="form-status form-status--error">
                {msg}
              </div>
            )}
          </div>
        </section>

        {/* results */}
        <section className="card">
          <div className="card-body">
            <h2 className="section-title">Filtruotos veiklos</h2>

            {loading ? (
              <div className="employee-muted">Kraunama…</div>
            ) : filteredActivities.length === 0 ? (
              <div className="employee-empty">(Nėra atitinkančių veiklų.)</div>
            ) : (
              <div className="table-wrapper">
                <table className="table my-activities-table">
                  <thead>
                    <tr>
                      <th>Data</th>
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
