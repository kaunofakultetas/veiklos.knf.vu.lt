import { Router } from "express";
import { pool } from "../db/pool.js";
import { verifySamlSession } from "../auth/verifySamlSession.js";
import { attachRoles } from "../auth/attachRoles.js";
import { TBL_USERS } from "../db/tables.js";

const router = Router();

router.get("/check", verifySamlSession, attachRoles, async (req, res) => {
  try {
    const { rows: [user] } = await pool.query(
      `SELECT oid, email, full_name, created_at, last_login_at FROM ${TBL_USERS} WHERE oid = $1`,
      [req.user.oid]
    );
    res.json({
      user,
      roles: req.user.roles.map((name) => ({ name })),
    });
  } catch (e) {
    console.error("session/check error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
