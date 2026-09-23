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







// -----------------------------------------------------------
// verifySamlSession
// -----------------------------------------------------------
//
// 401 Neprisijungta when the session has no SAML login;
// otherwise req.user = { oid, email, name }: email and name
// mapped from the raw IdP attributes by mapSamlAttributes
// (VU SSO's OIDs or their friendly names alike; name is
// firstName + lastName with missing parts dropped, "" when
// both are missing), oid preferably the account key /assert
// resolved and stored (it may differ from the attributes'
// identifier when an existing account was adopted by email),
// falling back to the mapped identifier.
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
  const { oid: attrOid, email, name } = mapSamlAttributes(samlUser.attributes);
  req.user = {
    oid: samlUser.oid ?? attrOid,
    email,
    name: name ?? '',
  };
  next();
}
