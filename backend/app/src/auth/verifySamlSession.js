// -----------------------------------------------------------
//  [*] Auth — SAML session gate
//
//  The live authentication check since the Keycloak/SAML
//  migration: the SAML /assert callback stored the IdP's
//  attributes in the express-session cookie, and this
//  middleware turns them back into req.user on every request.
//  No tokens, no headers — just the session cookie.
// -----------------------------------------------------------







// -----------------------------------------------------------
// verifySamlSession
// -----------------------------------------------------------
//
// 401 Neprisijungta when the session has no SAML login;
// otherwise req.user = { oid, email, name } mapped from the
// IdP attributes (preferred_username beats email, the name is
// firstName + lastName with missing parts dropped).
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
  const attrs = samlUser.attributes;
  req.user = {
    oid:   attrs.oid,
    email: attrs.preferred_username || attrs.email,
    name:  [attrs.firstName, attrs.lastName].filter(Boolean).join(' '),
  };
  next();
}
