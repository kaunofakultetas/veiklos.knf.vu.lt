// -----------------------------------------------------------
//  [*] Employee — workspace layout
//
//  The /employee shell: AppHeader with the three nav links
//  (Nauja veikla / Mano veiklos / Eksportas), the routed page
//  in <Outlet />, and the footer.
// -----------------------------------------------------------

import { NavLink, Outlet } from "react-router-dom";
import AppHeader from "../../components/appHeader.jsx";
import "../../components/employee.css";







// -----------------------------------------------------------
// EmployeeLayout (default export)
// -----------------------------------------------------------
//
// Wrapped in RoleRoute("Darbuotojas") by the router, so
// everything under it can assume the employee role is active.
//
// Used by:
//   - App.jsx — layout element of /employee
// -----------------------------------------------------------

export default function EmployeeLayout() {
  return (
    <div className="employee-shell">
      <AppHeader>
        <NavLink to="/employee/new" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Nauja veikla
        </NavLink>
        <NavLink to="/employee/my" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Mano veiklos
        </NavLink>
        <NavLink to="/employee/export" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Eksportas
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
