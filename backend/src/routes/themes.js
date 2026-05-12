import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { attachRoles } from "../auth/attachRoles.js";
import { requireActiveRoleIn } from "../auth/requireActiveRole.js";

const router = Router();

// guards
const readGuard = [verifySamlSession, attachRoles];
const manageGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Vadybininkas"])];
const committeeGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Komisijos narys"])];

// GET /api/themes  employee + manager + committee
router.get("/", readGuard, async (_req, res) => {
  try {
    const th = await pool.query(
      `SELECT id, code, title, total_sum, pointvalue
         FROM themes
        ORDER BY code ASC`
    );
    const st = await pool.query(
      `SELECT id, theme_id, code, title, description, cap
         FROM subthemes
        ORDER BY code ASC`
    );
    const map = new Map(th.rows.map(t => [t.id, { ...t, subthemes: [] }]));
    for (const s of st.rows) map.get(s.theme_id)?.subthemes.push(s);
    res.json(Array.from(map.values()));
  } catch (e) {
    console.error("GET /api/themes", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/themes  manager only
router.post("/", manageGuard, async (req, res) => {
  try {
    const { code, title } = req.body || {};
    if (!code || !title) return res.status(400).json({ error: "Klaida: Temos kodas ir pavadinimas yra privalomi" });

    const q = await pool.query(
      `INSERT INTO themes (code, title)
       VALUES ($1, $2)
       RETURNING id, code, title`,
      [code.trim(), title.trim()]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Klaida: Tema su tokiu kodu jau egzistuoja" });
    console.error("POST /api/themes", e);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/themes/:id  manager only
router.patch("/:id", manageGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ["code", "title"];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = $${i++}`);
      vals.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: "Klaida: nėra atnaujinamų laukų" });
    vals.push(id);

    const q = await pool.query(
      `UPDATE themes SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING id, code, title`,
      vals
    );
    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: nerasta" });
    res.json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Klaida: tema su tokiu kodu jau egzistuoja" });
    console.error("PATCH /api/themes/:id", e);
    res.status(500).json({ error: "internal error" });
  }
});

// POST /api/themes/:themeId/subthemes  manager only
router.post("/:themeId/subthemes", manageGuard, async (req, res) => {
  try {
    const { themeId } = req.params;
    const { code, title, description } = req.body || {};
    if (!code || !title) return res.status(400).json({ error: "Klaida: Potemės kodas ir pavadinimas yra privalomi" });

    const q = await pool.query(
      `INSERT INTO subthemes (theme_id, code, title, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, theme_id, code, title, description, cap`,
      [themeId, code.trim(), title.trim(), description ?? null]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Klaida: potemė su tokiu kodu jau egzistuoja" });
    console.error("POST /api/themes/:themeId/subthemes", e);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/themes/subthemes/:id  manager only
router.patch("/subthemes/:id", manageGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ["code", "title", "description"];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [k, v] of Object.entries(req.body || {})) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = $${i++}`);
      vals.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: "Klaida: nėra atnaujinamų laukų" });
    vals.push(id);

    const q = await pool.query(
      `UPDATE subthemes SET ${sets.join(", ")}
        WHERE id = $${i}
        RETURNING id, theme_id, code, title, description, cap`,
      vals
    );
    if (q.rowCount === 0) return res.status(404).json({ error: "Klaida: nerasta" });
    res.json(q.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Klaida: Potemės kodas jau egzistuoja" });
    console.error("PATCH /api/themes/subthemes/:id", e);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/themes/subthemes/:id/cap  committee only
router.patch("/subthemes/:id/cap", committeeGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { cap } = req.body || {};

    if (cap === undefined || cap === null || cap === "") {
      return res.status(400).json({ error: "Klaida: Limito reikšmė privaloma." });
    }

    const num = Number(cap);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: "Klaida: Limitas turi būti teigiamas skaičius." });
    }

    const q = await pool.query(
      `UPDATE subthemes
         SET cap = $1
       WHERE id = $2
       RETURNING id, theme_id, code, title, description, cap`,
      [num, id]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Klaida: Nerasta" });
    }

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/themes/subthemes/:id/cap", e);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/themes/:id/total-sum  committee only
router.patch("/:id/total-sum", committeeGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { total_sum } = req.body || {};

    if (total_sum === undefined || total_sum === null || total_sum === "") {
      return res.status(400).json({ error: "Klaida: Bendra sumos reikšmė privaloma." });
    }

    const num = Number(total_sum);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: "Klaida: Bendra suma turi būti teigiamas skaičius." });
    }

    const q = await pool.query(
      `UPDATE themes
          SET total_sum = $1
        WHERE id = $2
        RETURNING id, code, title, total_sum`,
      [num, id]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "not found" });
    }

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/themes/:id/total-sum", e);
    res.status(500).json({ error: "internal error" });
  }
});

// PATCH /api/themes/:id/pointvalue  committee only
router.patch("/:id/pointvalue", committeeGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const { pointvalue } = req.body || {};

    if (pointvalue === undefined || pointvalue === null || pointvalue === "") {
      return res.status(400).json({ error: "Klaida: Vieno balo reikšmė privaloma." });
    }

    const num = Number(pointvalue);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: "Klaida: Vieno balo reikšmė turi būti teigiamas skaičius." });
    }

    const q = await pool.query(
      `UPDATE themes
          SET pointvalue = $1
        WHERE id = $2
        RETURNING id, code, title, total_sum, pointvalue`,
      [num, id]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "not found" });
    }

    res.json(q.rows[0]);
  } catch (e) {
    console.error("PATCH /api/themes/:id/pointvalue", e);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /api/themes/:id  manager only
router.delete("/:id", manageGuard, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM subthemes WHERE theme_id = $1`, [id]);
    const del = await pool.query(`DELETE FROM themes WHERE id = $1`, [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.sendStatus(204);
  } catch (e) {
    console.error("DELETE /api/themes/:id", e);
    res.status(500).json({ error: "internal error" });
  }
});

// DELETE /api/themes/subthemes/:id  manager only
router.delete("/subthemes/:id", manageGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const del = await pool.query(`DELETE FROM subthemes WHERE id = $1`, [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.sendStatus(204);
  } catch (e) {
    console.error("DELETE /api/themes/subthemes/:id", e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
