// routes/diagnostics.js
import express from "express";
import { verifySMTP, sendMailSafe } from "../services/mailer.js";

const router = express.Router();

router.get("/mail/verify", async (_req, res) => {
  const r = await verifySMTP();
  res.status(r.ok ? 200 : 500).json(r);
});

router.post("/mail/test", async (req, res) => {
  const to = (process.env.MAIL_NOTIFY || process.env.MAIL_USER || "").split(",")[0]?.trim();
  if (!to) return res.status(400).json({ ok: false, error: "NO_NOTIFY_EMAIL" });

  // No bloquea la respuesta
  sendMailSafe({
    to,
    subject: "TechVenturesCO · Test SMTP",
    text: "Prueba de transporte SMTP desde Railway.",
    html: "<p>Prueba de transporte SMTP desde Railway.</p>",
  });

  res.json({ ok: true, sent: true, to });
});

export default router;
