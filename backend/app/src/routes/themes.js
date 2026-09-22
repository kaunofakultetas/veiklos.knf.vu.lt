// -----------------------------------------------------------
//  [*] Routes — /api/themes
//
//    GET    /api/themes                       — tree of themes + subthemes
//    POST   /api/themes                       — create theme        (manager)
//    PATCH  /api/themes/:id                   — edit code/title     (manager)
//    POST   /api/themes/:themeId/subthemes    — create subtheme     (manager)
//    PATCH  /api/themes/subthemes/:id         — edit subtheme       (manager)
//    PATCH  /api/themes/subthemes/:id/cap     — set subtheme limit  (committee)
//    PATCH  /api/themes/:id/total-sum         — set theme budget    (committee)
//    PATCH  /api/themes/:id/pointvalue        — set point value     (committee)
//    DELETE /api/themes/:id                   — delete theme + subthemes (manager)
//    DELETE /api/themes/subthemes/:id         — delete subtheme     (manager)
//
//  The theme/subtheme catalog. Managers own the structure
//  (codes, titles); the committee owns the numbers (caps,
//  budgets, point values). Reading is open to any signed-in
//  user regardless of active role.
//
//  The /subthemes/... paths live under this router (not a
//  separate /api/subthemes) — they never collide with the
//  ":id" theme patterns because the segment counts differ.
//
//  Used by:
//    - manager/themes.jsx — structure CRUD
//    - committee/limits.jsx — caps and total sums
//    - committee/calculate.jsx — point values
//    - every page that renders theme dropdowns (see GET /)
// -----------------------------------------------------------

import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { attachRoles } from "../auth/attachRoles.js";
import { requireActiveRoleIn } from "../auth/requireActiveRole.js";


const router = Router();

// Guard chains: reading only needs a valid JWT; writes are
// split by active role between manager and committee
const readGuard = [verifySamlSession, attachRoles];
const manageGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Vadybininkas"])];
const committeeGuard = [verifySamlSession, attachRoles, requireActiveRoleIn(["Komisijos narys"])];







// -----------------------------------------------------------
// GET /api/themes
// -----------------------------------------------------------
//
// The whole catalog as a tree: each theme (with total_sum and
// pointvalue) carrying its subthemes (with cap), both sorted
// by code. Assembled in JS from two flat queries.
//
// Used by:
//   - employee/newActivity.jsx, employee/myActivities.jsx,
//     employee/export.jsx — theme/subtheme dropdowns
//   - manager/themes.jsx, manager/review.jsx,
//     manager/export.jsx
//   - committee/limits.jsx, committee/results.jsx
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// POST /api/themes
// -----------------------------------------------------------
//
// Body: { code, title }, both trimmed. 409 on a duplicate
// code (unique violation 23505).
//
// Used by:
//   - manager/themes.jsx — "Pridėti temą" form
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// PATCH /api/themes/:id
// -----------------------------------------------------------
//
// Partial update of code/title — other body keys are silently
// ignored, an update with none of the allowed keys is a 400.
//
// Used by:
//   - nothing calls this at the moment — the themes admin
//     page only creates and deletes
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// POST /api/themes/:themeId/subthemes
// -----------------------------------------------------------
//
// Body: { code, title, description? }. 409 on a duplicate
// subtheme code.
//
// Used by:
//   - manager/themes.jsx — "Pridėti potemę" form
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// PATCH /api/themes/subthemes/:id
// -----------------------------------------------------------
//
// Partial update of a subtheme's code/title/description —
// same shape as the theme PATCH above.
//
// Used by:
//   - nothing calls this at the moment — the themes admin
//     page only creates and deletes
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// PATCH /api/themes/subthemes/:id/cap
// -----------------------------------------------------------
//
// Body: { cap } — the committee's score limit for one
// subtheme; must be a non-negative number. Zero is allowed
// and means "no points can count here".
//
// Used by:
//   - committee/limits.jsx — the cap column
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// PATCH /api/themes/:id/total-sum
// -----------------------------------------------------------
//
// Body: { total_sum } — the money budget allocated to a
// theme; non-negative number. Feeds the point-value math on
// the committee's calculate page.
//
// Used by:
//   - committee/limits.jsx — the total-sum column
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// PATCH /api/themes/:id/pointvalue
// -----------------------------------------------------------
//
// Body: { pointvalue } — euros per point for a theme;
// non-negative number. The calculate page computes it
// (total_sum / capped points) and stores it here so results
// pages can reuse it.
//
// Used by:
//   - committee/calculate.jsx — "Išsaugoti balo vertę"
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// DELETE /api/themes/:id
// -----------------------------------------------------------
//
// Deletes a theme and its subthemes. A theme with activities
// still attached refuses with a 409 up front — friendlier
// than the FK error the delete would otherwise hit. The
// cascade is manual (subthemes, then the theme) but runs in
// one transaction on a dedicated client: an unknown theme
// rolls the subtheme delete back and answers 404, any error
// rolls back and answers 500.
//
// Used by:
//   - manager/themes.jsx — theme delete button
// -----------------------------------------------------------

router.delete("/:id", manageGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const linked = await pool.query(
      `SELECT 1 FROM activities WHERE theme_id = $1 LIMIT 1`,
      [id]
    );
    if (linked.rowCount > 0)
      return res.status(409).json({ error: "Klaida: negalima ištrinti temos, nes yra su ja susietų veiklų." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM subthemes WHERE theme_id = $1`, [id]);
      const del = await client.query(`DELETE FROM themes WHERE id = $1`, [id]);
      if (del.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not found" });
      }
      await client.query("COMMIT");
      res.sendStatus(204);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("DELETE /api/themes/:id", e);
    res.status(500).json({ error: "internal error" });
  }
});







// -----------------------------------------------------------
// DELETE /api/themes/subthemes/:id
// -----------------------------------------------------------
//
// Deletes one subtheme; fails on the FK if activities still
// reference it.
//
// Used by:
//   - manager/themes.jsx — subtheme delete button
// -----------------------------------------------------------

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
