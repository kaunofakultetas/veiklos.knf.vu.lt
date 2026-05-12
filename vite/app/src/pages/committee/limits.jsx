import { useEffect, useState } from "react";
import "../../components/employee.css";

function getActiveRole() {
  return localStorage.getItem("activeRole") || "";
}

export default function LimitsPage() {
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [caps, setCaps] = useState({});
  const [savingId, setSavingId] = useState(null);

  const [themeTotals, setThemeTotals] = useState({});
  const [savingThemeId, setSavingThemeId] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
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
        setMsg(e.message || "Klaida: Nepavyko užkrauti temų ir potemių.");
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

  const handleSaveCap = async (subId) => {
    const raw = caps[subId];
    if (raw === "" || raw === null || raw === undefined) {
      setMsg("Klaida: Ribos reikšmė negali būti tuščia.");
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      setMsg("Klaida: Ribos reikšmė turi būti teigiamas skaičius.");
      return;
    }

    try {
      setSavingId(subId);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(`/api/themes/subthemes/${subId}/cap`, {
        method: "PATCH",
        headers: {
          "X-Active-Role": activeRole,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cap: num }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      setThemes((prev) =>
        prev.map((t) => ({
          ...t,
          subthemes: (t.subthemes || []).map((s) =>
            s.id === subId ? { ...s, cap: num } : s
          ),
        }))
      );

      setCaps((prev) => ({
        ...prev,
        [subId]: 0,
      }));

      setMsg("Ribos sėkmingai atnaujintos.");
    } catch (e) {
      console.error("failed to save cap:", e);
      setMsg(e.message || "Klaida: Nepavyko išsaugoti.");
    } finally {
      setSavingId(null);
    }
  };

  const handleThemeTotalChange = (themeId, value) => {
    setThemeTotals((prev) => ({
      ...prev,
      [themeId]: value,
    }));
  };

  const handleSaveThemeTotal = async (themeId) => {
    const raw = themeTotals[themeId];
    if (raw === "" || raw === null || raw === undefined) {
      setMsg("Klaida: Suma negali būti tuščia.");
      return;
    }

    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      setMsg("Klaida: Suma turi būti teigiamas skaičius.");
      return;
    }

    try {
      setSavingThemeId(themeId);
      setMsg("");

      const activeRole = getActiveRole();

      const res = await fetch(`/api/themes/${themeId}/total-sum`, {
        method: "PATCH",
        headers: {
          "X-Active-Role": activeRole,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ total_sum: num }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `${res.status} ${res.statusText}`);
      }

      setThemes((prev) =>
        prev.map((t) => (t.id === themeId ? { ...t, total_sum: num } : t))
      );

      setThemeTotals((prev) => ({
        ...prev,
        [themeId]: 0,
      }));

      setMsg("Temos suma atnaujinta.");
    } catch (e) {
      console.error("failed to save theme total:", e);
      setMsg(e.message || "Klaida: Nepavyko išsaugoti sumos.");
    } finally {
      setSavingThemeId(null);
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
                {/* limits */}
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
                              disabled={savingThemeId === t.id}
                              className="btn btn-primary btn-sm"
                            >
                              {savingThemeId === t.id
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

                {/* subtheme limits */}
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
                                disabled={savingId === s.id}
                                className="btn btn-primary btn-sm"
                              >
                                {savingId === s.id
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
