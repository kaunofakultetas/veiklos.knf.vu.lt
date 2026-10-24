// -----------------------------------------------------------
//  [*] Auth — the session cookie
//
//  The one cookie this app sets: the express-session id. Its
//  name carries the __Host- prefix, under which the browser
//  refuses any cookie of that name that is not Secure, not
//  scoped to Path=/ or that names a Domain — so no sibling
//  *.knf.vu.lt host can plant one for this host, ahead of the
//  real one. The session middleware sets it and logout clears
//  it, and a __Host- cookie is only cleared by a Set-Cookie
//  with the same attributes, which is why both read them
//  from here.
// -----------------------------------------------------------







// -----------------------------------------------------------
// SESSION_COOKIE
// -----------------------------------------------------------
//
// The cookie's name. Changing it signs everyone out once:
// browsers keep sending the old name, which no session
// answers to.
//
// Used by:
//   - index.js — the session middleware's cookie name
//   - routes/saml.js — endLocalSession, which clears it
// -----------------------------------------------------------

export const SESSION_COOKIE = "__Host-veiklos.sid";







// -----------------------------------------------------------
// SESSION_COOKIE_OPTIONS
// -----------------------------------------------------------
//
// The attributes it is set and cleared with: Secure and
// Path=/ with no Domain, as the prefix demands; HttpOnly, so
// no script reads it; SameSite=Lax, so the IdP's redirect
// back still carries it while a cross-site POST does not. No
// lifetime here — the session middleware adds its 8 hours,
// and a clear must not carry one.
//
// Used by:
//   - index.js — the session middleware's cookie
//   - routes/saml.js — endLocalSession, which clears it
// -----------------------------------------------------------

export const SESSION_COOKIE_OPTIONS = { path: "/", secure: true, httpOnly: true, sameSite: "lax" };
