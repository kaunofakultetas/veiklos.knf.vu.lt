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

// upload folder exists
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// middleware prefix file names
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

// remove weird chars names etc
function cleanSegment(value, fallback) {
  return (value || fallback)
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");
}

// multer prefix in filename
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

// guards
const guard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Darbuotojas"])];
const managerGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Vadybininkas"])];
const committeeGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Komisijos narys"])];

// POST /api/activities  – create new activity
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

// GET /api/activities/my - employee activities
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

// GET /api/activities/all – all activities for manager
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

// GET /api/activities/committee – PATVIRTINTA activities for committee
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

// GET api/activities/evaluated - IVERTINTA activities for committee
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

// GET /api/activities/evaluated/theme-totals for committee calc
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

// GET /api/activities/evaluated/employees for committee employee bonus list
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

// GET /api/activities/evaluated/employee/:oid/subthemes for committee employee bonus list
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

// GET /api/activities/pending – PATEIKTA activities for managers
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

// PATCH /api/activities/:id/manager – approve / deny / return / edit manager comments
router.patch("/:id/manager", managerGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, manager_comments, rejection_comment, theme_id, subtheme_id } = req.body || {};

    // load current status
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

    const fields = [];
    const vals = [];
    let i = 1;

    // change theme / subtheme
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

    // approve / deny / return changes status
    if (action === "approve") {
      fields.push(`status = $${i++}`);
      vals.push("PATVIRTINTA");
      // clear rejection comm
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

    // adjust comments in edit
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

    if (action === "deny" || action === "return") {
      try {
        // fetch user email + activity info
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

    // return updated row
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

// PATCH /api/activities/:id/committee – approve / return for committee
router.patch("/:id/committee", committeeGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, score, committee_comments, theme_id, subtheme_id } = req.body || {};

    // PATVIRTINTA
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
      // return
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

// GET /api/activities/:id/attachment – download attachment
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

    // restriction
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

// PATCH /api/activities/:id – edit theme, subtheme, title, description
router.patch("/:id", guard, loadUserFullName, upload.single("attachment"), async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;
    const { theme_id, subtheme_id, title, description } = req.body || {};

    // check ownership
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

    const oldPath = cur.rows[0].attachment_path;
    if (req.file && oldPath && oldPath !== req.file.filename) {
      const fullOldPath = path.join(uploadDir, oldPath);
      fs.unlink(fullOldPath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.error("Klaida: Nepavyko panaikinti priedo:", err);
        }
      });
    }

    // return updated rows
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

// DELETE /api/activities/:id – employee delete activity
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

// POST /api/activities/:id/resubmit – employee resubmit TIKSLINTI
router.post("/:id/resubmit", guard, async (req, res) => {
  try {
    const { id } = req.params;
    const oid = req.user?.oid || req.user?.sub;

    // check ownership
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

    // change status to PATEIKTA
    await pool.query(
      `UPDATE activities
          SET status = 'PATEIKTA',
              rejection_comment = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );

    // return updated rows
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
