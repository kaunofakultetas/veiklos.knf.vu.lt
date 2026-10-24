// -----------------------------------------------------------
//  [*] Components — the active role, one per browser tab
//
//  The role a page works in: the workspace RoleRoute lets it
//  into, and the X-Active-Role header every request carries.
//  Each browser tab keeps its own copy in sessionStorage, so
//  switching the role in one tab leaves every other open tab
//  working in the role it had — they would otherwise read the
//  new role on their next request and be refused. The copy in
//  localStorage only remembers the last choice made in any
//  tab: a tab opened later starts from it and from then on
//  keeps its own. Plain .js on purpose: a .jsx module that
//  exports functions trips the react-refresh lint rule.
// -----------------------------------------------------------


// The key both storages keep the role under
const KEY = "activeRole";







// -----------------------------------------------------------
// getActiveRole
// -----------------------------------------------------------
//
// This tab's role; a tab without one yet takes the last role
// chosen in any tab and keeps it as its own from then on.
// Empty when no role was ever chosen.
//
// Used by:
//   - App.jsx — HomeGate, Profile, RoleRoute
//   - components/appHeader.jsx — the role switcher
//   - components/api.js — the X-Active-Role header every
//     request carries
// -----------------------------------------------------------

export function getActiveRole() {
  const own = sessionStorage.getItem(KEY);
  if (own) return own;
  const last = localStorage.getItem(KEY) || "";
  if (last) sessionStorage.setItem(KEY, last);
  return last;
}







// -----------------------------------------------------------
// setActiveRole
// -----------------------------------------------------------
//
// Makes `role` this tab's role and the one tabs opened later
// start from; tabs already open keep theirs.
//
// Used by:
//   - App.jsx — HomeGate, replacing a stored role the
//     session does not own; Profile, when a role is picked
//     or the only one picks itself
//   - components/appHeader.jsx — a switch, and the repair of
//     a role the caller no longer owns
// -----------------------------------------------------------

export function setActiveRole(role) {
  sessionStorage.setItem(KEY, role);
  localStorage.setItem(KEY, role);
}







// -----------------------------------------------------------
// clearActiveRole
// -----------------------------------------------------------
//
// Forgets the role in this tab and for tabs opened later —
// on sign-out, and when the caller owns no role at all.
//
// Used by:
//   - App.jsx — HomeGate, when the session owns no role
//   - components/appHeader.jsx — sign-out and the no-roles
//     answer
// -----------------------------------------------------------

export function clearActiveRole() {
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
}
