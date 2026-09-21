// -----------------------------------------------------------
//  [*] Committee — workspace layout
//
//  The /committee shell: AppHeader with the four nav links
//  (Įvertinti veiklas / Įvertinimai / Skaičiuoklė / Limitų
//  nustatymas), the routed page in <Outlet />, and the
//  footer.
// -----------------------------------------------------------

import { NavLink, Outlet } from "react-router-dom";
import AppHeader from "../../components/appHeader.jsx";
import "../../components/employee.css";







// -----------------------------------------------------------
// CommitteeLayout (default export)
// -----------------------------------------------------------
//
// Wrapped in RoleRoute("Komisijos narys") by the router, so
// everything under it can assume the committee role is
// active.
//
// Used by:
//   - App.jsx — layout element of /committee
// -----------------------------------------------------------

export default function CommitteeLayout() {
  return (
    <div className="employee-shell">
      <AppHeader>
        <NavLink to="/committee/evaluate" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Įvertinti veiklas
        </NavLink>
        <NavLink to="/committee/results" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Įvertinimai
        </NavLink>
        <NavLink  to="/committee/calculate" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Skaičiuoklė
        </NavLink>
        <NavLink to="/committee/limits" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Limitų nustatymas
        </NavLink>
      </AppHeader>

      <main className="employee-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          © {new Date().getFullYear()} Goda Stungurytė, ISKS'22. Visos teisės saugomos.
        </div>
      </footer>
    </div>
  );
}
