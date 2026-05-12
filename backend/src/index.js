import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import session from 'express-session';

import usersRouter from './routes/users.js';
import rolesRouter from './routes/roles.js';
import userRolesRouter from "./routes/userRoles.js";
import sessionRouter from './routes/session.js';
import themesRouter from "./routes/themes.js";
import activitiesRouter from "./routes/activities.js";
import { createSamlSetup } from './utils/saml.js';
import createSamlRouter from './routes/saml.js';

import { verifySamlSession } from './auth/verifySamlSession.js';
import { attachRoles } from './auth/attachRoles.js';

dotenv.config();

const APP_BASE_URL = process.env.APP_BASE_URL;
const app = express();
app.set('trust proxy', 1);

app.use((req, _res, next) => {
  console.log("BACKEND RECEIVED:", req.method, req.url);
  next();
});

app.use(cors());
app.use(express.json());

const uploadDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadDir));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(express.urlencoded({ extended: false }));
app.use(session({
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

const samlSetup = await createSamlSetup(APP_BASE_URL);
app.use('/auth/saml', createSamlRouter({ sp: samlSetup.sp, idp: samlSetup.idp }));

app.get("/api/me", verifySamlSession, attachRoles, (req, res) => {
  const { name, email, oid } = req.user;
  const roles = req.user.roles || [];
  res.json({ name, email, oid, roles });
});

app.use('/api/users', verifySamlSession, usersRouter);
app.use('/api/session', sessionRouter);
app.use('/api/roles', rolesRouter);
app.use("/api/user-roles", verifySamlSession, attachRoles, userRolesRouter);
app.use("/api/themes", themesRouter);
app.use("/api/activities", activitiesRouter);

const port = process.env.PORT || 4000;
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
