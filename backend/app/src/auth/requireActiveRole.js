// -----------------------------------------------------------
//  [*] Auth — active-role guard
//
//  The frontend lets a user with several roles pick which one
//  they are acting as; that choice travels in the
//  X-Active-Role request header. This guard enforces it:
//  the header must be present, the caller must actually own
//  that role, and the role must be one the endpoint allows.
// -----------------------------------------------------------







// -----------------------------------------------------------
// requireActiveRoleIn
// -----------------------------------------------------------
//
// requireActiveRoleIn(["Vadybininkas"]) → middleware. Expects
// verifySamlSession + attachRoles to have run first. On
// success the chosen role is exposed as req.user.activeRole
// (no route reads it at the moment).
//
// Used by:
//   - routes/activities.js — guard / managerGuard /
//     committeeGuard arrays
//   - routes/themes.js — manageGuard / committeeGuard arrays
// -----------------------------------------------------------

export function requireActiveRoleIn(required = []) {
  return (req, res, next) => {
    const active = req.get("X-Active-Role");
    const owned = req.user?.roles || [];

    if (!active) {
      return res.status(400).json({ error: "Active role header (X-Active-Role) is required" });
    }
    if (!owned.includes(active)) {
      return res.status(403).json({ error: "Forbidden: you don't have the selected role" });
    }
    if (required.length && !required.includes(active)) {
      return res.status(403).json({ error: "Forbidden: selected role not allowed for this endpoint" });
    }

    req.user.activeRole = active;
    next();
  };
}
