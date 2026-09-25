// -----------------------------------------------------------
//  [*] Committee — workspace home
//
//  The static welcome card at /committee: what the committee
//  member can do here and the support email. No data
//  fetching.
// -----------------------------------------------------------

import "@/components/employee.css";







// -----------------------------------------------------------
// CommitteePage (default export)
// -----------------------------------------------------------
//
// Pure static content — the real functionality lives in the
// nav pages (evaluate / results / calculate / limits).
//
// Used by:
//   - App.jsx — index route of /committee
// -----------------------------------------------------------

export default function CommitteePage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Komisijos nario langas</h1>
        </div>
      </header>

      <main className="page-content">
        <section className="card employee-card">
          <div className="card-body">
            <h2>Šiame darbalaukyje galėsite:</h2>
            <ul style={{ paddingLeft: "1.25rem", marginBottom: "1.5rem" }}>
              <li>Įvertinti veiklas, kurios buvo patvirtintos vadybininko.</li>
              <li>Peržiūrėti įvertintas veiklas ir pakoreguoti įvertinimą esant reikalui.</li>
              <li>Suskaičiuoti kiekvienos temos balo vertę ir įvertinti darbuotojus.</li>
              <li>Nustatyti limitus temom ir potemėm.</li>
            </ul>

            <div>
              <div className="info-box">
                <span> Susidūrus su techninėmis kliūtimis parašykite el. laišką adresu:</span>
                <br />
                <a href="mailto:info@knf.vu.lt" style={{ fontWeight: 600 }}>
                info@knf.vu.lt
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
