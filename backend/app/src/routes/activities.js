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
//    GET    /api/activities/evaluated/employee/:eid/subthemes
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

// The attachment types an activity may carry: documents,
// spreadsheets, slides and images. Keyed by lowercase
// extension; the value is the magic-byte prefix the stored
// file must start with (null = plain text, anything goes).
// No html/svg (script carriers), no archives, no executables.
// The frontend mirrors this list in its accept= attribute.
const ALLOWED_ATTACHMENTS = {
  ".pdf":  [Buffer.from("%PDF")],
  ".doc":  [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  ".xls":  [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  ".ppt":  [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
  ".docx": [Buffer.from("PK\x03\x04")],
  ".xlsx": [Buffer.from("PK\x03\x04")],
  ".pptx": [Buffer.from("PK\x03\x04")],
  ".odt":  [Buffer.from("PK\x03\x04")],
  ".ods":  [Buffer.from("PK\x03\x04")],
  ".odp":  [Buffer.from("PK\x03\x04")],
  ".rtf":  [Buffer.from("{\\rtf")],
  ".txt":  null,
  ".csv":  null,
  ".jpg":  [Buffer.from([0xff, 0xd8, 0xff])],
  ".jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  ".png":  [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ".gif":  [Buffer.from("GIF87a"), Buffer.from("GIF89a")],
  ".webp": [Buffer.from("RIFF")],
};

// One attachment per activity, at most this big — the same
// 100 MB the frontend checks before sending and the ingress
// caps request bodies at (with headroom for the multipart
// envelope), so nobody can exhaust disk or memory here
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

// The user-facing refusals — the list of allowed types is
// spelled out so the employee knows what to convert to
const MSG_BAD_TYPE =
  "Klaida: neleistinas priedo tipas. Leidžiami: " +
  Object.keys(ALLOWED_ATTACHMENTS).map((e) => e.slice(1)).join(", ");
const MSG_TOO_BIG = "Klaida: priedas per didelis (iki 100 MB)";







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
    const eid = req.user?.eid || req.user?.sub;
    if (!eid) {
      return res.status(400).json({ error: "Klaida: Trūksta vartotojo OID" });
    }

    const { rows } = await pool.query(
      "SELECT full_name FROM users WHERE eid = $1 LIMIT 1",
      [eid]
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
// subthemeMatchesTheme
// -----------------------------------------------------------
//
// true when the subtheme belongs to the theme — the pairing
// the FKs alone cannot enforce (each id is valid on its own,
// but theme T2 with subtheme T1.1 would count the activity's
// score in the wrong theme's total). With an activityId the
// halves not being changed are taken from the row, so a
// PATCH that sends only one of the two is checked against
// the other one as stored.
//
// Used by:
//   - POST /, PATCH /:id, PATCH /:id/manager,
//     PATCH /:id/committee (below)
// -----------------------------------------------------------

async function subthemeMatchesTheme(activityId, themeId, subthemeId) {
  const q = activityId === null
    ? await pool.query(
        `SELECT 1 FROM subthemes WHERE id = $1 AND theme_id = $2`,
        [subthemeId, themeId]
      )
    : await pool.query(
        `SELECT 1
           FROM subthemes s
           JOIN activities a ON a.id = $1
          WHERE s.id = COALESCE($2::int, a.subtheme_id)
            AND s.theme_id = COALESCE($3::int, a.theme_id)`,
        [activityId, subthemeId, themeId]
      );
  return q.rowCount > 0;
}

const MSG_PAIR = "Klaida: potemė nepriklauso pasirinktai temai";







// -----------------------------------------------------------
// answerLostRace
// -----------------------------------------------------------
//
// Every state-changing route first reads the row to answer a
// friendly 404/403/400, then WRITES CONDITIONALLY — the
// UPDATE/DELETE repeats the ownership and status
// preconditions in its WHERE, so two requests racing on the
// same row (an employee editing while the manager approves)
// cannot both win: the second one's write matches 0 rows.
// This answers that loser: re-read the row and say why —
// gone (404), not theirs (403), or the status moved on (409
// naming the current status, so the UI can refresh).
//
// Used by:
//   - PATCH /:id, PATCH /:id/manager, PATCH /:id/committee,
//     DELETE /:id, POST /:id/resubmit (below) — when their
//     conditional write reports rowCount 0
// -----------------------------------------------------------

async function answerLostRace(res, id, ownerEid = null) {
  const q = await pool.query(
    `SELECT employee_eid, status FROM activities WHERE id = $1`,
    [id]
  );
  if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });
  if (ownerEid && q.rows[0].employee_eid !== ownerEid) {
    return res.status(403).json({ error: "Klaida: Draudžiama" });
  }
  return res.status(409).json({
    error: `Klaida: veiklos būsena ką tik pasikeitė (dabar: ${q.rows[0].status}) — atnaujinkite puslapį`,
  });
}







// -----------------------------------------------------------
// attachmentExtension
// -----------------------------------------------------------
//
// The stored extension for an uploaded file: the ORIGINAL
// name's extension (utf8-restored), lowercased, and only if
// it is in ALLOWED_ATTACHMENTS — otherwise null. Only this
// normalized extension ever reaches the disk name, so
// "Ataskaita.PDF" is stored as .pdf and "x.pdf.exe" is
// refused (its extension is .exe).
//
// Used by:
//   - the multer fileFilter and filename callbacks (below)
// -----------------------------------------------------------

function attachmentExtension(originalNameLatin1) {
  const nameUtf8 = Buffer.from(originalNameLatin1, "latin1").toString("utf8");
  const ext = path.extname(nameUtf8).toLowerCase();
  return Object.hasOwn(ALLOWED_ATTACHMENTS, ext) ? ext : null;
}







// -----------------------------------------------------------
// hasExpectedMagic
// -----------------------------------------------------------
//
// Reads the first bytes of a stored file and checks them
// against the extension's signature(s) in
// ALLOWED_ATTACHMENTS — so a renamed executable does not get
// stored as a ".pdf". Text types have no signature and pass.
//
// Used by:
//   - uploadAttachment (below)
// -----------------------------------------------------------

function hasExpectedMagic(filePath, ext) {
  const signatures = ALLOWED_ATTACHMENTS[ext];
  if (!signatures) return true;

  const longest = Math.max(...signatures.map((s) => s.length));
  const head = Buffer.alloc(longest);
  const fd = fs.openSync(filePath, "r");
  let read = 0;
  try {
    read = fs.readSync(fd, head, 0, longest, 0);
  } finally {
    fs.closeSync(fd);
  }
  return signatures.some((sig) => read >= sig.length && head.subarray(0, sig.length).equals(sig));
}







// -----------------------------------------------------------
// storage / upload — multer disk storage
// -----------------------------------------------------------
//
// Saves into uploadDir as
//   <theme>-<subtheme>-<fullname>-<timestamp>-<rand><ext>
// with ext from attachmentExtension. The theme/subtheme codes
// come from req.body, which multer has only parsed by the
// time the FILE field follows the text fields in the
// FormData — the frontend appends attachment last for exactly
// that reason. The fileFilter refuses any type not in
// ALLOWED_ATTACHMENTS before a byte is written, and limits
// cap the size and the count.
//
// Used by:
//   - uploadAttachment (below)
// -----------------------------------------------------------

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const fullName = req.userFullName || "unknown_user";
    const themeCode = req.body?.theme_code || "unknown_theme_code";
    const subthemeCode = req.body?.subtheme_code || "unknown_subtheme_code";

    const safeTheme = cleanSegment(themeCode, "no_theme");
    const safeSubtheme = cleanSegment(subthemeCode, "no_subtheme");
    const safeFullName = cleanSegment(fullName, "unknown_user");

    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = attachmentExtension(file.originalname) || "";

    const finalName = `${safeTheme}-${safeSubtheme}-${safeFullName}-${unique}${ext}`;
    cb(null, finalName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (attachmentExtension(file.originalname)) return cb(null, true);
    cb(Object.assign(new Error(MSG_BAD_TYPE), { code: "BAD_ATTACHMENT_TYPE" }));
  },
});







// -----------------------------------------------------------
// uploadAttachment
// -----------------------------------------------------------
//
// The single-file multer middleware with its errors turned
// into JSON 400s (a refused type, an oversized file) instead
// of Express' HTML 500, plus the magic-byte check on the
// stored file — a mismatch unlinks it and answers 400, so
// nothing mislabelled stays on disk.
//
// Used by:
//   - POST  /api/activities (below)
//   - PATCH /api/activities/:id (below)
// -----------------------------------------------------------

function uploadAttachment(req, res, next) {
  upload.single("attachment")(req, res, (err) => {
    if (err) {
      if (err.code === "BAD_ATTACHMENT_TYPE") return res.status(400).json({ error: MSG_BAD_TYPE });
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: MSG_TOO_BIG });
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: "Klaida: leidžiamas vienas priedas" });
      }
      console.error("attachment upload error:", err);
      return res.status(400).json({ error: "Klaida: priedo įkelti nepavyko" });
    }

    if (req.file) {
      const ext = attachmentExtension(req.file.originalname);
      if (!hasExpectedMagic(req.file.path, ext)) {
        fs.unlink(req.file.path, () => {});
        req.file = undefined;
        return res.status(400).json({ error: MSG_BAD_TYPE });
      }
    }

    next();
  });
}

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

router.post("/", guard, loadUserFullName, uploadAttachment, async (req, res) => {
    try {
      const eid = req.user?.eid || req.user?.sub;
      if (!eid) {
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
      if (!(await subthemeMatchesTheme(null, themeId, subthemeId))) {
        return res.status(400).json({ error: MSG_PAIR });
      }

      // Same latin1→utf8 re-decode as the storage callback,
      // so Lithuanian filenames download intact
      const attachmentPath = req.file ? req.file.filename : null;
      const attachmentOriginalName = req.file ? Buffer.from(req.file.originalname, "latin1").toString("utf8") : null;

      const act = await pool.query(
        `INSERT INTO activities (
           employee_eid,
           theme_id,
           subtheme_id,
           title,
           description,
           attachment_path,
           attachment_original_name
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id,
                   employee_eid,
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
          eid,
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
    const eid = req.user?.eid || req.user?.sub;
    if (!eid) {
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
       WHERE a.employee_eid = $1
       ORDER BY a.created_at DESC`,
      [eid]
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
         a.employee_eid,
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
         ON u.eid = a.employee_eid
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
         a.employee_eid,
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
         ON u.eid = a.employee_eid
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
       JOIN users u       ON u.eid = a.employee_eid
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
         u.eid,
         u.full_name,
         u.email
       FROM activities a
       JOIN users u ON u.eid = a.employee_eid
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
// GET /api/activities/evaluated/employee/:eid/subthemes
// -----------------------------------------------------------
//
// One employee's ĮVERTINTA scores grouped per subtheme, with
// the subtheme cap and theme point value alongside — all the
// inputs the calculate page needs to figure a bonus.
//
// Used by:
//   - committee/calculate.jsx — after picking an employee
// -----------------------------------------------------------

router.get("/evaluated/employee/:eid/subthemes", committeeGuard, async (req, res) => {
  try {
    const { eid } = req.params;

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
      WHERE a.employee_eid = $1
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
      [eid]
    );

    res.json(q.rows);
  } catch (e) {
    console.error("GET /api/activities/evaluated/employee/:eid/subthemes error:", e);
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
         ON u.eid = a.employee_eid
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

    let newThemeId = null;
    let newSubthemeId = null;
    if (theme_id !== undefined) {
      const tid = parseInt(theme_id, 10);
      if (!Number.isNaN(tid)) {
        fields.push(`theme_id = $${i++}`);
        vals.push(tid);
        newThemeId = tid;
      }
    }

    if (subtheme_id !== undefined) {
      const sid = parseInt(subtheme_id, 10);
      if (!Number.isNaN(sid)) {
        fields.push(`subtheme_id = $${i++}`);
        vals.push(sid);
        newSubthemeId = sid;
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

    // A reassigned theme/subtheme must still be a real pair
    if ((newThemeId !== null || newSubthemeId !== null)
        && !(await subthemeMatchesTheme(id, newThemeId, newSubthemeId))) {
      return res.status(400).json({ error: MSG_PAIR });
    }

    vals.push(id);

    // Conditional write: still PATEIKTA, or the verdict lost
    // a race (see answerLostRace)
    const upd = await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}
          AND status = 'PATEIKTA'`,
      vals
    );
    if (upd.rowCount === 0) return answerLostRace(res, id);

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
          JOIN users u ON u.eid = a.employee_eid
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

          // Fire-and-forget: a dead mail relay must not fail
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
         a.employee_eid,
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
       JOIN users u ON u.eid = a.employee_eid
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
// The score is 1/n for n people who carried the activity
// out (0 for none), so it lives in [0, 1] — the pages derive
// it, the API enforces the bounds and rounds to 2 decimals,
// since an out-of-range value would skew every theme total
// the calculator divides the budget by.
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

    let newThemeId = null;
    let newSubthemeId = null;
    if (theme_id !== undefined) {
      const tid = parseInt(theme_id, 10);
      if (!Number.isNaN(tid)) {
        fields.push(`theme_id = $${i++}`);
        vals.push(tid);
        newThemeId = tid;
      }
    }

    if (subtheme_id !== undefined) {
      const sid = parseInt(subtheme_id, 10);
      if (!Number.isNaN(sid)) {
        fields.push(`subtheme_id = $${i++}`);
        vals.push(sid);
        newSubthemeId = sid;
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
      if (num < 0 || num > 1) {
        return res.status(400).json({ error: "Klaida: Įvertinimas turi būti tarp 0 ir 1." });
      }
      fields.push(`score = $${i++}`);
      vals.push(Number(num.toFixed(2)));

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

    // A reassigned theme/subtheme must still be a real pair
    if ((newThemeId !== null || newSubthemeId !== null)
        && !(await subthemeMatchesTheme(id, newThemeId, newSubthemeId))) {
      return res.status(400).json({ error: MSG_PAIR });
    }

    vals.push(id);

    // Conditional write: still PATVIRTINTA/ĮVERTINTA, or the
    // verdict lost a race (see answerLostRace)
    const upd = await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}
          AND status IN ('PATVIRTINTA', 'ĮVERTINTA')`,
      vals
    );
    if (upd.rowCount === 0) return answerLostRace(res, id);

    const q = await pool.query(
      `SELECT
         a.id,
         a.employee_eid,
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
       JOIN users u ON u.eid = a.employee_eid
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
    const eid = req.user?.eid || req.user?.sub;

    const q = await pool.query(
      `SELECT attachment_path, attachment_original_name, employee_eid
       FROM activities
       WHERE id = $1`,
      [id]
    );

    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = q.rows[0];

    const roles = req.user?.roles || [];
    const isPrivileged = roles.includes("Vadybininkas") || roles.includes("Komisijos narys");

    if (row.employee_eid !== eid && !isPrivileged) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (!row.attachment_path) {
      return res.status(404).json({ error: "Klaida: Nėra priedo" });
    }

    const filePath = path.join(uploadDir, row.attachment_path);
    const downloadName = row.attachment_original_name || "priedas";

    // Always an attachment download, never sniffed into an
    // inline render — the stored types are allowlisted, this
    // is the second line
    res.setHeader("X-Content-Type-Options", "nosniff");
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
// disk (best-effort unlink, ENOENT ignored). The replacement's
// original name gets the same latin1→utf8 re-decode as on
// POST /, so Lithuanian filenames survive a re-upload.
//
// Used by:
//   - employee/myActivities.jsx — the edit dialog
// -----------------------------------------------------------

router.patch("/:id", guard, loadUserFullName, uploadAttachment, async (req, res) => {
  try {
    const { id } = req.params;
    const eid = req.user?.eid || req.user?.sub;
    const { theme_id, subtheme_id, title, description } = req.body || {};

    // Ownership + status gate before touching anything
    const cur = await pool.query(
      `SELECT employee_eid, status, attachment_path
         FROM activities
        WHERE id = $1`,
      [id]
    );
    if (cur.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = cur.rows[0];
    if (row.employee_eid !== eid) {
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

    let newThemeId = null;
    let newSubthemeId = null;
    if (theme_id !== undefined) {
      const themeId = parseInt(theme_id, 10);
      if (!themeId) return res.status(400).json({ error: "Klaida: Netinkama tema" });
      fields.push(`theme_id = $${i++}`);
      vals.push(themeId);
      newThemeId = themeId;
    }
    if (subtheme_id !== undefined) {
      const subthemeId = parseInt(subtheme_id, 10);
      if (!subthemeId) return res.status(400).json({ error: "Klaida: Netinkama potemė" });
      fields.push(`subtheme_id = $${i++}`);
      vals.push(subthemeId);
      newSubthemeId = subthemeId;
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

      // Same latin1→utf8 re-decode as POST /
      fields.push(`attachment_original_name = $${i++}`);
      vals.push(Buffer.from(req.file.originalname, "latin1").toString("utf8"));
    }

    if (!fields.length) {
      return res.status(400).json({ error: "Klaida: Atnaujinimai nepateikti" });
    }

    // A reassigned theme/subtheme must still be a real pair
    if ((newThemeId !== null || newSubthemeId !== null)
        && !(await subthemeMatchesTheme(id, newThemeId, newSubthemeId))) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: MSG_PAIR });
    }

    vals.push(id, eid);

    // Conditional write: still the owner's and still
    // PATEIKTA/TIKSLINTI, or the edit lost a race with a
    // manager verdict (see answerLostRace) — then the file
    // just uploaded is dropped again
    const upd = await pool.query(
      `UPDATE activities
          SET ${fields.join(", ")},
              updated_at = NOW()
        WHERE id = $${i}
          AND employee_eid = $${i + 1}
          AND status IN ('PATEIKTA', 'TIKSLINTI')`,
      vals
    );
    if (upd.rowCount === 0) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return answerLostRace(res, id, eid);
    }

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
// file goes with the row: the DELETE returns the stored path
// and the file is unlinked once the row is gone (best
// effort, a missing file is fine) — the employee's data is
// really erased, not orphaned on disk.
//
// Used by:
//   - employee/myActivities.jsx — the delete button
// -----------------------------------------------------------

router.delete("/:id", guard, async (req, res) => {
  try {
    const { id } = req.params;
    const eid = req.user?.eid || req.user?.sub;

    const q = await pool.query(
      `SELECT employee_eid, status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: Nerasta" });

    const row = q.rows[0];

    if (row.employee_eid !== eid) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (row.status !== "PATEIKTA" && row.status !== "TIKSLINTI") {
      return res
        .status(400)
        .json({ error: "Klaida: Galima ištrinti tik PATEIKTA būsenos veiklas." });
    }

    // Conditional delete — see answerLostRace; RETURNING the
    // path so the file can follow the row
    const del = await pool.query(
      `DELETE FROM activities WHERE id = $1
          AND employee_eid = $2
          AND status IN ('PATEIKTA', 'TIKSLINTI')
       RETURNING attachment_path`,
      [id, eid]
    );
    if (del.rowCount === 0) return answerLostRace(res, id, eid);

    const gonePath = del.rows[0]?.attachment_path;
    if (gonePath) {
      fs.unlink(path.join(uploadDir, gonePath), (err) => {
        if (err && err.code !== "ENOENT") {
          console.error("Klaida: Nepavyko panaikinti priedo:", err);
        }
      });
    }
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
    const eid = req.user?.eid || req.user?.sub;

    const cur = await pool.query(
      `SELECT employee_eid, status
         FROM activities
        WHERE id = $1`,
      [id]
    );

    if (cur.rowCount === 0) {
      return res.status(404).json({ error: "Klaida: Nerasta" });
    }

    const row = cur.rows[0];

    if (row.employee_eid !== eid) {
      return res.status(403).json({ error: "Klaida: Draudžiama" });
    }

    if (row.status !== "TIKSLINTI") {
      return res.status(400).json({
        error: "Klaida: Pateikti iš naujo galima tik TIKSLINTI būsenos veiklas.",
      });
    }

    // Conditional write — see answerLostRace
    const upd = await pool.query(
      `UPDATE activities
          SET status = 'PATEIKTA',
              rejection_comment = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND employee_eid = $2
          AND status = 'TIKSLINTI'`,
      [id, eid]
    );
    if (upd.rowCount === 0) return answerLostRace(res, id, eid);

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
