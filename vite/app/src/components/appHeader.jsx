// -----------------------------------------------------------
//  [*] AppHeader — the shared top bar
//
//  Shown on every signed-in page (each workspace layout wraps
//  its nav links in it): VU logo + system title on the left,
//  role switcher, user name and "Atsijungti" on the right.
//
//  Loads the caller's roles from /api/me on mount and repairs
//  localStorage("activeRole") when it is missing or no longer
//  owned (falls back to the first role). Until the answer the
//  role block shows the stored role or "Kraunama…"; an answer
//  without roles shows "(nėra)". Listens for the window event
//  "app:roles-updated" — manager/roles.jsx fires it after
//  editing roles so the switcher refreshes without a reload.
//
//  Switching roles navigates straight to the chosen role's
//  workspace. Signing out POSTs to /auth/saml/logout and then
//  navigates to the URL a 2xx answer carries (VU SSO's logout,
//  or "/"); a refused or failed request lands on "/". A POST
//  so that no other site can trigger it: a cross-site request
//  carries no SameSite=Lax cookie.
//
//  Split into (root component last):
//
//    roleToPath — role name → workspace path
//    AppHeader  — the bar itself (default export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import vuLogo from "@/assets/VU.png";
import "./appHeader.css";







// -----------------------------------------------------------
// roleToPath
// -----------------------------------------------------------
//
// Role name → workspace path; duplicate of the one in
// App.jsx.
//
// Used by:
//   - AppHeader (below) — role switch and logo click
// -----------------------------------------------------------

const roleToPath = (role) => {
  switch (role) {
    case "Vadybininkas": return "/manager";
    case "Komisijos narys": return "/committee";
    case "Darbuotojas": return "/employee";
    default: return "/";
  }
};







// -----------------------------------------------------------
// AppHeader (default export)
// -----------------------------------------------------------
//
// Takes nav links as children and renders them between the
// brand and the role/user block.
//
// Used by:
//   - pages/manager/layout.jsx, pages/employee/layout.jsx,
//     pages/committee/layout.jsx
// -----------------------------------------------------------

export default function AppHeader({ children }) {
  const navigate = useNavigate();

  const [roles, setRoles] = useState([]);

  // Whether /api/me has answered: the roles array alone cannot
  // tell a pending answer ("Kraunama…") from an answer with no
  // roles ("(nėra)")
  const [rolesLoaded, setRolesLoaded] = useState(false);

  const [activeRole, setActiveRole] = useState(
    () => localStorage.getItem("activeRole") || ""
  );
  const [fullName, setFullName] = useState("");


  // Load roles on mount, and again whenever a page announces
  // a role change via "app:roles-updated"
  useEffect(() => {
    const loadMe = async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data = await res.json();

        // /api/me sends plain strings, but tolerate {name}
        // objects too ( /api/session/init's shape )
        const names = (data.roles || []).map((r) =>
          typeof r === "string" ? r : r.name
        );

        setRoles(names);
        setFullName(data.name || "");
        setRolesLoaded(true);

        // Repair a stale/foreign activeRole in localStorage
        const storedActive = localStorage.getItem("activeRole") || "";

        if (names.length === 0) {
          setActiveRole("");
          localStorage.removeItem("activeRole");
        } else if (!storedActive || !names.includes(storedActive)) {
          const fallback = names[0];
          setActiveRole(fallback);
          localStorage.setItem("activeRole", fallback);
        } else {
          setActiveRole(storedActive);
        }
      } catch {
        // ignore — the bar just shows "Kraunama…" until a
        // later refresh succeeds
      }
    };
    loadMe();

    const handler = () => loadMe();

    window.addEventListener("app:roles-updated", handler);

    return () => window.removeEventListener("app:roles-updated", handler);
  }, []);


  const onRoleChange = (next) => {
    setActiveRole(next);
    localStorage.setItem("activeRole", next);
    navigate(roleToPath(next), { replace: true });
  };


  // The backend ends the session on the POST and hands back
  // where to go next; the navigation is a plain top-level one
  // (a form POST followed by a 302 to VU would trip the CSP
  // form-action rule in Chromium)
  const signOut = async () => {
    localStorage.removeItem("activeRole");
    let redirect = "/";
    try {
      const res = await fetch("/auth/saml/logout", { method: "POST" });

      // Only a 2xx answer's redirect is followed — an error
      // answer's body is not a place to be sent to
      if (res.ok) {
        const data = await res.json();
        if (typeof data.redirect === "string" && data.redirect) redirect = data.redirect;
      }
    } catch {
      // backend unreachable or a non-JSON answer: land home,
      // where the session probe decides what the user sees
    }
    window.location.href = redirect;
  };


  // Logo/brand click goes to the active workspace, not "/"
  const handleLogoClick = () => {
    navigate(activeRole ? roleToPath(activeRole) : "/");
  };


  return (
    <header className="app-header">
      <div className="app-header-left">
        <img src={vuLogo} alt="VU logo" className="app-logo" onClick={handleLogoClick} style={{ cursor: "pointer" }} />
        <div className="app-brand" onClick={handleLogoClick} style={{ cursor: "pointer" }}>VU KNF Veiklų registravimo sistema</div>
        <nav className="app-nav">
          {children}
        </nav>
      </div>

      <div className="app-header-right">
        {/* Role block: a switcher when several roles, plain
            text when one; with no role the text is "Kraunama…"
            until /api/me answers and "(nėra)" after */}
        <div className="app-role-block">
          <span className="app-role-label">Prisijungta su role:</span>
          {roles.length > 1 ? (
            <select
              value={activeRole}
              onChange={(e) => onRoleChange(e.target.value)}
              className="app-role-select"
            >
              {roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          ) : (
            <b className="app-role-value">
              {activeRole || (rolesLoaded ? "(nėra)" : "Kraunama…")}
            </b>
          )}
        </div>

        <div className="app-user-block">
          <span className="app-user-label">Prisijungęs:</span>
          <span className="app-user-name">{fullName || "—"}</span>
        </div>

        <button onClick={signOut} className="btn btn-primary app-signout">
          Atsijungti
        </button>
      </div>
    </header>
  );
}
