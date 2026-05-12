import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import vuLogo from "../assets/VU.png";
import "./appHeader.css";

const roleToPath = (role) => {
  switch (role) {
    case "Vadybininkas": return "/manager";
    case "Komisijos narys": return "/committee";
    case "Darbuotojas": return "/employee";
    default: return "/";
  }
};

export default function AppHeader({ children }) {
  const navigate = useNavigate();

  const [roles, setRoles] = useState([]);
  const [activeRole, setActiveRole] = useState(
    () => localStorage.getItem("activeRole") || ""
  );
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    const loadMe = async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return;
        const data = await res.json();

        const names = (data.roles || []).map((r) =>
          typeof r === "string" ? r : r.name
        );

        setRoles(names);
        setFullName(data.name || "");

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
        // ignore
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

  const signOut = () => {
    localStorage.removeItem("activeRole");
    window.location.href = "/auth/saml/logout";
  };

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
              {activeRole || (roles.length === 0 ? "Kraunama…" : "(nėra)")}
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
