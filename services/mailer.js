// services/mailer.js
import nodemailer from "nodemailer";

/**
 * Soporta ambas convenciones de vars:
 * - Preferencia: MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS/MAIL_FROM/MAIL_SECURE
 * - Alternativa: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_SECURE
 */
const HOST = process.env.MAIL_HOST || process.env.SMTP_HOST;
const PORT = Number(process.env.MAIL_PORT || process.env.SMTP_PORT || 587);
const USER = process.env.MAIL_USER || process.env.SMTP_USER;
const PASS = process.env.MAIL_PASS || process.env.SMTP_PASS;
const SECURE =
  String(
    process.env.MAIL_SECURE ??
      process.env.SMTP_SECURE ??
      (PORT === 465 ? "true" : "false")
  ).toLowerCase() === "true";

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
      "[mailer] Faltan variables SMTP/MAIL (MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS)"
    );
  }

  transporterSingleton = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE, // true: 465 SSL, false: 587 STARTTLS
    auth: { user: USER, pass: PASS },
  });

  return transporterSingleton;
}

/**
 * Envío genérico.
 * Uso: sendMail({ to, subject, html, text })
 */
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
  if (!html && !text)
    throw new Error("[sendMail] 'html' o 'text' requerido al menos uno");

  const info = await transporter.sendMail({
    from: FROM,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    attachments,
    headers: {
      "X-App": "TechVenturesCO Scheduler",
      ...(headers || {}),
    },
  });

  return info;
}

/** Verifica conexión SMTP (opcional al arrancar el server). */
export async function verifySMTP() {
  const transporter = ensureTransporter();
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export default { sendMail, verifySMTP };
