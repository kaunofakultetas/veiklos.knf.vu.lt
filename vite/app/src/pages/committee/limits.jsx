// -----------------------------------------------------------
//  [*] Committee — theme budgets & subtheme limits
//
//  /committee/limits, two tables on one card: each theme's
//  total sum (its money budget) and each subtheme's score
//  cap. Every row has its own number input and save button,
//  and a save sends that one row's value. Rows save on their
//  own: a row's button stays disabled while its own save is
//  in flight, whatever the other rows do. The inputs have no
//  label of their own, so each is named for assistive tech
//  by its column's caption followed by the row's code.
//
//  The inputs are "new value" fields seeded with 0, not with
//  the current values — the current value sits in its own
//  read-only column, and a successful save resets the input
//  back to 0, unless a new draft was typed into it while the
//  save was in flight.
//
//  Split into (root component last):
//
//    LimitsPage    — both tables (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import { useBusyIds } from "@/components/sharedHooks.js";
import { apiJson, apiSend } from "@/components/api.js";
import "@/components/employee.css";







// -----------------------------------------------------------
// LimitsPage (default export)
// -----------------------------------------------------------
//
// Loads the theme tree once; caps and themeTotals are
// dictionaries of the per-row draft inputs keyed by
// subtheme/theme id, and each table keeps its busy flags per
// row (useBusyIds), so one row's save never re-enables
// another row's button. A save PATCHes the one value and
// patches the loaded tree in place, so the "current" columns
// update without a refetch; the row's draft goes back to 0
// unless it changed while the save was in flight.
//
// Used by:
//   - App.jsx — route /committee/limits
// -----------------------------------------------------------

export default function LimitsPage() {
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  // The status line: { text, error } or null — styled as an
  // error only when it is one
  const [status, setStatus] = useState(null);

  // Draft inputs and per-row busy flags — subtheme caps
  const [caps, setCaps] = useState({});
  const capBusy = useBusyIds();

  // Draft inputs and per-row busy flags — theme totals
  const [themeTotals, setThemeTotals] = useState({});
  const totalBusy = useBusyIds();


  // Load the tree and zero every draft input
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setStatus(null);
      try {
        const data = await apiJson("/api/themes");

        // A non-list 200 body (an object, null, a string)
        // would blow up the forEach below and both tables
        if (!Array.isArray(data)) throw new Error("Klaida: netikėtas serverio atsakymas.");

        setThemes(data);

        const initialCaps = {};
        data.forEach((t) =>
          (t.subthemes || []).forEach((s) => {
            initialCaps[s.id] = 0;
          })
        );
        setCaps(initialCaps);

        const initialThemeTotals = {};
        data.forEach((t) => {
          initialThemeTotals[t.id] = 0;
        });
        setThemeTotals(initialThemeTotals);
      } catch (e) {
        console.error("failed to load themes:", e);
        setStatus({ text: e.message || "Klaida: Nepavyko užkrauti temų ir potemių.", error: true });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);


  const handleCapChange = (subId, value) => {
    setCaps((prev) => ({
      ...prev,
      [subId]: value,
    }));
  };


  // Save one subtheme cap, patch the tree, zero the draft
  const handleSaveCap = async (subId) => {
    const raw = caps[subId];
    if (raw === "" || raw === null || raw === undefined) {
      setStatus({ text: "Klaida: Ribos reikšmė negali būti tuščia.", error: true });
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      setStatus({ text: "Klaida: Ribos reikšmė turi būti teigiamas skaičius.", error: true });
      return;
    }

    try {
      capBusy.start(subId);
      setStatus(null);
      await apiSend(`/api/themes/subthemes/${subId}/cap`, { method: "PATCH", json: { cap: num } });

      setThemes((prev) =>
        prev.map((t) => ({
          ...t,
          subthemes: (t.subthemes || []).map((s) =>
            s.id === subId ? { ...s, cap: num } : s
          ),
        }))
      );

      // Only the draft just saved goes back to 0 — one typed
      // into the row while the save was in flight is kept
      setCaps((prev) =>
        prev[subId] === raw ? { ...prev, [subId]: 0 } : prev
      );

      setStatus({ text: "Ribos sėkmingai atnaujintos.", error: false });
    } catch (e) {
      console.error("failed to save cap:", e);
      setStatus({ text: e.message || "Klaida: Nepavyko išsaugoti.", error: true });
    } finally {
      capBusy.stop(subId);
    }
  };


  const handleThemeTotalChange = (themeId, value) => {
    setThemeTotals((prev) => ({
      ...prev,
      [themeId]: value,
    }));
  };


  // Save one theme's total sum — same pattern as the caps
  const handleSaveThemeTotal = async (themeId) => {
    const raw = themeTotals[themeId];
    if (raw === "" || raw === null || raw === undefined) {
      setStatus({ text: "Klaida: Suma negali būti tuščia.", error: true });
      return;
    }

    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      setStatus({ text: "Klaida: Suma turi būti teigiamas skaičius.", error: true });
      return;
    }

    try {
      totalBusy.start(themeId);
      setStatus(null);
      await apiSend(`/api/themes/${themeId}/total-sum`, { method: "PATCH", json: { total_sum: num } });

      setThemes((prev) =>
        prev.map((t) => (t.id === themeId ? { ...t, total_sum: num } : t))
      );

      setThemeTotals((prev) =>
        prev[themeId] === raw ? { ...prev, [themeId]: 0 } : prev
      );

      setStatus({ text: "Temos suma atnaujinta.", error: false });
    } catch (e) {
      console.error("failed to save theme total:", e);
      setStatus({ text: e.message || "Klaida: Nepavyko išsaugoti sumos.", error: true });
    } finally {
      totalBusy.stop(themeId);
    }
  };


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Temų ir potemių limitų nustatymas</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card">
          <div className="card-body">
            {loading ? (
              <div className="employee-muted">Kraunama…</div>
            ) : (
              <>
                {/* Theme budgets */}
                <h2 className="section-title">Temų bendros sumos</h2>
                <div className="table-wrapper">
                  <table className="table my-activities-table">
                    <thead>
                      <tr>
                        <th>Tema</th>
                        <th>Pavadinimas</th>
                        <th>Dabartinė suma</th>
                        <th>Nauja suma</th>
                        <th>Veiksmai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {themes.map((t) => (
                        <tr key={t.id}>
                          <td>{t.code}</td>
                          <td>{t.title}</td>
                          <td>{t.total_sum != null
                                ? Number(t.total_sum).toFixed(2)
                                : "—"}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              aria-label={`Nauja suma: ${t.code}`}
                              value={themeTotals[t.id] ?? 0}
                              onChange={(e) =>
                                handleThemeTotalChange(t.id, e.target.value)
                              }
                              className="field-input"
                              style={{ maxWidth: 140 }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleSaveThemeTotal(t.id)}
                              disabled={totalBusy.isBusy(t.id)}
                              className="btn btn-primary btn-sm"
                            >
                              {totalBusy.isBusy(t.id)
                                ? "Saugoma…"
                                : "Išsaugoti"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ height: 16 }} />

                {/* Subtheme caps — one row per subtheme across
                    all themes */}
                <h2 className="section-title">Potemių limitai</h2>
                <div className="table-wrapper">
                  <table className="table my-activities-table">
                    <thead>
                      <tr>
                        <th>Tema</th>
                        <th>Potemė</th>
                        <th>Dabartinis limitas</th>
                        <th>Naujas limitas</th>
                        <th>Veiksmai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {themes.flatMap((t) =>
                        (t.subthemes || []).map((s) => (
                          <tr key={s.id}>
                            <td>
                              {t.code} — {t.title}
                            </td>
                            <td>
                              {s.code} — {s.title}
                            </td>
                            <td>
                              {s.cap != null
                                ? Number(s.cap).toFixed(2)
                                : "—"}
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                aria-label={`Naujas limitas: ${s.code}`}
                                value={caps[s.id] ?? 0}
                                onChange={(e) =>
                                  handleCapChange(s.id, e.target.value)
                                }
                                className="field-input"
                                style={{ maxWidth: 120 }}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => handleSaveCap(s.id)}
                                disabled={capBusy.isBusy(s.id)}
                                className="btn btn-primary btn-sm"
                              >
                                {capBusy.isBusy(s.id)
                                  ? "Saugoma…" : "Išsaugoti"}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {status && (
              <div className={status.error ? "form-status form-status--error" : "form-status"}>
                {status.text}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
