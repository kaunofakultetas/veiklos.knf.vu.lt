// -----------------------------------------------------------
//  [*] Auth — Microsoft Entra JWT verification
//
//  Validates the "Authorization: Bearer <token>" header
//  against the tenant's published signing keys (JWKS).
//  Signing keys are fetched from login.microsoftonline.com
//  and cached for 10 minutes.
//
//  Gotcha: ISSUER / CLIENT_ID / TENANT_ID are read at import
//  time — BEFORE index.js gets to its dotenv.config() call.
//  This works in the container because docker-compose passes
//  them as real environment variables; with only a .env file
//  they would all be undefined and every token would fail.
// -----------------------------------------------------------

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';


const ISSUER = process.env.ISSUER;
const CLIENT_ID = process.env.CLIENT_ID;
const TENANT_ID = process.env.TENANT_ID;

// JWKS client with a small cache so we don't hit Microsoft
// on every request
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
});







// -----------------------------------------------------------
// getKey
// -----------------------------------------------------------
//
// jsonwebtoken key resolver: looks up the public key matching
// the token header's `kid` via the JWKS client above.
//
// Used by:
//   - verifyJwt (below) — passed straight into jwt.verify
// -----------------------------------------------------------

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}







// -----------------------------------------------------------
// verifyJwt
// -----------------------------------------------------------
//
// Express middleware: 401 when the Bearer token is missing or
// invalid, 403 when it belongs to a foreign tenant. On
// success the decoded payload lands on req.user (oid, name,
// preferred_username, ...) for the rest of the chain.
//
// Used by:
//   - nothing calls this since the VU SSO (SAML) migration —
//     every guard now uses auth/verifySamlSession.js instead;
//     kept as the Microsoft-era verifier
// -----------------------------------------------------------

export function verifyJwt(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['RS256'],
      audience: CLIENT_ID,
      issuer: ISSUER,
    },
    (err, payload) => {
      if (err) {
        console.error('JWT verify error:', err);
        return res.status(401).json({ error: 'Invalid token', details: err.message });
      }
      if (payload.tid && payload.tid !== TENANT_ID) {
        return res.status(403).json({ error: 'Forbidden: wrong tenant' });
      }
      req.user = payload;
      next();
    }
  );
}
