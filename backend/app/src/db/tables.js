// -----------------------------------------------------------
//  [*] DB — table name constants
//
//  Only users/roles/user_roles are named here — activities.js,
//  themes.js, userRoles.js and auth/attachRoles.js write the
//  same table names as plain SQL literals instead.
// -----------------------------------------------------------







// -----------------------------------------------------------
// TBL_USERS
// -----------------------------------------------------------
//
// The users table — one row per SSO account, keyed by eid.
//
// Used by:
//   - routes/users.js, routes/session.js, routes/saml.js
// -----------------------------------------------------------

export const TBL_USERS = 'users';







// -----------------------------------------------------------
// TBL_ROLES
// -----------------------------------------------------------
//
// The role catalog ("Darbuotojas", "Vadybininkas", "Komisijos
// narys") — looked up by name everywhere.
//
// Used by:
//   - routes/roles.js, routes/saml.js — the /assert auto-grant
// -----------------------------------------------------------

export const TBL_ROLES = 'roles';







// -----------------------------------------------------------
// TBL_USER_ROLES
// -----------------------------------------------------------
//
// The user↔role join table (user_eid, role_id).
//
// Used by:
//   - routes/roles.js, routes/saml.js — the /assert auto-grant
// -----------------------------------------------------------

export const TBL_USER_ROLES = 'user_roles';
