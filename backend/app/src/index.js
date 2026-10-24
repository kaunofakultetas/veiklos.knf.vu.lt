// -----------------------------------------------------------
//  [*] Backend — API entry point
//
//  Boots the Express app and mounts every router. Listens on
//  $PORT (4000 in docker-compose); the vite SPA reaches it
//  through the Caddy ingress.
//
//  Endpoint index (each router documents its own routes):
//
//    GET  /api/health       — liveness probe, no auth
//    GET  /api/me           — caller's profile + ALL roles
//         /api/users        — routes/users.js
//         /api/session      — routes/session.js
//         /api/roles        — routes/roles.js
//         /api/user-roles   — routes/userRoles.js
//         /api/themes       — routes/themes.js
//         /api/activities   — routes/activities.js
//         /auth/saml        — routes/saml.js (login flow)
//
//  Auth model: the SAML /assert callback stores the login in
//  an express-session whose cookie (secure, 8 h, named with
//  the __Host- prefix — auth/sessionCookie.js) carries it;
//  verifySamlSession reads it back and attachRoles loads the
//  caller's DB roles. Booting BLOCKS on loading the VU SSO
//  IdP metadata (createSamlSetup) from _SAML/ — no IdP
//  metadata, no backend.
//
//  Uploaded attachments are NOT served as static files —
//  the only way to a file is GET /api/activities/:id/
//  attachment, which checks ownership/role first.
// -----------------------------------------------------------

import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';

// Routers, one per resource
import usersRouter from './routes/users.js';
import rolesRouter from './routes/roles.js';
import userRolesRouter from "./routes/userRoles.js";
import sessionRouter from './routes/session.js';
import themesRouter from "./routes/themes.js";
import activitiesRouter from "./routes/activities.js";
import { createSamlSetup, SAML_BASE_PATH } from './utils/saml.js';
import { createAccessLog } from './utils/accessLog.js';
import { pool } from './db/pool.js';
import { PgSessionStore } from './db/sessionStore.js';
import createSamlRouter from './routes/saml.js';

// Auth middleware
import { verifySamlSession } from './auth/verifySamlSession.js';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from './auth/sessionCookie.js';
import { attachRoles, attachRolesStrict } from './auth/attachRoles.js';


// dotenv only matters outside docker — in the container all
// config arrives as real environment variables
dotenv.config();

// The session cookie is signed with SESSION_SECRET. Without
// one — or with 'replace-me', once the built-in fallback and
// readable in the repository's history — anyone could sign a
// cookie for any session, so the backend refuses to boot,
// like it does without the IdP metadata
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'replace-me') {
  throw new Error('SESSION_SECRET is required: the key the session cookie is signed with (a long random string)');
}

const app = express();

// Behind the Caddy ingress — trust its X-Forwarded-* headers
// so secure cookies work over the proxied HTTPS
app.set('trust proxy', 1);


// Every request as one line in the access log — the path,
// never the query string (utils/accessLog.js) — in daily
// files under LOG_DIR (_LOGS/backend in compose) or on stdout
app.use(createAccessLog({ dir: process.env.LOG_DIR }));

app.use(express.json());







// -----------------------------------------------------------
// GET /api/health
// -----------------------------------------------------------
//
// Liveness probe — no auth, no DB touch, mounted before the
// session middleware.
//
// Used by:
//   - backend/Dockerfile — the HEALTHCHECK probes it every
//     30 seconds
// -----------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true }));


// Form-encoded bodies are parsed for the SAML routes ONLY —
// the IdP's POST to /assert is the one form this app takes.
// The cookie is SameSite=Lax, which every *.vu.lt page passes
// as the same site, so a form posted from any of them carries
// a signed-in user's session; the API routes that take no
// X-Active-Role header (the role admin) would accept it if
// forms were parsed there too. The session cookie is the
// whole auth state: 8 hours, secure + httpOnly, sameSite lax
// so the IdP redirect back still carries it, and a __Host-
// name no sibling host can plant (auth/sessionCookie.js).
// The session itself lives in Postgres (db/sessionStore.js),
// so a restart signs nobody out
app.use(SAML_BASE_PATH, express.urlencoded({ extended: false }));
app.use(session({
  store: new PgSessionStore({ pool }),
  name: SESSION_COOKIE,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// Blocks until the IdP metadata is loaded (the VU SSO descriptor
// in _SAML/, or a URL) — the backend cannot
// boot without it
const samlSetup = await createSamlSetup();
console.log(`SAML IdP ${samlSetup.idpEntityId} from ${samlSetup.idpSource}; SP identity derived from the request host; SP cert SHA-256 ${samlSetup.spCertFingerprint}; IdP metadata signature ${samlSetup.idpMetadataVerified ? "verified" : "not checked (local file)"}`);
app.use(SAML_BASE_PATH, createSamlRouter({ setup: samlSetup }));







// -----------------------------------------------------------
// GET /api/me
// -----------------------------------------------------------
//
// The caller's identity as the frontend sees it: name, email,
// eid and ALL roles they own (the role loader also
// auto-grants "Darbuotojas" on the way). The frontend picks
// its active role from this list and sends it back as
// X-Active-Role, so the strict loader answers a failed role
// lookup with 500 rather than an empty list.
//
// Used by:
//   - appHeader.jsx — role switcher in the top bar
//   - manager/roles.jsx — to guard the role admin page
// -----------------------------------------------------------

app.get("/api/me", verifySamlSession, attachRolesStrict, (req, res) => {
  const { name, email, eid } = req.user;
  const roles = req.user.roles || [];
  res.json({ name, email, eid, roles });
});


// Mount the routers. /api/users, /api/roles and
// /api/user-roles get session + roles here because their own
// managerOnly guards need req.user.roles filled
app.use('/api/users', verifySamlSession, attachRoles, usersRouter);
app.use('/api/session', sessionRouter);
app.use('/api/roles', verifySamlSession, attachRoles, rolesRouter);
app.use("/api/user-roles", verifySamlSession, attachRoles, userRolesRouter);
app.use("/api/themes", themesRouter);
app.use("/api/activities", activitiesRouter);







// -----------------------------------------------------------
// error handler
// -----------------------------------------------------------
//
// The last middleware — what a request gets when parsing or
// a handler throws. A malformed JSON body or one over the
// parser's limit is the caller's fault (400 / 413, the other
// body-parser errors keep their own 4xx); anything else is
// logged here and answered 500. The log line names the method
// and path only — the query string carries staff emails and
// SAML messages, which stay out of every log. Always JSON
// with an `error` like every route, never Express's default
// HTML page, which carries the stack trace outside
// NODE_ENV=production.
//
// Used by:
//   - express — registered after every route, so it catches
//     errors from all of them
// -----------------------------------------------------------

// eslint-disable-next-line no-unused-vars -- express picks the handler by its 4-arg signature
app.use((err, req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Neteisingas užklausos formatas" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Užklausa per didelė" });
  }
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: "Neteisinga užklausa" });
  }
  console.error(`${req.method} ${req.originalUrl.split("?")[0]}:`, err);
  res.status(500).json({ error: "internal error" });
});


const port = process.env.PORT || 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
