// -----------------------------------------------------------
//  [*] SessionExpired — the notice for a session that ended
//
//  Eight hours after sign-in the session cookie is gone and
//  every API call answers 401 Neprisijungta. A page shows
//  that like any other error, which leaves a failed action
//  and no way back but a reload — and a reload throws away
//  whatever was typed. While the app is signed in this
//  component watches every API answer; on a 401 it explains
//  what happened and offers a fresh sign-in in a NEW tab, so
//  this tab keeps its page and its unsent form: sign in
//  there, come back, repeat the action. The notice can be
//  dismissed and returns on the next 401.
//
//  Split into (root component last):
//
//    isApiRequest   — whether a fetch went to the backend API
//    SessionExpired — the watcher and the notice (default
//                     export)
// -----------------------------------------------------------

import { useEffect, useState } from "react";







// -----------------------------------------------------------
// isApiRequest
// -----------------------------------------------------------
//
// Whether a fetch went to the backend's /api routes — a 401
// anywhere else (the SAML routes, another host) says nothing
// about this session. fetch takes a path, a URL or a Request.
//
// Used by:
//   - SessionExpired (below) — the fetch watcher
// -----------------------------------------------------------

function isApiRequest(input) {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  return new URL(url, window.location.origin).pathname.startsWith("/api/");
}







// -----------------------------------------------------------
// SessionExpired (default export)
// -----------------------------------------------------------
//
// Wraps window.fetch for as long as it is mounted, passing
// every answer through untouched and raising the notice on
// an API 401. Mounted only while signed in, before the
// routes, so the pages' first requests already go through
// the watcher; unmounting puts the plain fetch back.
//
// Used by:
//   - App.jsx — RoutesRoot, while a user is signed in
// -----------------------------------------------------------

export default function SessionExpired() {
  const [expired, setExpired] = useState(false);


  useEffect(() => {
    const plainFetch = window.fetch;
    window.fetch = async (input, init) => {
      const res = await plainFetch.call(window, input, init);
      if (res.status === 401 && isApiRequest(input)) setExpired(true);
      return res;
    };
    return () => {
      window.fetch = plainFetch;
    };
  }, []);


  if (!expired) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
        <h2 id="session-expired-title" className="modal-title">Prisijungimo sesija baigėsi</h2>
        <p className="modal-text">
          Jūsų prisijungimas nebegalioja, todėl paskutinis veiksmas neįvyko.
          Prisijunkite iš naujo naujame skirtuke — šiame lange įvesti duomenys
          išliks. Prisijungę grįžkite čia ir pakartokite veiksmą.
        </p>
        <div className="modal-actions">
          <a
            href="/auth/saml/login"
            target="_blank"
            rel="noopener"
            className="btn btn-primary"
          >
            Prisijungti naujame skirtuke
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => setExpired(false)}>
            Uždaryti
          </button>
        </div>
      </div>
    </div>
  );
}
