// -----------------------------------------------------------
//  [*] Employee — export to Excel
//
//  /employee/export: the employee's own activities behind
//  three multi-select filters (theme, subtheme, status), a
//  preview table, and an XLSX download of the filtered rows
//  built client-side with SheetJS.
//
//  Empty filter = no filtering ("(visi)"). Picking themes
//  narrows the subtheme options to those themes and resets
//  any subtheme picks.
//
//  Split into (root component last):
//
//    getActiveRole       — activeRole from localStorage
//    codeToNums          — "1.2.3" → [1,2,3]
//    compareCodes        — numeric-aware code ordering
//    statusClass         — status → pill css class
//    MultiSelectDropdown — checkbox dropdown filter
//    ExportPage          — the page (default export)
// -----------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import "../../components/employee.css";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// The active role for the X-Active-Role header, read fresh
// per request.
//
// Used by:
//   - ExportPage (below)
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
//   - ExportPage (below) — subtheme option ordering
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
// statusClass
// -----------------------------------------------------------
//
// Activity status → status-pill modifier class; unknown
// statuses get the bare pill.
//
// Used by:
//   - ExportPage (below) — the preview table
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// MultiSelectDropdown
// -----------------------------------------------------------
//
// A checkbox-list dropdown filter. The trigger summarizes the
// selection: placeholder when empty, the option's label when
// exactly one, "N pasirinkta" otherwise. No outside-click
// close — only the trigger toggles it.
//
// Used by:
//   - ExportPage (below) — theme / subtheme / status filters
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// ExportPage (default export)
// -----------------------------------------------------------
//
// Loads the theme tree and /api/activities/my in parallel on
// mount; filtering happens client-side over that snapshot.
// The XLSX is written with XLSX.writeFile, which triggers the
// browser download itself — no backend export endpoint.
//
// Used by:
//   - App.jsx — route /employee/export
// -----------------------------------------------------------

export default function ExportPage() {

  const [themes, setThemes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Filter selections — empty array means "no filter"
  const [filterThemeIds, setFilterThemeIds] = useState([]);
  const [filterSubthemeIds, setFilterSubthemeIds] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState([]);


  // Themes and activities load in parallel on mount
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


  // ISO → lt-LT date-time, also the format written into the
  // XLSX cells
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


  const themeOptions = useMemo(
    () =>
      themes.map((t) => ({
        id: String(t.id),
        label: `${t.code} — ${t.title}`,
      })),
    [themes]
  );


  // The theme tree flattened once; subthemes keep their
  // themeId so the theme filter can narrow them
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


  // The status filter's fixed choices — ids double as the
  // exact DB status strings
  const statusOptions = [
    { id: "PATEIKTA", label: "PATEIKTA" },
    { id: "PATVIRTINTA", label: "PATVIRTINTA" },
    { id: "ATMESTA", label: "ATMESTA" },
    { id: "TIKSLINTI", label: "TIKSLINTI" },
    { id: "ĮVERTINTA", label: "ĮVERTINTA" },
  ];


  // AND across the three filters; empty filter always passes
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


  // Build and download the workbook client-side
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
        {/* Filters + the export button */}
        <section className="card">
          <div className="card-body">
            <div className="export-filters-row">
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

        {/* Preview of what the XLSX will contain */}
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
