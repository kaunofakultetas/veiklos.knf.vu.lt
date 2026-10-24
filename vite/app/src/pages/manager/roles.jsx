// -----------------------------------------------------------
//  [*] Manager — role administration
//
//  /manager/roles: look a user up by email, see their roles
//  as pills, revoke with the ✕ on a pill, grant via the
//  dropdown of not-yet-owned roles. "Darbuotojas" has no ✕ —
//  the backend re-grants it automatically anyway.
//
//  After every change the page fires the window event
//  "app:roles-updated" so AppHeader refreshes its role
//  switcher, and a manager editing THEIR OWN "Vadybininkas"
//  role gets a confirm first (they would lock themselves out
//  of this page).
//
//  Auth rides in the session cookie alone: the backend holds
//  the /api/user-roles endpoints to the signed-in user's own
//  manager role whatever role the tab has active, so these
//  calls send no X-Active-Role.
// -----------------------------------------------------------

import { useState, useEffect } from "react";
import { apiJson, apiSend } from "@/components/api.js";
import "@/components/employee.css";







// -----------------------------------------------------------
// RolesPage (default export)
// -----------------------------------------------------------
//
// Roles are edited optimistically: assign/remove update the
// local pill list from the 2xx response without re-fetching
// the user. Both act on the user the card shows, never on
// the search box, which can be edited after the lookup — and
// the self-revoke confirm asks about that same user.
//
// Used by:
//   - App.jsx — route /manager/roles
// -----------------------------------------------------------

export default function RolesPage() {
  const [currentUserEmail, setCurrentUserEmail] = useState("");

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [allRoles, setAllRoles] = useState([]);
  const [assignRole, setAssignRole] = useState("");
  const [msg, setMsg] = useState("");


  // Own email from /api/me — needed to detect the "removing
  // my own manager role" case
  useEffect(() => {
    (async () => {
      try {
        const data = await apiJson("/api/me", { activeRole: false });
        setCurrentUserEmail((data.email || "").toLowerCase());
      } catch {
        // ignore — the self-removal confirm just won't trigger
      }
    })();
  }, []);


  // Look the entered email up; on failure everything resets
  // so stale roles never show under a bad search
  const load = async () => {
    setMsg("");
    setLoading(true);
    try {
      const data = await apiJson(`/api/user-roles?email=${encodeURIComponent(email)}`, {
        activeRole: false,
        fallback: "Klaida: Nepavyko įkelti naudotojo.",
      });

      // roles is mapped and allRoles filtered on render — a 200
      // without both arrays blanks the page or shows nothing
      if (!Array.isArray(data?.roles) || !Array.isArray(data?.allRoles)) throw new Error("Klaida: netikėtas serverio atsakymas.");

      setUser(data.user);
      setRoles(data.roles || []);
      setAllRoles(data.allRoles || []);

      // Preselect the first grantable role
      const unowned = (data.allRoles || []).filter(
        (r) => !(data.roles || []).includes(r)
      );
      setAssignRole(unowned[0] || "");
    } catch (e) {
      setUser(null);
      setRoles([]);
      setAllRoles([]);
      setAssignRole("");
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };


  const doAssign = async () => {
    if (!assignRole) return;
    setMsg("");
    try {
      await apiSend("/api/user-roles/assign", {
        method: "POST",
        json: { email: user.email, role: assignRole },
        activeRole: false,
        fallback: "Nepavyko priskirti rolės.",
      });

      const next = [...roles, assignRole].sort();
      setRoles(next);

      const unowned = allRoles.filter((r) => !next.includes(r));
      setAssignRole(unowned[0] || "");

      setMsg(`Priskirta rolė: ${assignRole}`);
      window.dispatchEvent(new Event("app:roles-updated"));
    } catch (e) {
      setMsg(e.message);
    }
  };


  const doRemove = async (role) => {
    setMsg("");

    // Removing your own manager role kicks you off this page
    // on the next header refresh — confirm it first
    const isSelf =
      currentUserEmail &&
      (user.email || "").toLowerCase() === currentUserEmail;

    if (role === "Vadybininkas" && isSelf) {
      const ok = window.confirm(
        "Ar tikrai norite sau nusiimti Vadybininko rolę?"
      );
      if (!ok) return;
    }

    try {
      await apiSend("/api/user-roles/remove", {
        method: "POST",
        json: { email: user.email, role },
        activeRole: false,
        fallback: "Nepavyko pašalinti rolės.",
      });

      const next = roles.filter((r) => r !== role);
      setRoles(next);

      const unowned = allRoles.filter((r) => !next.includes(r));
      if (!assignRole && unowned.length) setAssignRole(unowned[0]);

      setMsg(`Pašalinta rolė: ${role}`);

      window.dispatchEvent(new Event("app:roles-updated"));
    } catch (e) {
      setMsg(e.message);
    }
  };


  const availableRoles = allRoles.filter((r) => !roles.includes(r));


  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Rolių tvarkymas</h1>
          <p className="page-subtitle">
            Įveskite darbuotojo el.paštą norėdami priskirti arba pašalinti roles.
          </p>
        </div>
      </header>

      <main className="page-content">
        <section className="card employee-card">
          <div className="card-body">

            {/* Email search */}
            <div className="field">
              <label className="field-label" htmlFor="roles-email">Darbuotojo el.paštas</label>
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  maxWidth: 720,
                  width: "100%"
                }}
              >
                <input
                  id="roles-email"
                  className="field-input"
                  type="email"
                  placeholder="vardas.pavarde@knf.vu.lt"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={load}
                  disabled={!email || loading}
                >
                  {loading ? "Kraunama…" : "Įkelti"}
                </button>
              </div>
            </div>

            {user && (
              <>
                {/* Who was found */}
                <div className="field">
                  <label className="field-label">Darbuotojo informacija:</label>
                  <div className="info-box">
                    <div>
                      <strong>{user.full_name || user.email}</strong>
                    </div>
                    <div className="employee-modal-muted">{user.email}</div>
                  </div>
                </div>

                {/* Owned roles as pills; ✕ revokes — except
                    the base employee role */}
                <div className="field">
                  <label className="field-label">Turimos rolės:</label>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    {roles.length === 0 ? (
                      <span className="employee-modal-muted">(nėra)</span>
                    ) : (
                      roles.map((r) => (
                        <span
                          key={r}
                          className="status-pill"
                          style={{
                            gap: 6,
                            alignItems: "center",
                            border: "1px solid var(--color-primary)",
                            backgroundColor: "var(--color-white)"
                          }}
                        >
                          {r}
                          {r !== "Darbuotojas" && (
                            <button
                              type="button"
                              onClick={() => doRemove(r)}
                              className="btn btn-ghost btn-sm btn-danger"
                              title="Pašalinti"
                            >
                              ✕
                            </button>
                          )}
                        </span>
                      ))
                    )}

                  </div>
                </div>

                {/* Grant one of the not-yet-owned roles */}
                <div className="field">
                  <label className="field-label" htmlFor="roles-assign">Pridėti naują rolę:</label>
                  {availableRoles.length === 0 ? (
                    <div className="employee-modal-muted">
                      (Darbuotojas šiuo metu turi visas roles.)
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        maxWidth: 360,
                      }}
                    >
                      <select
                        id="roles-assign"
                        className="field-select"
                        value={assignRole}
                        onChange={(e) => setAssignRole(e.target.value)}
                      >
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={doAssign}
                        disabled={!assignRole}
                      >
                        Priskirti rolę
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {msg && <div className="form-status">{msg}</div>}

          </div>
        </section>
      </main>
    </div>
  );
}
