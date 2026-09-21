// -----------------------------------------------------------
//  [*] Employee — workspace home
//
//  The static welcome card at /employee: what the employee
//  can do here and the support email. No data fetching.
// -----------------------------------------------------------

import "../../components/employee.css";







// -----------------------------------------------------------
// EmployeePage (default export)
// -----------------------------------------------------------
//
// Pure static content — the real functionality lives in the
// nav pages (new / my / export).
//
// Used by:
//   - App.jsx — index route of /employee
// -----------------------------------------------------------

export default function EmployeePage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Darbuotojo langas</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card employee-card">
          <div className="card-body">
            <h2>Šiame darbalaukyje galėsite:</h2>
            <ul style={{ paddingLeft: "1.25rem", marginBottom: "1.5rem" }}>
              <li>Užregistruoti veiklas, skirtas studijų kokybei gerinti.</li>
              <li>Peržiūrėti visas užregistruotas veiklas ir jų būsenas.</li>
              <li>Filtruoti savo veiklas ir eksportuoti jas į Excel dokumentą.</li>
            </ul>

            <div>
              <div className="info-box">
                <span> Susidūrus su techninėmis kliūtimis parašykite el. laišką adresu:</span>
                <br />
                <a href="mailto:vu.veiklu.registravimas@gmail.com" style={{ fontWeight: 600 }}>
                  vu.veiklu.registravimas@gmail.com
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
