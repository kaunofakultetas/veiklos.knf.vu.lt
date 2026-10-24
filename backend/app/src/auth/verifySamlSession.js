// -----------------------------------------------------------
//  [*] Auth — SAML session gate
//
//  The live authentication check since the VU SSO (SAML)
//  migration: the SAML /assert callback stored the IdP's
//  attributes in the express-session cookie, and this
//  middleware turns them back into req.user on every request.
//  No tokens, no headers — just the session cookie.
// -----------------------------------------------------------

import { mapSamlAttributes } from "../utils/saml.js";
import { SESSION_MAX_AGE_MS } from "./sessionCookie.js";







// -----------------------------------------------------------
// verifySamlSession
// -----------------------------------------------------------
//
// 401 Neprisijungta when the session has no SAML login, or
// when its sign-in is SESSION_MAX_AGE_MS old (or carries no
// sign-in time) — that session is destroyed, so a copied
// cookie stops working on the server too, however often it
// is used. Otherwise req.user = { eid, email, name } mapped
// from the raw IdP attributes by mapSamlAttributes — eid is
// VU's eID; name is firstName + lastName with missing parts
// dropped, "" when both are missing.
//
// Used by:
//   - index.js — /api/me, the /api/users and /api/user-roles
//     mounts
//   - guard arrays in routes/activities.js, routes/themes.js
//   - routes/roles.js, routes/session.js — per route
// -----------------------------------------------------------

export function verifySamlSession(req, res, next) {
  const samlUser = req.session?.samlUser;
  if (!samlUser) return res.status(401).json({ error: 'Neprisijungta' });

  const age = Date.now() - samlUser.signedInAt;
  if (!(typeof samlUser.signedInAt === 'number' && age < SESSION_MAX_AGE_MS)) {
    req.session.destroy?.(() => {});
    return res.status(401).json({ error: 'Neprisijungta' });
  }

  const { eid, email, name } = mapSamlAttributes(samlUser.attributes);
  req.user = {
    eid,
    email,
    name: name ?? '',
  };
  next();
}
