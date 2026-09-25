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
//  an express-session
//  cookie (secure, 8 h); verifySamlSession reads it back
//  and attachRoles loads the caller's DB roles. Booting BLOCKS on
//  loading the VU SSO IdP metadata (createSamlSetup) from
//  _SAML/ — no IdP metadata, no backend.
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
import { attachRoles } from './auth/attachRoles.js';


// dotenv only matters outside docker — in the container all
// config arrives as real environment variables
dotenv.config();

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
//   - nothing calls this at the moment (no healthcheck is
//     wired to it in docker-compose)
// -----------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true }));


// urlencoded parsing is for the SAML POST /assert callback;
// the session cookie is the whole auth state (8 hours,
// secure + httpOnly, sameSite lax so the IdP redirect back
// still carries it), the session itself lives in Postgres
// (db/sessionStore.js) so a restart signs nobody out
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new PgSessionStore({ pool }),
  secret: process.env.SESSION_SECRET ?? 'replace-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// Blocks until the IdP metadata is loaded (the VU SSO descriptor
// in _SAML/, or a URL) — the backend cannot
// boot without it
const samlSetup = await createSamlSetup();
console.log(`SAML IdP ${samlSetup.idpEntityId} from ${samlSetup.idpSource}; SP identity derived from the request host; SP cert SHA-256 ${samlSetup.spCertFingerprint}`);
app.use(SAML_BASE_PATH, createSamlRouter({ setup: samlSetup }));







// -----------------------------------------------------------
// GET /api/me
// -----------------------------------------------------------
//
// The caller's identity as the frontend sees it: name, email,
// eid and ALL roles they own (attachRoles also auto-grants
// "Darbuotojas" on the way). The frontend picks its active
// role from this list and sends it back as X-Active-Role.
//
// Used by:
//   - appHeader.jsx — role switcher in the top bar
//   - manager/roles.jsx — to guard the role admin page
// -----------------------------------------------------------

app.get("/api/me", verifySamlSession, attachRoles, (req, res) => {
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
// logged here and answered 500. Always JSON with an `error`
// like every route, never Express's default HTML page, which
// carries the stack trace outside NODE_ENV=production.
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
  console.error(`${req.method} ${req.url}:`, err);
  res.status(500).json({ error: "internal error" });
});


const port = process.env.PORT || 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
