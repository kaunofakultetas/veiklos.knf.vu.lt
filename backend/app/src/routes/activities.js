// -----------------------------------------------------------
//  [*] Routes — /api/activities
//
//    POST   /api/activities                  — create           (employee)
//    GET    /api/activities/my               — own activities   (employee)
//    GET    /api/activities/all              — every activity   (manager)
//    GET    /api/activities/committee        — PATVIRTINTA list (committee)
//    GET    /api/activities/evaluated        — ĮVERTINTA list   (committee)
//    GET    /api/activities/evaluated/theme-totals
//                                            — score sums per theme
//    GET    /api/activities/evaluated/employees
//                                            — who has evaluated work
//    GET    /api/activities/evaluated/employee/:oid/subthemes
//                                            — one employee's per-subtheme sums
//    GET    /api/activities/pending          — PATEIKTA queue   (manager)
//    PATCH  /api/activities/:id/manager      — approve/deny/return
//    PATCH  /api/activities/:id/committee    — score/return
//    GET    /api/activities/:id/attachment   — download attachment
//    PATCH  /api/activities/:id              — employee edit
//    DELETE /api/activities/:id              — employee delete
//    POST   /api/activities/:id/resubmit     — resubmit TIKSLINTI
//
//  The core of the system: an activity walks the status
//  chain PATEIKTA → (manager) PATVIRTINTA / ATMESTA /
//  TIKSLINTI → (committee) ĮVERTINTA, and the committee can
//  push it back to PATEIKTA. Status values are Lithuanian
//  UPPERCASE strings compared verbatim in SQL — including
//  the Į in ĮVERTINTA.
//
//  Route order matters here: the literal GET paths (/my,
//  /all, /committee, /evaluated...) are registered before the
//  ":id" patterns, so Express never swallows them as ids.
//
//  Attachments are stored on disk under uploads/ with a
//  sanitized theme-subtheme-user-timestamp name; the original
//  name survives in attachment_original_name for downloads.
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { attachRoles } from "../auth/attachRoles.js";
import { sendRejectionEmail } from "./emailService.js";
import { sendReturnEmail } from "./emailService.js";
import { requireActiveRoleIn } from "../auth/requireActiveRole.js";
import multer from "multer";
import path from "path";
import fs from "fs";


const router = Router();

// The docker volume mounts ./_DATA/uploads here; created on
// boot for the no-volume dev case
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}







// -----------------------------------------------------------
// loadUserFullName
// -----------------------------------------------------------
//
// Middleware that resolves the caller's full name from the DB
// so multer's filename callback (which runs before any route
// code) can prefix uploads with it. Falls back to
// "unknown_user" for users somehow missing from the table.
//
// Used by:
//   - POST  /api/activities (below)
//   - PATCH /api/activities/:id (below)
// -----------------------------------------------------------

async function loadUserFullName(req, res, next) {
  try {
    const oid = req.user?.oid || req.user?.sub;
    if (!oid) {
      return res.status(400).json({ error: "Klaida: Trūksta vartotojo OID" });
    }

    const { rows } = await pool.query(
      "SELECT full_name FROM users WHERE oid = $1 LIMIT 1",
      [oid]
    );

    req.userFullName = rows[0]?.full_name || "unknown_user";
    next();
  } catch (e) {
    console.error("loadUserFullName error:", e);
    next(e);
  }
}







// -----------------------------------------------------------
// cleanSegment
// -----------------------------------------------------------
//
// Makes a value safe for a filename: lowercased, spaces to
// underscores, everything outside [a-z0-9_.-] dropped. Note
// Lithuanian letters are dropped too, so "Ž. Kazlauskaitė"
// becomes ".kazlauskait".
//
// Used by:
//   - the multer storage filename callback (below)
// -----------------------------------------------------------

function cleanSegment(value, fallback) {
  return (value || fallback)
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");
}







// -----------------------------------------------------------
// storage / upload — multer disk storage
// -----------------------------------------------------------
//
// Saves into uploadDir as
//   <theme>-<subtheme>-<fullname>-<timestamp>-<rand><ext>.
// The originalname arrives latin1-mangled from multer, so it
// is re-decoded as UTF-8 before taking the extension. The
// theme/subtheme codes come from req.body, which multer has
// only parsed by the time the FILE field follows the text
// fields in the FormData — the frontend appends attachment
// last for exactly that reason.
//
// Used by:
//   - POST  /api/activities (below)
//   - PATCH /api/activities/:id (below)
// -----------------------------------------------------------

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const nameUtf8 = Buffer.from(file.originalname, "latin1").toString("utf8");
    const fullName = req.userFullName || "unknown_user";
    const themeCode = req.body?.theme_code || "unknown_theme_code";
    const subthemeCode = req.body?.subtheme_code || "unknown_subtheme_code";

    const safeTheme = cleanSegment(themeCode, "no_theme");
    const safeSubtheme = cleanSegment(subthemeCode, "no_subtheme");
    const safeFullName = cleanSegment(fullName, "unknown_user");

    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(nameUtf8);

    const finalName = `${safeTheme}-${safeSubtheme}-${safeFullName}-${unique}${ext}`;
    cb(null, finalName);
  },
});

const upload = multer({ storage });

// Guard chains by active role (X-Active-Role header)
const guard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Darbuotojas"])];
const managerGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Vadybininkas"])];
const committeeGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Komisijos narys"])];







// -----------------------------------------------------------
// POST /api/activities
// -----------------------------------------------------------
//
// Create an activity (multipart form: theme_id, subtheme_id,
// title, description, optional attachment file plus
// theme_code/subtheme_code for the filename). Starts in the
// DB-default status PATEIKTA.
//
// Used by:
//   - employee/newActivity.jsx — the submission form
// -----------------------------------------------------------

router.post("/", guard, loadUserFullName, upload.single("attachment"), async (req, res) => {
    try {
      const oid = req.user?.oid || req.user?.sub;
      if (!oid) {
        return res.status(400).json({ error: "Klaida: Trūksta vartotojo OID" });
      }

      const { theme_id, subtheme_id, title, description } = req.body || {};

      const themeId = parseInt(theme_id, 10);
      const subthemeId = parseInt(subtheme_id, 10);

      if (!themeId || !subthemeId || !title) {
        return res
          .status(400)
          .json({ error: "Klaida: Tema, potemė ir pavadinimas yra privalomi" });
      }

      // Same latin1→utf8 re-decode as the storage callback,
      // so Lithuanian filenames download intact
      const attachmentPath = req.file ? req.file.filename : null;
      const attachmentOriginalName = req.file ? Buffer.from(req.file.originalname, "latin1").toString("utf8") : null;

      const act = await pool.query(
        `INSERT INTO activities (
           employee_oid,
           theme_id,
           subtheme_id,
           title,
           description,
           attachment_path,
           attachment_original_name
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id,
                   employee_oid,
                   theme_id,
                   subtheme_id,
                   title,
                   description,
                   status,
                   rejection_comment,
                   manager_comments,
                   score,
                   attachment_path,
                   attachment_original_name,
                   created_at,
                   updated_at`,
        [
          oid,
          themeId,
          subthemeId,
          title.trim(),
          (description || "").trim(),
          attachmentPath,
          attachmentOriginalName,
        ]
      );

      res.status(201).json(act.rows[0]);
    } catch (e) {
      console.error("POST /api/activities error:", e);
      res.status(500).json({ error: "internal error" });
    }
  }
);







// -----------------------------------------------------------
// GET /api/activities/my
// -----------------------------------------------------------
//
// The caller's own activities, newest first, with theme and
// subtheme codes/titles joined in.
//
// Used by:
//   - employee/myActivities.jsx — the main list
//   - employee/export.jsx — the XLSX export source
// -----------------------------------------------------------

router.get("/my", guard, async (req, res) => {
  try {
    const oid = req.user?.oid || req.user?.sub;
    if (!oid) {
      return res.status(400).json({ error: "Klaida: Trūksta vartotojo OID" });
    }

    const q = await pool.query(
      `SELECT
         a.id,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN themes t
         ON t.id = a.theme_id
       JOIN subthemes s
         ON s.id = a.subtheme_id
       WHERE a.employee_oid = $1
       ORDER BY a.created_at DESC`,
      [oid]
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/my error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/all
// -----------------------------------------------------------
//
// Every activity in every status, with the employee's name —
// the manager's full overview / export source.
//
// Used by:
//   - manager/export.jsx — the XLSX export source
// -----------------------------------------------------------

router.get("/all", managerGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
         a.id,
         a.employee_oid,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.committee_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         a.updated_at,
         u.full_name,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN users u
         ON u.oid = a.employee_oid
       JOIN themes t
         ON t.id = a.theme_id
       JOIN subthemes s
         ON s.id = a.subtheme_id
       ORDER BY a.created_at DESC`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/all error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/committee
// -----------------------------------------------------------
//
// The committee's work queue: activities a manager has
// approved (status PATVIRTINTA), waiting for a score.
//
// Used by:
//   - committee/evaluate.jsx — the evaluation queue
// -----------------------------------------------------------

router.get("/committee", committeeGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
         a.id,
         a.employee_oid,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         a.updated_at,
         u.full_name,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN users u
         ON u.oid = a.employee_oid
       JOIN themes t
         ON t.id = a.theme_id
       JOIN subthemes s
         ON s.id = a.subtheme_id
       WHERE a.status = 'PATVIRTINTA'
       ORDER BY a.created_at DESC`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/committee error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/evaluated
// -----------------------------------------------------------
//
// Already-scored activities (ĮVERTINTA), most recently
// touched first — the committee's review/correction list.
//
// Used by:
//   - committee/results.jsx — the results table
// -----------------------------------------------------------

router.get("/evaluated", committeeGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
         a.id,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.created_at,
         a.updated_at,
         a.rejection_comment,
         a.manager_comments,
         a.committee_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         u.full_name,
         t.code  AS theme_code,
         t.title AS theme_title,
         s.code  AS subtheme_code,
         s.title AS subtheme_title
       FROM activities a
       JOIN users u       ON u.oid = a.employee_oid
       JOIN themes t      ON t.id = a.theme_id
       JOIN subthemes s   ON s.id = a.subtheme_id
       WHERE a.status = 'ĮVERTINTA'
       ORDER BY a.updated_at DESC, a.created_at DESC`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/evaluated error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/evaluated/theme-totals
// -----------------------------------------------------------
//
// One row per theme: its budget (total_sum), stored point
// value, and the raw sum of ĮVERTINTA scores. LEFT JOIN, so
// themes with no evaluated work appear with total_score 0.
// Note the sum is UNcapped — subtheme caps are applied
// client-side on the calculate page.
//
// Used by:
//   - committee/calculate.jsx — the theme table
// -----------------------------------------------------------

router.get("/evaluated/theme-totals", committeeGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
         t.id   AS theme_id,
         t.code AS theme_code,
         t.title AS theme_title,
         t.total_sum AS theme_total_sum,
         t.pointvalue AS theme_pointvalue,
         COALESCE(SUM(a.score), 0) AS total_score
       FROM themes t
       LEFT JOIN activities a
         ON a.theme_id = t.id
        AND a.status = 'ĮVERTINTA'
       GROUP BY t.id, t.code, t.title, t.total_sum, t.pointvalue
       ORDER BY t.code`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/evaluated/theme-totals error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/evaluated/employees
// -----------------------------------------------------------
//
// The distinct employees who have at least one ĮVERTINTA
// activity — populates the employee picker on the calculate
// page.
//
// Used by:
//   - committee/calculate.jsx — employee dropdown
// -----------------------------------------------------------

router.get("/evaluated/employees", committeeGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT DISTINCT
         u.oid,
         u.full_name,
         u.email
       FROM activities a
       JOIN users u ON u.oid = a.employee_oid
       WHERE a.status = 'ĮVERTINTA'
       ORDER BY u.full_name`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/evaluated/employees error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/evaluated/employee/:oid/subthemes
// -----------------------------------------------------------
//
// One employee's ĮVERTINTA scores grouped per subtheme, with
// the subtheme cap and theme point value alongside — all the
// inputs the calculate page needs to figure a bonus.
//
// Used by:
//   - committee/calculate.jsx — after picking an employee
// -----------------------------------------------------------

router.get("/evaluated/employee/:oid/subthemes", committeeGuard, async (req, res) => {
  try {
    const { oid } = req.params;

    const q = await pool.query(
      `SELECT
        a.theme_id,
        t.code       AS theme_code,
        t.title      AS theme_title,
        a.subtheme_id,
        s.code       AS subtheme_code,
        s.title      AS subtheme_title,
        COALESCE(SUM(a.score), 0) AS total_score,
        s.cap        AS subtheme_cap,
        t.pointvalue AS theme_pointvalue
      FROM activities a
      JOIN themes t    ON t.id = a.theme_id
      JOIN subthemes s ON s.id = a.subtheme_id
      WHERE a.employee_oid = $1
        AND a.status = 'ĮVERTINTA'
      GROUP BY
        a.theme_id,
        t.code,
        t.title,
        a.subtheme_id,
        s.code,
        s.title,
        s.cap,
        t.pointvalue
      ORDER BY t.code, s.code`,
      [oid]
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/evaluated/employee/:oid/subthemes error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/pending
// -----------------------------------------------------------
//
// The manager's inbox: PATEIKTA activities, oldest first so
// the queue is worked in submission order.
//
// Used by:
//   - manager/review.jsx — the review queue
// -----------------------------------------------------------

router.get("/pending", managerGuard, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
         a.id,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.created_at,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         u.full_name,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN users u
         ON u.oid = a.employee_oid
       JOIN themes t
         ON t.id = a.theme_id
       JOIN subthemes s
         ON s.id = a.subtheme_id
       WHERE a.status = 'PATEIKTA'
       ORDER BY a.created_at ASC`
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/pending error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// PATCH /api/activities/:id/manager
// -----------------------------------------------------------
//
// The manager's verdict on one PATEIKTA activity. Body:
//   action: "approve" → PATVIRTINTA (clears rejection_comment)
//           "deny"    → ATMESTA   (comment required)
//           "return"  → TIKSLINTI (comment required)
//           absent    → plain edit of the fields below
//   manager_comments, theme_id, subtheme_id — optional edits.
//
// Only PATEIKTA activities can be touched — everything else
// is a 400. On deny/return an email goes to the employee,
// fire-and-forget: a failed send is only logged, the status
// change stands.
//
// Note the "Paketiimai" typo in the no-fields error is
// user-facing and shipped; left as-is here.
//
// Used by:
//   - manager/review.jsx — approve/deny/return buttons and
//     the edit dialog
// -----------------------------------------------------------

router.patch("/:id/manager", managerGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, manager_comments, rejection_comment, theme_id, subtheme_id } = req.body || {};

    // Status gate first — the verdict below only applies to
    // PATEIKTA rows
    const cur = await pool.query(
      `SELECT status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (cur.rowCount === 0) {
      return res.status(404).json({ error: "Klaida: Nerasta" });
    }

    const row = cur.rows[0];
    if (row.status !== "PATEIKTA") {
      return res.status(400).json({
        error: "Klaida: Redaguoti / tvirtinti galima tik PATEIKTA būsenos veiklas.",
      });
    }

    // Dynamic SET list — only the fields actually sent
    const fields = [];
    const vals = [];
    let i = 1;

    if (theme_id !== undefined) {
      const tid = parseInt(theme_id, 10);
      if (!Number.isNaN(tid)) {
        fields.push(`theme_id = $${i++}`);
        vals.push(tid);
      }
    }

    if (subtheme_id !== undefined) {
      const sid = parseInt(subtheme_id, 10);
      if (!Number.isNaN(sid)) {
        fields.push(`subtheme_id = $${i++}`);
        vals.push(sid);
      }
    }

    if (action === "approve") {
      fields.push(`status = $${i++}`);
      vals.push("PATVIRTINTA");
      // A leftover rejection comment from an earlier round
      // would confuse the employee — clear it
      fields.push(`rejection_comment = $${i++}`);
      vals.push(null);
    } else if (action === "deny") {
      if (!rejection_comment || !rejection_comment.trim()) {
        return res.status(400).json({ error: "Klaida: Atmetimui privalomas komentaras." });
      }
      fields.push(`status = $${i++}`);
      vals.push("ATMESTA");
      fields.push(`rejection_comment = $${i++}`);
      vals.push(rejection_comment.trim());
    } else if (action === "return") {
      if (!rejection_comment || !rejection_comment.trim()) {
        return res.status(400).json({ error: "Klaida: Tikslinimui privalomas komentaras." });
      }
      fields.push(`status = $${i++}`);
      vals.push("TIKSLINTI");
      fields.push(`rejection_comment = $${i++}`);
      vals.push(rejection_comment.trim());
    }

    if (manager_comments !== undefined) {
      fields.push(`manager_comments = $${i++}`);
      vals.push(manager_comments.trim());
    }

    if (!fields.length) {
      return res.status(400).json({ error: "Klaida: Paketiimai nepateikti" });
    }

    vals.push(id);

    await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}`,
      vals
    );

    // Notify the employee about deny/return — reading the
    // comment back from the DB so the mail matches what was
    // stored
    if (action === "deny" || action === "return") {
      try {
        const infoSql = `
          SELECT a.title,
                 a.rejection_comment,
                 u.email,
                 u.full_name
          FROM activities a
          JOIN users u ON u.oid = a.employee_oid
          WHERE a.id = $1
        `;
        const { rows: infoRows } = await pool.query(infoSql, [id]);
        const info = infoRows[0];

        if (info?.email) {
          const payload = {
            to: info.email,
            fullName: info.full_name,
            title: info.title,
            comment: info.rejection_comment,
          };

          const fn =
            action === "deny" ? sendRejectionEmail : sendReturnEmail;

          // Fire-and-forget: a dead SMTP server must not fail
          // the PATCH
          fn(payload).catch((err) => {
            console.error(
              action === "deny"
                ? "Failed to send rejection email:"
                : "Failed to send return email:",
              err
            );
          });
        }
      } catch (err) {
        console.error("Error preparing email:", err);
      }
    }

    const q = await pool.query(
      `SELECT
         a.id,
         a.title,
         a.description,
         a.status,
         a.created_at,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         u.full_name,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN users u ON u.oid = a.employee_oid
       JOIN themes t ON t.id = a.theme_id
       JOIN subthemes s ON s.id = a.subtheme_id
       WHERE a.id = $1`,
      [id]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/activities/:id/manager error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// PATCH /api/activities/:id/committee
// -----------------------------------------------------------
//
// The committee's verdict. Body:
//   action: "score"  → sets score, status ĮVERTINTA
//           "return" → back to PATEIKTA, score cleared
//   committee_comments, theme_id, subtheme_id — optional.
//
// Works on PATVIRTINTA and ĮVERTINTA rows, so an existing
// score can be corrected later from the results page.
//
// Used by:
//   - committee/evaluate.jsx — first scoring
//   - committee/results.jsx — corrections
// -----------------------------------------------------------

router.patch("/:id/committee", committeeGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, score, committee_comments, theme_id, subtheme_id } = req.body || {};

    const cur = await pool.query(
      `SELECT status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (cur.rowCount === 0) {
      return res.status(404).json({ error: "Klaida: Nerasta" });
    }

    const row = cur.rows[0];
    if (row.status !== "PATVIRTINTA" && row.status !== "ĮVERTINTA") {
      return res.status(400).json({
        error: "Klaida: Komisija gali tvarkyti tik PATVIRTINTA arba ĮVERTINTA būsenos veiklas.",
      });
    }

    const fields = [];
    const vals = [];
    let i = 1;

    if (theme_id !== undefined) {
      const tid = parseInt(theme_id, 10);
      if (!Number.isNaN(tid)) {
        fields.push(`theme_id = $${i++}`);
        vals.push(tid);
      }
    }

    if (subtheme_id !== undefined) {
      const sid = parseInt(subtheme_id, 10);
      if (!Number.isNaN(sid)) {
        fields.push(`subtheme_id = $${i++}`);
        vals.push(sid);
      }
    }

    if (action === "score") {
      if (score === undefined || score === null || score === "") {
        return res.status(400).json({ error: "Klaida: Įvertinimas privalomas." });
      }
      const num = Number(score);
      if (!Number.isFinite(num)) {
        return res.status(400).json({ error: "Klaida: Įvertinimas turi būti skaičius." });
      }
      fields.push(`score = $${i++}`);
      vals.push(num);

      fields.push(`status = $${i++}`);
      vals.push("ĮVERTINTA");

    } else if (action === "return") {
      // Straight back to the manager's queue — the score is
      // wiped so a re-approval starts clean
      fields.push(`status = $${i++}`);
      vals.push("PATEIKTA");
      fields.push(`score = $${i++}`);
      vals.push(null);
    }

    if (committee_comments !== undefined) {
      fields.push(`committee_comments = $${i++}`);
      vals.push(committee_comments == null ? null : String(committee_comments).trim());
    }

    if (!fields.length) {
      return res.status(400).json({ error: "Klaida: Pakeitimai nepateikti" });
    }

    vals.push(id);

    await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}`,
      vals
    );

    const q = await pool.query(
      `SELECT
         a.id,
         a.employee_oid,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.committee_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         a.updated_at,
         u.full_name,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN users u ON u.oid = a.employee_oid
       JOIN themes t ON t.id = a.theme_id
       JOIN subthemes s ON s.id = a.subtheme_id
       WHERE a.id = $1`,
      [id]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/activities/:id/committee error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// GET /api/activities/:id/attachment
// -----------------------------------------------------------
//
// Streams the stored attachment with its ORIGINAL filename.
// Guarded by ownership, not active role: the owner may always
// download, and anyone who merely OWNS the manager or
// committee role may download any attachment — no
// X-Active-Role header needed, which is why every role's
// pages can call it directly.
//
// Used by:
//   - employee/myActivities.jsx, manager/review.jsx,
//     committee/evaluate.jsx, committee/results.jsx —
//     the attachment download links
// -----------------------------------------------------------

router.get("/:id/attachment", verifySamlSession, attachRoles, async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;

    const q = await pool.query(
      `SELECT attachment_path, attachment_original_name, employee_oid
       FROM activities
       WHERE id = $1`,
      [id]
    );

    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = q.rows[0];

    const roles = req.user?.roles || [];
    const isPrivileged = roles.includes("Vadybininkas") || roles.includes("Komisijos narys");

    if (row.employee_oid !== oid && !isPrivileged) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (!row.attachment_path) {
      return res.status(404).json({ error: "Klaida: Nėra priedo" });
    }

    const filePath = path.join(uploadDir, row.attachment_path);
    const downloadName = row.attachment_original_name || "priedas";

    return res.download(filePath, downloadName);
  } catch (e) {
    console.error("GET /api/activities/:id/attachment error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// PATCH /api/activities/:id
// -----------------------------------------------------------
//
// The employee editing their own activity (multipart, same
// form as POST). Only the owner, and only in PATEIKTA or
// TIKSLINTI status. A new attachment replaces the old file on
// disk (best-effort unlink, ENOENT ignored).
//
// Bug, documented not fixed: the replacement file's
// attachment_original_name is stored RAW here — without the
// latin1→utf8 re-decode POST / does — so a re-uploaded
// Lithuanian filename downloads mangled.
//
// Used by:
//   - employee/myActivities.jsx — the edit dialog
// -----------------------------------------------------------

router.patch("/:id", guard, loadUserFullName, upload.single("attachment"), async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;
    const { theme_id, subtheme_id, title, description } = req.body || {};

    // Ownership + status gate before touching anything
    const cur = await pool.query(
      `SELECT employee_oid, status, attachment_path
         FROM activities
        WHERE id = $1`,
      [id]
    );
    if (cur.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = cur.rows[0];
    if (row.employee_oid !== oid) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }
    if (row.status !== "PATEIKTA" && row.status !== "TIKSLINTI") {
      return res.status(400).json({
        error: "Klaida: Redaguoti galima tik PATEIKTA arba TIKSLINTI būsenos veiklas.",
      });
    }

    const fields = [];
    const vals = [];
    let i = 1;

    if (theme_id !== undefined) {
      const themeId = parseInt(theme_id, 10);
      if (!themeId) return res.status(400).json({ error: "Klaida: Netinkama tema" });
      fields.push(`theme_id = $${i++}`);
      vals.push(themeId);
    }
    if (subtheme_id !== undefined) {
      const subthemeId = parseInt(subtheme_id, 10);
      if (!subthemeId) return res.status(400).json({ error: "Klaida: Netinkama potemė" });
      fields.push(`subtheme_id = $${i++}`);
      vals.push(subthemeId);
    }
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ error: "Klaida: Netinkamas pavadinimas" });
      fields.push(`title = $${i++}`);
      vals.push(title.trim());
    }
    if (description !== undefined) {
      fields.push(`description = $${i++}`);
      vals.push(description.trim());
    }

    if (req.file) {
      fields.push(`attachment_path = $${i++}`);
      vals.push(req.file.filename);

      // Missing the latin1→utf8 re-decode — see the banner
      fields.push(`attachment_original_name = $${i++}`);
      vals.push(req.file.originalname);
    }

    if (!fields.length) {
      return res.status(400).json({ error: "Klaida: Atnaujinimai nepateikti" });
    }

    vals.push(id);

    await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}`,
      vals
    );

    // The old file is orphaned once the row points elsewhere
    const oldPath = cur.rows[0].attachment_path;
    if (req.file && oldPath && oldPath !== req.file.filename) {
      const fullOldPath = path.join(uploadDir, oldPath);
      fs.unlink(fullOldPath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.error("Klaida: Nepavyko panaikinti priedo:", err);
        }
      });
    }

    const q = await pool.query(
      `SELECT
         a.id,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         a.updated_at,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN themes t ON t.id = a.theme_id
       JOIN subthemes s ON s.id = a.subtheme_id
       WHERE a.id = $1`,
      [id]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/activities/:id error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// DELETE /api/activities/:id
// -----------------------------------------------------------
//
// The employee deleting their own activity — owner only,
// PATEIKTA or TIKSLINTI only (the error text mentions just
// PATEIKTA, but TIKSLINTI is accepted too). The attachment
// file is NOT removed from disk — deletes orphan it.
//
// Used by:
//   - employee/myActivities.jsx — the delete button
// -----------------------------------------------------------

router.delete("/:id", guard, async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;

    const q = await pool.query(
      `SELECT employee_oid, status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = q.rows[0];

    if (row.employee_oid !== oid) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (row.status !== "PATEIKTA" && row.status !== "TIKSLINTI") {
      return res
        .status(400)
        .json({ error: "Klaida: Galima ištrinti tik PATEIKTA būsenos veiklas." });
    }

    await pool.query(`DELETE FROM activities WHERE id = $1`, [id]);
    res.sendStatus(204);
  } catch (e) {
    console.error("DELETE /api/activities/:id error:", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// POST /api/activities/:id/resubmit
// -----------------------------------------------------------
//
// After fixing a TIKSLINTI activity the employee sends it
// back to the manager: status → PATEIKTA, the manager's
// return comment cleared. Owner only, TIKSLINTI only.
//
// Used by:
//   - employee/myActivities.jsx — "Pateikti iš naujo"
// -----------------------------------------------------------

router.post("/:id/resubmit", guard, async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;

    const cur = await pool.query(
      `SELECT employee_oid, status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (cur.rowCount === 0) {
      return res.status(404).json({ error: "Klaida: Nerasta" });
    }

    const row = cur.rows[0];

    if (row.employee_oid !== oid) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (row.status !== "TIKSLINTI") {
      return res.status(400).json({
        error: "Klaida: Pateikti iš naujo galima tik TIKSLINTI būsenos veiklas.",
      });
    }

    await pool.query(
      `UPDATE activities
          SET status = 'PATEIKTA',
              rejection_comment = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );

    const q = await pool.query(
      `SELECT
         a.id,
         a.theme_id,
         a.subtheme_id,
         a.title,
         a.description,
         a.status,
         a.rejection_comment,
         a.manager_comments,
         a.score,
         a.attachment_path,
         a.attachment_original_name,
         a.created_at,
         a.updated_at,
         t.code   AS theme_code,
         t.title  AS theme_title,
         s.code   AS subtheme_code,
         s.title  AS subtheme_title
       FROM activities a
       JOIN themes t ON t.id = a.theme_id
       JOIN subthemes s ON s.id = a.subtheme_id
       WHERE a.id = $1`,
      [id]
    );

    res.json(q.rows[0]);
  } catch (e) {
    console.error("POST /api/activities/:id/resubmit error:", e);
    res.status(500).json({ error: "internal error" });
  }
});


export default router;
