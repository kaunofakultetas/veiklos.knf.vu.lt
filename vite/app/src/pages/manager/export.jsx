// -----------------------------------------------------------
//  [*] Manager — export all activities to Excel
//
//  /manager/export: EVERY activity in the system (all
//  employees, all statuses) behind four multi-select filters
//  — employee (searchable), theme, subtheme, status — with a
//  preview table and an XLSX download built client-side.
//
//  The export carries more columns than the preview: it adds
//  descriptions and all three comment fields (rejection,
//  manager, committee). It keeps the rules both exports share
//  (components/exportCommon.js): a text longer than an XLSX
//  cell holds is cut to fit, and the file name carries the
//  local date and time.
//
//  Split into (root component last):
//
//    codeToNums          — "1.2.3" → [1,2,3]
//    compareCodes        — numeric-aware code ordering
//    statusClass         — status → pill css class
//    MultiSelectDropdown — checkbox dropdown, optional search
//    ManagerExportPage   — the page (default export)
// -----------------------------------------------------------

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx/dist/xlsx.full.min.js";
import { apiJsonAll } from "@/components/api.js";
import { fileStamp, fitRows } from "@/components/exportCommon.js";
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
//   - ManagerExportPage (below) — the subtheme options
//     within each theme
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
//   - ManagerExportPage (below) — the preview table
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
// The checkbox-list dropdown filter, here with an optional
// search box (withSearch) that narrows the visible options —
// used for the employee list, which can get long. Summary:
// placeholder / single label / "N pasirinkti". The trigger
// announces its popup state (aria-haspopup / aria-expanded)
// and is named by the filter's caption followed by the
// summary it shows, the arrow hidden from assistive tech —
// AppSelect's listbox-button pattern — so a screen reader
// names the filter before what it holds; the menu is a group
// named after `label`, and Escape closes it. Note this is a
// diverged copy of the one in employee/export.jsx (that one
// has no search and says "pasirinkta").
//
// Used by:
//   - ManagerExportPage (below) — all four filters
// -----------------------------------------------------------

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
  const triggerRef = useRef(null);

  // The trigger is named by the caption and then by itself,
  // so both need ids, unique per filter on the page
  const captionId = useId();
  const triggerId = useId();

  const toggleOpen = () => setOpen((o) => !o);

  // Escape closes the menu from anywhere inside it (search
  // box, a checkbox) and hands focus back to the trigger, so
  // a keyboard user is not left on an element that unmounts
  const handleKeyDown = (e) => {
    if (e.key !== "Escape" || !open) return;
    setOpen(false);
    triggerRef.current?.focus();
  };

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
    <div className="multi-select" onKeyDown={handleKeyDown}>
      <label className="field-label multi-select-label" id={captionId}>{label}</label>

      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="field-select multi-select-trigger"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${captionId} ${triggerId}`}
      >
        <span className="multi-select-summary">{summary}</span>
        <span className="multi-select-chevron" aria-hidden="true">▼</span>
      </button>

      {/* A named group, so a screen reader says which filter
          the checkboxes belong to; the search box, with only
          a placeholder, is named after the filter too */}
      {open && (
        <div className="multi-select-menu" role="group" aria-label={label}>
          {withSearch && (
            <div className="multi-select-search-wrapper">
              <input
                type="text"
                className="field-input multi-select-search"
                aria-label={`Paieška: ${label}`}
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







// -----------------------------------------------------------
// ManagerExportPage (default export)
// -----------------------------------------------------------
//
// Loads /api/activities/all and the theme tree in parallel on
// mount; all filtering is client-side. The employee filter's
// options are derived from the activities themselves, so only
// employees who have registered something appear. A written
// file clears the status line, so an earlier "Nėra veiklų
// eksportui." does not stand beside a download that worked.
//
// Used by:
//   - App.jsx — route /manager/export
// -----------------------------------------------------------

export default function ManagerExportPage() {

  const [themes, setThemes] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Filter selections — empty array means "no filter"
  const [filterEmployeeIds, setFilterEmployeeIds] = useState([]);
  const [filterThemeIds, setFilterThemeIds] = useState([]);
  const [filterSubthemeIds, setFilterSubthemeIds] = useState([]);
  const [filterStatuses, setFilterStatuses] = useState([]);


  // Activities and themes load in parallel on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      try {
        const [actsData, themesData] = await apiJsonAll([["/api/activities/all"], ["/api/themes"]]);

        // A 200 whose body is not the activities array would
        // throw on render (activities.filter) and blank the page
        if (!Array.isArray(actsData)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        // The same for the theme tree (themes.map)
        if (!Array.isArray(themesData)) throw new Error("Klaida: netikėtas serverio atsakymas.");

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


  // Distinct employees pulled from the activities, sorted by
  // name with Lithuanian collation. The label is forced to a
  // string: an eID may arrive numeric, and localeCompare is a
  // string method
  const employeeOptions = useMemo(() => {
    const map = new Map();
    for (const a of activities) {
      if (!a.employee_eid) continue;
      if (!map.has(a.employee_eid)) {
        map.set(a.employee_eid, {
          id: String(a.employee_eid),
          label: String(a.full_name || a.employee_eid),
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


  // The theme tree flattened once; subthemes keep their
  // themeId so the theme filter can narrow them, and their
  // theme's place in the tree so the options stay grouped by
  // theme — two theme families number their subthemes alike
  const allSubthemes = useMemo(() => {
    const list = [];
    for (const [themeIndex, t] of themes.entries()) {
      for (const s of t.subthemes || []) {
        list.push({
          id: String(s.id),
          themeId: String(t.id),
          themeIndex,
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

    return [...filtered].sort((a, b) => a.themeIndex - b.themeIndex || compareCodes(a.code, b.code));
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


  // AND across the four filters; empty filter always passes
  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      const empId = String(a.employee_eid);
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


  // Build and download the workbook client-side — includes
  // the comment columns the preview table omits — every text
  // cell cut to what an XLSX cell holds: SheetJS refuses to
  // write a longer one, and the whole download with it
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
      // A number, not pg's NUMERIC string: Excel's SUM
      // skips text cells
      a.score == null ? "" : Number(a.score),
      a.rejection_comment ?? "",
      a.manager_comments ?? "",
      a.committee_comments ?? "",
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(fitRows([header, ...rows]));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Veiklos");

    XLSX.writeFile(workbook, `veiklos-eksportas-vadybininkas-${fileStamp(new Date())}.xlsx`);

    // The file is written: an earlier "nothing to export"
    // refusal no longer applies
    setMsg("");
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Darbuotojų veiklų eksportas</h1>
        </div>
      </header>

      <main className="page-content">
        {/* Filters + the export button */}
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

        {/* Preview of what the XLSX will contain (minus the
            comment columns) */}
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
