// -----------------------------------------------------------
//  [*] Manager — workspace layout
//
//  The /manager shell: AppHeader with the four nav links
//  (Rolių tvarkymas / Peržiūra / Eksportas / Temų tvarkymas),
//  the routed page in <Outlet />, and the footer.
// -----------------------------------------------------------

import { NavLink, Outlet } from "react-router-dom";
import AppHeader from "@/components/appHeader.jsx";
import "@/components/employee.css";







// -----------------------------------------------------------
// ManagerLayout (default export)
// -----------------------------------------------------------
//
// Wrapped in RoleRoute("Vadybininkas") by the router, so
// everything under it can assume the manager role is active.
//
// Used by:
//   - App.jsx — layout element of /manager
// -----------------------------------------------------------

export default function ManagerLayout() {
  return (
    <div className="employee-shell">
      <AppHeader>
        <NavLink to="/manager/roles" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Rolių tvarkymas
        </NavLink>
        <NavLink to="/manager/review" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Peržiūra
        </NavLink>
        <NavLink to="/manager/export" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Eksportas
        </NavLink>

        <NavLink to="/manager/themes" className={({ isActive }) =>
            "employee-nav-link" + (isActive ? " is-active" : "")
          }
        >
          Temų tvarkymas
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
