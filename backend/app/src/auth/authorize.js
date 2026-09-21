// -----------------------------------------------------------
//  [*] Auth — role-based authorization guard
//
//  Factory for a middleware that passes when the caller OWNS
//  any of the required roles (req.user.roles, set by
//  attachRoles). Unlike requireActiveRoleIn it ignores the
//  X-Active-Role header — ownership is enough.
// -----------------------------------------------------------







// -----------------------------------------------------------
// authorize
// -----------------------------------------------------------
//
// authorize(["Vadybininkas"]) → middleware; an empty required
// list passes everyone through.
//
// Used by:
//   - routes/userRoles.js — the managerOnly guard (the router
//     is mounted behind verifySamlSession + attachRoles in
//     index.js, which is what fills req.user.roles)
// -----------------------------------------------------------

export function authorize(required = []) {
  return (req, res, next) => {
    if (!required.length) return next();
    const have = req.user?.roles || [];
    const ok = have.some(r => required.includes(r));
    if (!ok) return res.status(403).json({ error: "Forbidden: insufficient role" });
    next();
  };
}
