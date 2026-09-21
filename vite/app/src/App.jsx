// -----------------------------------------------------------
//  [*] App — routing and sign-in flow
//
//  The SPA's root: Keycloak/SAML sign-in, the role-based
//  route tree, and the first-visit flow that picks the active
//  role.
//
//  Auth is a session cookie. On load RoutesRoot probes
//  GET /api/session/check once and publishes the result
//  through AuthContext ({ user, session, loading }); signing
//  in is a full-page redirect to /auth/saml/login, so the SPA
//  never handles tokens itself.
//
//  The active role is the app's central switch. It lives in
//  localStorage("activeRole"), gates every /manager,
//  /committee and /employee route (RoleRoute), and the pages
//  send it to the backend as the X-Active-Role header.
//
//  Split into (root component last):
//
//    AuthContext     — the session state for the whole tree
//    roleToPath      — role name → workspace path
//    SignIn          — the "Prisijungti" card
//    RolePickerModal — role choice for multi-role users
//    HomeGate        — "/" — sign-in / redirect / profile
//    Profile         — role selection after sign-in
//    RoleRoute       — guard for a workspace subtree
//    RoutesRoot      — session probe + the <Routes> table
//    App             — BrowserRouter wrapper (default export)
// -----------------------------------------------------------

import { useEffect, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import "./components/appLayout.css";
import vuLogo from "./assets/VU logo.png";

// Manager pages
import ManagerPage from "./pages/manager/index.jsx";
import ManagerLayout from "./pages/manager/layout.jsx";
import RolesPage from "./pages/manager/roles.jsx";
import ManagerReviewPage from "./pages/manager/review.jsx";
import ManagerExportPage from "./pages/manager/export.jsx";
import ThemesPage from "./pages/manager/themes.jsx";

// Employee pages
import EmployeePage from "./pages/employee/index.jsx";
import EmployeeLayout from "./pages/employee/layout.jsx";
import NewActivity from "./pages/employee/newActivity.jsx";
import MyActivities from "./pages/employee/myActivities.jsx";
import ExportPage from "./pages/employee/export.jsx";

// Committee pages
import CommitteePage from "./pages/committee/index.jsx";
import CommitteeLayout from "./pages/committee/layout.jsx";
import EvaluatePage from "./pages/committee/evaluate.jsx";
import ResultsPage from "./pages/committee/results.jsx";
import LimitsPage from "./pages/committee/limits.jsx";
import CalculatePage from "./pages/committee/calculate.jsx";







// -----------------------------------------------------------
// AuthContext
// -----------------------------------------------------------
//
// { user, session, loading } from the one /api/session/check
// probe in RoutesRoot — user null means "not signed in".
//
// Used by:
//   - HomeGate, Profile, RoleRoute (below)
// -----------------------------------------------------------

export const AuthContext = createContext(null);







// -----------------------------------------------------------
// roleToPath
// -----------------------------------------------------------
//
// Role name (as stored in the DB, Lithuanian) → workspace
// path. An unknown role falls back to "/". The same mapping
// exists again in components/appHeader.jsx.
//
// Used by:
//   - HomeGate, Profile (below)
// -----------------------------------------------------------

const roleToPath = (role) => {
  switch (role) {
    case "Vadybininkas":    return "/manager";
    case "Komisijos narys": return "/committee";
    case "Darbuotojas":    return "/employee";
    default:               return "/";
  }
};







// -----------------------------------------------------------
// SignIn
// -----------------------------------------------------------
//
// The unauthenticated landing card: VU logo + a button that
// hard-navigates to /auth/saml/login, where the backend
// bounces the browser to Keycloak.
//
// Used by:
//   - HomeGate (below)
// -----------------------------------------------------------

function SignIn() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img
          src={vuLogo}
          alt="Vilniaus universiteto logotipas"
          className="auth-logo"
        />
        <h1 className="auth-title">Vilniaus universiteto veiklos</h1>
        <p className="auth-subtitle">
          Paslaugai reikalingas Jūsų tapatybės patvirtinimas.
        </p>
        <button
          onClick={() => { window.location.href = "/auth/saml/login"; }}
          className="btn btn-primary auth-button"
        >
          Prisijungti per VU bendro prisijungimo sistemą
        </button>
      </div>
      <footer className="app-footer">
        <div className="app-footer-inner">
          © {new Date().getFullYear()} ISKS'22 Goda Stungurytė. Visos teisės saugomos.
        </div>
      </footer>
    </div>
  );
}







// -----------------------------------------------------------
// RolePickerModal
// -----------------------------------------------------------
//
// Blocking modal for users with several roles: pick one, hit
// "Patvirtinti". No cancel — a role must be chosen to enter
// the app.
//
// Used by:
//   - Profile (below)
// -----------------------------------------------------------

function RolePickerModal({ roles, initial, onConfirm }) {
  const [sel, setSel] = useState(initial || roles[0] || "");

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal-title">Pasirinkite rolę</h2>
        <p className="modal-text">
          Pasirinkite rolę, su kuria tęsite veiklą sistemoje.
        </p>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="field-select modal-select"
        >
          {roles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="modal-actions">
          <button onClick={() => onConfirm(sel)} className="btn btn-primary">
            Patvirtinti
          </button>
        </div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// HomeGate
// -----------------------------------------------------------
//
// The "/" route: SignIn when logged out, a redirect to the
// stored active role's workspace when one is set, otherwise
// Profile to pick a role.
//
// Used by:
//   - RoutesRoot (below) — route "/"
// -----------------------------------------------------------

function HomeGate() {
  const { user } = useContext(AuthContext);
  const activeRole = localStorage.getItem("activeRole") || "";

  if (!user) return <SignIn />;
  if (activeRole) return <Navigate to={roleToPath(activeRole)} replace />;
  return <Profile />;
}







// -----------------------------------------------------------
// Profile
// -----------------------------------------------------------
//
// The post-sign-in role flow, driven by the session from
// AuthContext: exactly one role → auto-select and navigate;
// several → RolePickerModal. Falls through to a "Kraunama…"
// card while neither branch has fired.
//
// Used by:
//   - HomeGate (below)
// -----------------------------------------------------------

function Profile() {
  const { session } = useContext(AuthContext);
  const navigate = useNavigate();

  const [activeRole, setActiveRole] = useState(() => localStorage.getItem("activeRole") || "");
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);


  // One role picks itself; several open the picker. Roles
  // may come as strings or { name } objects — tolerate both
  useEffect(() => {
    if (!session) return;
    const roleNames = (session.roles || []).map((r) => typeof r === "string" ? r : r.name);

    if (roleNames.length === 1 && !activeRole) {
      const r = roleNames[0];
      setActiveRole(r);
      localStorage.setItem("activeRole", r);
      navigate(roleToPath(r), { replace: true });
    } else if (roleNames.length > 1 && !activeRole) {
      setNeedsRoleSelection(true);
    }
  }, [session]);


  // Keep localStorage in sync when the role changes
  useEffect(() => {
    if (activeRole) localStorage.setItem("activeRole", activeRole);
  }, [activeRole]);


  const roles = (session?.roles || []).map((r) => typeof r === "string" ? r : r.name);

  const confirmRole = (role) => {
    setActiveRole(role);
    localStorage.setItem("activeRole", role);
    setNeedsRoleSelection(false);
    navigate(roleToPath(role), { replace: true });
  };


  if (needsRoleSelection) {
    return (
      <div className="page">
        <RolePickerModal roles={roles} initial={roles[0]} onConfirm={confirmRole} />
      </div>
    );
  }

  return (
    <div className="page page-centered">
      <div className="card">
        <div className="card-body">Kraunama…</div>
      </div>
    </div>
  );
}







// -----------------------------------------------------------
// RoleRoute
// -----------------------------------------------------------
//
// Guard around a workspace subtree: logged out → back to "/",
// wrong ACTIVE role → the "Netinkama rolė" card. This is
// UI-level protection only — the backend enforces roles
// again via the session and X-Active-Role.
//
// Used by:
//   - RoutesRoot (below) — around each workspace layout
// -----------------------------------------------------------

function RoleRoute({ required, children }) {
  const { user } = useContext(AuthContext);
  const activeRole = localStorage.getItem("activeRole") || "";

  if (!user) return <Navigate to="/" replace />;
  if (required?.length && !required.includes(activeRole)) {
    return (
      <div className="page page-centered">
        <div className="card role-error">
          <h2 className="card-title">Netinkama rolė</h2>
          <div className="card-body">
            Dabartinė aktyvi rolė:{" "}
            <b>{activeRole || "(rolė nepasirinkta)"}</b>
          </div>
        </div>
      </div>
    );
  }
  return children;
}







// -----------------------------------------------------------
// RoutesRoot
// -----------------------------------------------------------
//
// Probes /api/session/check once on load, shows "Kraunama…"
// until it answers, then publishes the result through
// AuthContext and renders the route table: "/" (HomeGate),
// one guarded subtree per workspace, and a catch-all
// redirect.
//
// Used by:
//   - App (below)
// -----------------------------------------------------------

function RoutesRoot() {
  const [authState, setAuthState] = useState({ user: null, session: null, loading: true });


  // The one session probe — a 401 just means "not signed in"
  useEffect(() => {
    fetch("/api/session/check")
      .then((res) => {
        if (!res.ok) {
          setAuthState({ user: null, session: null, loading: false });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setAuthState({ user: data.user, session: data, loading: false });
      })
      .catch(() => setAuthState({ user: null, session: null, loading: false }));
  }, []);


  if (authState.loading) {
    return (
      <div className="page page-centered">
        <div className="card">
          <div className="card-body">Kraunama…</div>
        </div>
      </div>
    );
  }


  return (
    <AuthContext.Provider value={authState}>
      <Routes>
        <Route path="/" element={<HomeGate />} />

        <Route
          path="/manager"
          element={<RoleRoute required={["Vadybininkas"]}><ManagerLayout /></RoleRoute>}
        >
          <Route index element={<ManagerPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="review" element={<ManagerReviewPage />} />
          <Route path="export" element={<ManagerExportPage />} />
          <Route path="themes" element={<ThemesPage />} />
        </Route>

        <Route
          path="/committee"
          element={<RoleRoute required={["Komisijos narys"]}><CommitteeLayout /></RoleRoute>}
        >
          <Route index element={<CommitteePage />} />
          <Route path="evaluate" element={<EvaluatePage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="limits" element={<LimitsPage />} />
          <Route path="calculate" element={<CalculatePage />} />
        </Route>

        <Route
          path="/employee"
          element={<RoleRoute required={["Darbuotojas"]}><EmployeeLayout /></RoleRoute>}
        >
          <Route index element={<EmployeePage />} />
          <Route path="new" element={<NewActivity />} />
          <Route path="my" element={<MyActivities />} />
          <Route path="export" element={<ExportPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}







// -----------------------------------------------------------
// App (default export)
// -----------------------------------------------------------
//
// Just the BrowserRouter around RoutesRoot — the session
// probe and AuthContext live one level down.
//
// Used by:
//   - main.jsx
// -----------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <RoutesRoot />
    </BrowserRouter>
  );
}
