// -----------------------------------------------------------
//  [*] App — routing and sign-in flow
//
//  The SPA's root: VU SSO (SAML) sign-in, the role-based
//  route tree, and the first-visit flow that picks the active
//  role.
//
//  Auth is a session cookie. On load RoutesRoot probes
//  GET /api/session/check once and publishes the result
//  through AuthContext ({ user, session, loading }); signing
//  in is a full-page redirect to /auth/saml/login, so the SPA
//  never handles tokens itself. Only a 401 means signed out:
//  any other refusal of the probe (the backend's 500, the
//  ingress's 502 while the backend restarts) shows an error
//  instead of a sign-in that would only lead back to it.
//
//  The active role is the app's central switch. It belongs to
//  the browser tab (components/activeRole.js — a role
//  switched in one tab leaves the others alone), gates every
//  /manager, /committee and /employee route (RoleRoute), and
//  the pages send it to the backend as the X-Active-Role
//  header. "/" never enters a workspace the session does not
//  own: a stored role the session lacks gives way to the
//  first role it has, as the header's repair does.
//
//  While signed in, SessionExpired watches the API answers: a
//  session that ends mid-work (a 401) gets a notice offering
//  a fresh sign-in in a new tab instead of a page that only
//  fails.
//
//  Split into (root component last):
//
//    AuthContext     — the session state for the whole tree
//    roleToPath      — role name → workspace path
//    roleNamesOf     — the session's roles as plain names
//    SignIn          — the "Prisijungti" card
//    RolePickerModal — role choice for multi-role users
//    HomeGate        — "/" — sign-in / redirect / profile
//    Profile         — role selection after sign-in
//    RoleRoute       — guard for a workspace subtree
//    RoutesRoot      — session probe + the <Routes> table
//    App             — BrowserRouter + error boundary around
//                      RoutesRoot (default export)
// -----------------------------------------------------------

import { useEffect, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import AppErrorBoundary from "./components/appErrorBoundary.jsx";
import SessionExpired from "./components/sessionExpired.jsx";
import { clearActiveRole, getActiveRole, setActiveRole as storeActiveRole } from "./components/activeRole.js";
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

const AuthContext = createContext(null);







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
// roleNamesOf
// -----------------------------------------------------------
//
// The roles of the probe's session as plain names. The probe
// sends { name } objects, plain strings are tolerated too;
// no session, or one without a roles list, owns none.
//
// Used by:
//   - HomeGate, Profile (below)
// -----------------------------------------------------------

const roleNamesOf = (session) =>
  (session?.roles || []).map((r) => typeof r === "string" ? r : r.name);







// -----------------------------------------------------------
// SignIn
// -----------------------------------------------------------
//
// The unauthenticated landing card: VU logo + a button that
// hard-navigates to /auth/saml/login, where the backend
// bounces the browser to VU SSO (sso.vu.lt).
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
          © {new Date().getFullYear()} Goda Stungurytė, ISKS'22. Visos teisės saugomos.
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
// the app. The dropdown is named by the "Pasirinkite rolę"
// caption above it, so a screen reader says what it chooses.
//
// Used by:
//   - Profile (below)
// -----------------------------------------------------------

function RolePickerModal({ roles, initial, onConfirm }) {
  const [sel, setSel] = useState(initial || roles[0] || "");

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal-title" id="role-picker-title">Pasirinkite rolę</h2>
        <p className="modal-text">
          Pasirinkite rolę, su kuria tęsite veiklą sistemoje.
        </p>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="field-select modal-select"
          aria-labelledby="role-picker-title"
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
// Profile to pick a role. The stored role is checked against
// the session's roles first, as the header's repair checks it
// against /api/me: one the session does not own — revoked
// since it was stored, or left behind by an earlier user of
// the same browser — would open a workspace whose every
// action the backend refuses. The first owned role takes its
// place, and with no role owned at all it is dropped, which
// leaves Profile to say so.
//
// Used by:
//   - RoutesRoot (below) — route "/"
// -----------------------------------------------------------

function HomeGate() {
  const { user, session } = useContext(AuthContext);

  if (!user) return <SignIn />;


  // Repaired before the redirect below reads it; storing the
  // same role again on a second render changes nothing
  const owned = roleNamesOf(session);
  const stored = getActiveRole();
  if (stored && !owned.includes(stored)) {
    if (owned.length) storeActiveRole(owned[0]);
    else clearActiveRole();
  }


  const activeRole = getActiveRole();
  if (activeRole) return <Navigate to={roleToPath(activeRole)} replace />;
  return <Profile />;
}







// -----------------------------------------------------------
// Profile
// -----------------------------------------------------------
//
// The post-sign-in role flow, driven by the session from
// AuthContext: exactly one role → auto-select and navigate;
// several → RolePickerModal; none → a card saying so (every
// login is granted Darbuotojas, so this means the role
// catalog is broken). "Kraunama…" only while a branch is
// about to fire.
//
// Used by:
//   - HomeGate (below)
// -----------------------------------------------------------

function Profile() {
  const { session } = useContext(AuthContext);
  const navigate = useNavigate();

  const [activeRole, setActiveRole] = useState(() => getActiveRole());
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);


  // One role picks itself; several open the picker.
  // activeRole is a dependency on purpose: once a role is
  // set, neither branch fires again
  useEffect(() => {
    if (!session) return;
    const roleNames = roleNamesOf(session);

    if (roleNames.length === 1 && !activeRole) {
      const r = roleNames[0];
      setActiveRole(r);
      storeActiveRole(r);
      navigate(roleToPath(r), { replace: true });
    } else if (roleNames.length > 1 && !activeRole) {
      setNeedsRoleSelection(true);
    }
  }, [session, activeRole, navigate]);


  // Keep the stored role in step when the role changes
  useEffect(() => {
    if (activeRole) storeActiveRole(activeRole);
  }, [activeRole]);


  const roles = roleNamesOf(session);

  const confirmRole = (role) => {
    setActiveRole(role);
    storeActiveRole(role);
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

  if (session && roles.length === 0) {
    return (
      <div className="page page-centered">
        <div className="card">
          <div className="card-body">
            <h2>Jūsų paskyrai nepriskirta jokia rolė.</h2>
            <p>
              Prisijungimas pavyko, bet sistemoje neturite nė vienos rolės. Kreipkitės
              adresu <a href="mailto:info@knf.vu.lt">info@knf.vu.lt</a>.
            </p>
          </div>
        </div>
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
// wrong ACTIVE role (this tab's) → the "Netinkama rolė" card.
// The card stands alone, without the header, so it carries
// its own way out: a link to "/", which sends the tab on to
// its own role's workspace, or to the role choice. This is
// UI-level protection only — the backend enforces roles
// again via the session and X-Active-Role.
//
// Used by:
//   - RoutesRoot (below) — around each workspace layout
// -----------------------------------------------------------

function RoleRoute({ required, children }) {
  const { user } = useContext(AuthContext);
  const activeRole = getActiveRole();

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
          <div className="card-body">
            <Link to="/">Grįžti į pradžią</Link>
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
// redirect — with SessionExpired watching while signed in.
// A probe refused for any reason but a 401 leaves the
// session's state unknown, so the page says the check failed
// instead of offering the sign-in or a workspace.
//
// Used by:
//   - App (below)
// -----------------------------------------------------------

function RoutesRoot() {
  const [authState, setAuthState] = useState({ user: null, session: null, loading: true });
  const [probeRefused, setProbeRefused] = useState(false);


  // The one session probe. A 401 just means "not signed in",
  // and so does a fetch that fails outright; any other
  // refusal is an outage, and a sign-in then would only land
  // back on the same refusal
  useEffect(() => {
    fetch("/api/session/check")
      .then((res) => {
        if (!res.ok) {
          setProbeRefused(res.status !== 401);
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

  if (probeRefused) {
    return (
      <div className="page page-centered">
        <div className="card">
          <div className="card-body">Klaida: nepavyko patikrinti prisijungimo. Pabandykite vėliau.</div>
        </div>
      </div>
    );
  }


  return (
    <AuthContext.Provider value={authState}>
      {/* Before the routes on purpose: its fetch watcher is
          in place before the pages' first requests */}
      {authState.user && <SessionExpired />}

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
// The BrowserRouter and the error boundary around RoutesRoot
// — the session probe and AuthContext live one level down. A
// render that throws anywhere in the tree ends in the
// boundary's card, not a blank window.
//
// Used by:
//   - main.jsx
// -----------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <RoutesRoot />
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
