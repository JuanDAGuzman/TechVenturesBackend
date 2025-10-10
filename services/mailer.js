// services/mailer.js
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import nodemailer from "nodemailer";

/**
 * Variables esperadas (Railway):
 * MAIL_HOST=smtp.gmail.com
 * MAIL_PORT=587           // 587 STARTTLS (recomendado)  ó 465 SSL directo
 * MAIL_USER=techventuresco@gmail.com
 * MAIL_PASS=<APP_PASSWORD_16C>
 * MAIL_FROM="TechVenturesCO <techventuresco@gmail.com>"
 * MAIL_SECURE=false       // true solo si usas 465
 *
 * Opcional:
 * MAIL_REPLY_TO=soporte@tu-dominio.com
 * MAIL_DEBUG=true         // habilita logs SMTP detallados
 */
const HOST = process.env.MAIL_HOST || "smtp.gmail.com";
const PORT = Number(process.env.MAIL_PORT || 587);
const USER = process.env.MAIL_USER;
const PASS = process.env.MAIL_PASS;
const SECURE =
  String(process.env.MAIL_SECURE ?? "false").toLowerCase() === "true";
const DEBUG =
  String(process.env.MAIL_DEBUG ?? "false").toLowerCase() === "true";

const FROM =
  process.env.MAIL_FROM ||
  (USER
    ? `"TechVenturesCO" <${USER}>`
    : `"TechVenturesCO" <no-reply@localhost>`);

const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

let transporterSingleton = null;

/* ------------------------ helpers ------------------------ */
function makeTransport({ secure, port }) {
  if (!HOST || !port || !USER || !PASS) {
    throw new Error(
      "[mailer] Faltan vars MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS"
    );
  }

  // Pool + timeouts altos para PaaS; STARTTLS forzado cuando secure=false
  return nodemailer.createTransport({
    host: HOST,
    port,
    secure, // 465=true (SSL), 587=false (STARTTLS)
    auth: { user: USER, pass: PASS },

    pool: true,
    maxConnections: 2,
    maxMessages: 50,

    // timeouts generosos para handshake/red PaaS
    connectionTimeout: 20_000, // hasta conectar socket
    greetingTimeout: 15_000, // hasta banner 220
    socketTimeout: 30_000, // inactividad I/O

    requireTLS: !secure, // fuerza STARTTLS cuando no es SSL puro
    tls: {
      // en contenedores a veces la CA falla; mantenlo permisivo
      rejectUnauthorized: false,
      // SNI explícito
      servername: HOST,
    },

    // logging opcional
    logger: DEBUG,
    debug: DEBUG,
    name: "techventuresco-backend", // EHLO name
  });
}

function ensureTransporter() {
  if (transporterSingleton) return transporterSingleton;
  transporterSingleton = makeTransport({ secure: SECURE, port: PORT });
  return transporterSingleton;
}

function isTimeoutOrConnErr(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("connection closed") ||
    msg.includes("unable to establish") ||
    msg.includes("connect e")
  );
}

/* ------------------------ API ------------------------ */
/** Envío directo (lanza error si falla). Con fallback 587→465 si aplica. */
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
  if (!to) throw new Error("[sendMail] 'to' es requerido");
  if (!subject) throw new Error("[sendMail] 'subject' es requerido");
  if (!html && !text) throw new Error("[sendMail] 'html' o 'text' requerido");

  const primary = ensureTransporter();

  try {
    const info = await primary.sendMail({
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
      attachments,
    });
    return info;
  } catch (err) {
    // Fallback automático: si estamos en 587/STARTTLS y hay timeout/conexión,
    // reintenta una sola vez por 465/SSL.
    const canFallback =
      !SECURE && Number(PORT) === 587 && isTimeoutOrConnErr(err);
    if (canFallback) {
      try {
        const fallback = makeTransport({ secure: true, port: 465 });
        const info2 = await fallback.sendMail({
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
          attachments,
        });
        console.warn("[mailer] Fallback 465/SSL exitoso para:", subject);
        return info2;
      } catch (err2) {
        console.error(
          "[mailer] Fallback 465/SSL falló:",
          err2?.message || err2
        );
        throw err2;
      }
    }
    throw err;
  }
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

/** Verifica conexión SMTP (con fallback si 587 falla). */
export async function verifySMTP() {
  try {
    const t = ensureTransporter();
    await t.verify();
    console.log("[mailer] SMTP OK", HOST, PORT, "secure=", SECURE);
    return { ok: true };
  } catch (err) {
    const canFallback =
      !SECURE && Number(PORT) === 587 && isTimeoutOrConnErr(err);
    console.warn("[mailer] verifySMTP primario:", String(err?.message || err));

    if (canFallback) {
      try {
        const t2 = makeTransport({ secure: true, port: 465 });
        await t2.verify();
        console.log("[mailer] SMTP OK por fallback 465/SSL");
        // Nota: no reemplazamos el singleton global (seguimos usando el primario),
        // el fallback existe solo para verificación puntual.
        return { ok: true, fallback: "465" };
      } catch (err2) {
        console.warn(
          "[mailer] verifySMTP fallback:",
          String(err2?.message || err2)
        );
        return { ok: false, error: String(err2?.message || err2) };
      }
    }

    return { ok: false, error: String(err?.message || err) };
  }
}

export default { sendMail, sendMailSafe, verifySMTP };
