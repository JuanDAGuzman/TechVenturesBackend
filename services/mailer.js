// services/mailer.js
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import nodemailer from "nodemailer";

/**
 * Variables esperadas (Railway):
 * MAIL_HOST=smtp.gmail.com
 * MAIL_PORT=587
 * MAIL_USER=tu_cuenta@gmail.com
 * MAIL_PASS=APP_PASSWORD_16C
 * MAIL_FROM="TechVenturesCO <tu_cuenta@gmail.com>"
 * MAIL_SECURE=false  (importante para 587/STARTTLS)
 *
 * Opcional:
 * MAIL_REPLY_TO=soporte@tu-dominio.com
 */
const HOST = process.env.MAIL_HOST || "smtp.gmail.com";
const PORT = Number(process.env.MAIL_PORT || 587);
const USER = process.env.MAIL_USER;
const PASS = process.env.MAIL_PASS;
const SECURE =
  String(process.env.MAIL_SECURE ?? "false").toLowerCase() === "true";

const FROM =
  process.env.MAIL_FROM ||
  (USER
    ? `"TechVenturesCO" <${USER}>`
    : `"TechVenturesCO" <no-reply@localhost>`);

const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

let transporterSingleton = null;

function ensureTransporter() {
  if (transporterSingleton) return transporterSingleton;

  if (!HOST || !PORT || !USER || !PASS) {
    throw new Error(
      "[mailer] Faltan vars MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS"
    );
  }

  // Gmail en 587 -> secure:false + requireTLS:true (STARTTLS).
  // Pool, timeouts, y TLS permisivo para contenedores.
  transporterSingleton = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE, // 465=true (SSL), 587=false (STARTTLS)
    requireTLS: !SECURE, // fuerza STARTTLS cuando no es SSL puro
    auth: { user: USER, pass: PASS },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,

    // AUMENTA timeouts para handshake en PaaS:
    connectionTimeout: 20_000, // 20s
    socketTimeout: 30_000, // 30s

    requireTLS: !SECURE,
    tls: { rejectUnauthorized: false },

    // Ayuda a depurar en logs de Railway:
    logger: true, // imprime eventos SMTP en consola
    debug: true, // añade detalles
  });

  return transporterSingleton;
}

/** Envío directo (lanza error). Úsalo cuando quieras "saber" si falló. */
export async function sendMail({
  to,
  subject,
  html,
  text,
  cc,
  bcc,
  attachments,
  headers,
}) {
  const transporter = ensureTransporter();

  if (!to) throw new Error("[sendMail] 'to' es requerido");
  if (!subject) throw new Error("[sendMail] 'subject' es requerido");
  if (!html && !text) throw new Error("[sendMail] 'html' o 'text' requerido");

  const info = await transporter.sendMail({
    from: FROM,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    headers: {
      "X-App": "TechVenturesCO Scheduler",
      ...(headers || {}),
    },
  });

  return info;
}

/**
 * Envío que NUNCA rompe el flujo de la app.
 * Loguea si falla y continúa. Úsalo en endpoints que primero deben responder.
 */
export async function sendMailSafe(msg) {
  try {
    await sendMail(msg);
    console.log("[mailer] enviado:", msg.subject);
  } catch (e) {
    console.error("[mailer] fallo de envío (no bloquea):", e?.message || e);
  }
}

/** Verifica conexión SMTP (útil al arrancar, solo log). */
export async function verifySMTP() {
  try {
    const t = ensureTransporter();
    await t.verify();
    console.log("[mailer] SMTP OK");
    return { ok: true };
  } catch (err) {
    console.warn("[mailer] verifySMTP:", String(err?.message || err));
    return { ok: false, error: String(err?.message || err) };
  }
}

export default { sendMail, sendMailSafe, verifySMTP };
