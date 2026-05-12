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
