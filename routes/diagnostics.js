// routes/diagnostics.js
import express from "express";
import net from "net";
import dns from "dns/promises";
import { verifySMTP, sendMailSafe } from "../services/mailer.js";

const router = express.Router();

router.get("/mail/verify", async (_req, res) => {
  const r = await verifySMTP();
  res.status(r.ok ? 200 : 500).json(r);
});

router.post("/mail/test", async (req, res) => {
  const to = (process.env.MAIL_NOTIFY || process.env.MAIL_USER || "")
    .split(",")[0]
    ?.trim();
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

router.get("/dns", async (req, res) => {
  const host = (req.query.host || "smtp.gmail.com").trim();
  try {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
    ]);
    res.json({
      ok: true,
      host,
      ipv4: v4.status === "fulfilled" ? v4.value : [],
      ipv6: v6.status === "fulfilled" ? v6.value : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/tcp", (req, res) => {
  const host = (req.query.host || "smtp.gmail.com").trim();
  const port = Number(req.query.port || 587);
  const timeoutMs = Number(req.query.timeout || 8000);

  const sock = net.createConnection({ host, port, family: 4 }); // fuerza IPv4
  const started = Date.now();

  const done = (ok, error) => {
    try {
      sock.destroy();
    } catch {}
    res.status(ok ? 200 : 500).json({
      ok,
      host,
      port,
      ms: Date.now() - started,
      error: error ? String(error) : undefined,
    });
  };

  sock.on("connect", () => done(true));
  sock.on("error", (err) => done(false, err));
  sock.setTimeout(timeoutMs, () => done(false, "TCP_TIMEOUT"));
});
export default router;
