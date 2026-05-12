import { useEffect, useState, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import "./components/appLayout.css";
import vuLogo from "./assets/VU logo.png";

// manager pages
import ManagerPage from "./pages/manager/index.jsx";
import ManagerLayout from "./pages/manager/layout.jsx";
import RolesPage from "./pages/manager/roles.jsx";
import ManagerReviewPage from "./pages/manager/review.jsx";
import ManagerExportPage from "./pages/manager/export.jsx";
import ThemesPage from "./pages/manager/themes.jsx";

// employee pages
import EmployeePage from "./pages/employee/index.jsx";
import EmployeeLayout from "./pages/employee/layout.jsx";
import NewActivity from "./pages/employee/newActivity.jsx";
import MyActivities from "./pages/employee/myActivities.jsx";
import ExportPage from "./pages/employee/export.jsx";

// committee pages
import CommitteePage from "./pages/committee/index.jsx";
import CommitteeLayout from "./pages/committee/layout.jsx";
import EvaluatePage from "./pages/committee/evaluate.jsx";
import ResultsPage from "./pages/committee/results.jsx";
import LimitsPage from "./pages/committee/limits.jsx";
import CalculatePage from "./pages/committee/calculate.jsx";

export const AuthContext = createContext(null);

const roleToPath = (role) => {
  switch (role) {
    case "Vadybininkas":    return "/manager";
    case "Komisijos narys": return "/committee";
    case "Darbuotojas":    return "/employee";
    default:               return "/";
  }
};

function SignIn() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img
          src={vuLogo}
          alt="Vilniaus universiteto logotipas"
          className="auth-logo"
        />
        <h1 className="auth-title">Bendro prisijungimo sistema</h1>
        <p className="auth-subtitle">
          Paslaugai reikalingas Jūsų tapatybės patvirtinimas.
        </p>
        <button
          onClick={() => { window.location.href = "/auth/saml/login"; }}
          className="btn btn-primary auth-button"
        >
          Prisijungti
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

function HomeGate() {
  const { user } = useContext(AuthContext);
  const activeRole = localStorage.getItem("activeRole") || "";

  if (!user) return <SignIn />;
  if (activeRole) return <Navigate to={roleToPath(activeRole)} replace />;
  return <Profile />;
}

function Profile() {
  const { session } = useContext(AuthContext);
  const navigate = useNavigate();

  const [activeRole, setActiveRole] = useState(() => localStorage.getItem("activeRole") || "");
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);

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

function RoutesRoot() {
  const [authState, setAuthState] = useState({ user: null, session: null, loading: true });

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

export default function App() {
  return (
    <BrowserRouter>
      <RoutesRoot />
    </BrowserRouter>
  );
}
