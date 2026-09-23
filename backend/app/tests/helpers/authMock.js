// -----------------------------------------------------------
//  [*] Test helpers — mocked authentication
//
//  Importing this module replaces src/auth/verifySamlSession.js
//  and src/auth/attachRoles.js (via node:test module mocks, so
//  it MUST be imported before any router is dynamically
//  imported). verifySamlSession normally reads the SAML login
//  from the express-session cookie — unavailable in tests — so
//  the mock authenticates whatever identity the test put into
//  `identity.user` and answers the real middleware's 401
//  ("Neprisijungta") when there is none.
//
//  attachRoles is mocked too so route tests don't have to
//  script its three DB queries per request; the REAL
//  attachRoles is unit-tested in auth.test.js.
//  requireActiveRoleIn and authorize stay real everywhere —
//  they are pure.
// -----------------------------------------------------------

import { mock } from "node:test";


// The fake caller; null means "no SAML session cookie"
export const identity = { user: null };


mock.module(new URL("../../src/auth/verifySamlSession.js", import.meta.url).href, {
  namedExports: {
    verifySamlSession(req, res, next) {
      if (!identity.user) {
        return res.status(401).json({ error: "Neprisijungta" });
      }
      req.user = { ...identity.user };
      next();
    },
  },
});

mock.module(new URL("../../src/auth/attachRoles.js", import.meta.url).href, {
  namedExports: {
    async attachRoles(req, res, next) {
      req.user.roles = [...(identity.user?.roles || [])];
      next();
    },
  },
});







// -----------------------------------------------------------
// signInAs
// -----------------------------------------------------------
//
// signInAs("eid-1", ["Darbuotojas"], { name: "J" }) — the
// extra fields merge into req.user like the real middleware's
// eid/email/name mapping from SAML attributes.
//
// Used by:
//   - every *.routes.test.js file
// -----------------------------------------------------------

export function signInAs(eid, roles = [], extra = {}) {
  identity.user = { eid, roles, ...extra };
}







// -----------------------------------------------------------
// signOut
// -----------------------------------------------------------
//
// Back to anonymous — the mocked verifySamlSession then 401s.
//
// Used by:
//   - every *.routes.test.js file (beforeEach)
// -----------------------------------------------------------

export function signOut() {
  identity.user = null;
}
