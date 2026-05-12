import { Router } from "express";
import { pool } from "../db/pool.js";
import { authorize } from "../auth/authorize.js";

const router = Router();

const managerOnly = authorize(["Vadybininkas"]);

// GET /api/user-roles?email=...
router.get("/", managerOnly, async (req, res) => {
  try {
    const email = (req.query.email || "").trim();
    if (!email) return res.status(400).json({ error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });

    const u = await pool.query(
      `SELECT oid AS id, email, full_name
         FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: "Klaida: vartotojas nerastas" });
    const user = u.rows[0];

    const all = await pool.query(`SELECT name FROM roles ORDER BY name ASC`);
    const allRoles = all.rows.map(r => r.name);

    const ur = await pool.query(
      `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_oid = $1
        ORDER BY r.name ASC`,
      [user.id]
    );
    const roles = ur.rows.map(r => r.name);

    res.json({ user, roles, allRoles });
  } catch (e) {
    console.error("GET /api/user-roles", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/user-roles/assign { email, role }
router.post("/assign", managerOnly, async (req, res) => {
  try {
    const { email, role } = req.body || {};
    if (!email || !role) return res.status(400).json({ error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });

    const u = await pool.query(
      `SELECT oid AS id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: "Klaida: Vartotojas nerastas" });
    const userId = u.rows[0].id;

    const r = await pool.query(`SELECT id FROM roles WHERE name = $1`, [role]);
    if (r.rowCount === 0) return res.status(400).json({ error: "Klaida: nežinoma rolė" });
    const roleId = r.rows[0].id;

    await pool.query(
      `INSERT INTO user_roles (user_oid, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, roleId]
    );

    res.sendStatus(204);
  } catch (e) {
    console.error("POST /api/user-roles/assign", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/user-roles/remove { email, role }
router.post("/remove", managerOnly, async (req, res) => {
  try {
    const { email, role } = req.body || {};
    if (!email || !role) return res.status(400).json({ error: "Klaida: Vartotojo el. paštas ir rolė yra privalomi" });

    const u = await pool.query(
      `SELECT oid AS id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: "Klaida: Vartotojas nerastas" });
    const userId = u.rows[0].id;

    const r = await pool.query(`SELECT id FROM roles WHERE name = $1`, [role]);
    if (r.rowCount === 0) return res.sendStatus(204);
    const roleId = r.rows[0].id;

    await pool.query(
      `DELETE FROM user_roles
        WHERE user_oid = $1 AND role_id = $2`,
      [userId, roleId]
    );

    res.sendStatus(204);
  } catch (e) {
    console.error("POST /api/user-roles/remove", e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
