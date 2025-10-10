// services/mailer.js
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import nodemailer from "nodemailer";
import fs from "fs";

// ========== ENV ==========
const MAIL_PROVIDER = String(process.env.MAIL_PROVIDER || "").toLowerCase(); // '' | 'resend'
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

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

// ========== SMTP helpers ==========
let transporterSingleton = null;

function makeTransport({ secure, port }) {
  if (!HOST || !port || !USER || !PASS) {
    throw new Error(
      "[mailer] Faltan vars MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASS"
    );
  }
  return nodemailer.createTransport({
    host: HOST,
    port,
    secure, // 465=true, 587=false
    auth: { user: USER, pass: PASS },

    pool: true,
    maxConnections: 2,
    maxMessages: 50,

    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,

    requireTLS: !secure,
    tls: { rejectUnauthorized: false, servername: HOST },

    logger: DEBUG,
    debug: DEBUG,
    name: "techventuresco-backend",
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

// ========== RESEND (HTTP) ==========
/** Convierte attachments (con path o content Buffer) a formato Resend (base64). */
function mapAttachmentsForResend(attachments) {
  if (!attachments || !attachments.length) return undefined;
  return attachments.map((a) => {
    let contentBase64 = null;
    if (a.content && Buffer.isBuffer(a.content)) {
      contentBase64 = a.content.toString("base64");
    } else if (a.path) {
      const buf = fs.readFileSync(a.path);
      contentBase64 = buf.toString("base64");
    } else if (typeof a.content === "string") {
      contentBase64 = Buffer.from(a.content, "utf8").toString("base64");
    }
    return {
      filename: a.filename || "attachment",
      content: contentBase64,
    };
  });
}

async function sendViaResend({
  to,
  subject,
  html,
  text,
  cc,
  bcc,
  attachments,
  headers,
}) {
  if (!RESEND_API_KEY) {
    throw new Error("[mailer] RESEND_API_KEY no configurado");
  }
  const payload = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
    cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
    reply_to: REPLY_TO || undefined,
    headers: headers || undefined,
    attachments: mapAttachmentsForResend(attachments), // base64 si hay adjuntos
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`[resend] HTTP ${res.status} ${res.statusText} ${errTxt}`);
  }
  const json = await res.json();
  return { messageId: json?.id || null, provider: "resend" };
}

// ========== API unificada ==========
/** Envío directo (lanza error si falla). SMTP → fallback 465 → Resend */
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

  // Forzar Resend si lo indicaste por env
  if (MAIL_PROVIDER === "resend") {
    return await sendViaResend({
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      attachments,
      headers,
    });
  }

  // SMTP primario
  try {
    const primary = ensureTransporter();
    const info = await primary.sendMail({
      from: FROM,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      replyTo: REPLY_TO,
      headers: { "X-App": "TechVenturesCO Scheduler", ...(headers || {}) },
      attachments,
    });
    return info;
  } catch (err) {
    const canFallback465 =
      !SECURE && Number(PORT) === 587 && isTimeoutOrConnErr(err);
    if (canFallback465) {
      try {
        const t2 = makeTransport({ secure: true, port: 465 });
        const info2 = await t2.sendMail({
          from: FROM,
          to,
          cc,
          bcc,
          subject,
          html,
          text,
          replyTo: REPLY_TO,
          headers: { "X-App": "TechVenturesCO Scheduler", ...(headers || {}) },
          attachments,
        });
        console.warn("[mailer] Fallback 465/SSL exitoso para:", subject);
        return info2;
      } catch (err2) {
        console.error(
          "[mailer] Fallback 465/SSL falló:",
          err2?.message || err2
        );
        if (RESEND_API_KEY) {
          console.warn("[mailer] Cambiando a Resend por fallo SMTP…");
          return await sendViaResend({
            to,
            subject,
            html,
            text,
            cc,
            bcc,
            attachments,
            headers,
          });
        }
        throw err2;
      }
    }
    if (RESEND_API_KEY) {
      console.warn("[mailer] SMTP falló; enviando por Resend…");
      return await sendViaResend({
        to,
        subject,
        html,
        text,
        cc,
        bcc,
        attachments,
        headers,
      });
    }
    throw err;
  }
}

/** Envío que NUNCA rompe el flujo de la app. */
export async function sendMailSafe(msg) {
  try {
    await sendMail(msg);
    console.log("[mailer] enviado:", msg.subject);
  } catch (e) {
    console.error("[mailer] fallo de envío (no bloquea):", e?.message || e);
  }
}

/** Verifica proveedor de envío. */
export async function verifySMTP() {
  if (MAIL_PROVIDER === "resend") {
    return { ok: true, provider: "resend" };
  }
  try {
    const t = ensureTransporter();
    await t.verify();
    console.log("[mailer] SMTP OK", HOST, PORT, "secure=", SECURE);
    return { ok: true, provider: "smtp" };
  } catch (err) {
    const canFallback465 =
      !SECURE && Number(PORT) === 587 && isTimeoutOrConnErr(err);
    console.warn("[mailer] verifySMTP primario:", String(err?.message || err));
    if (canFallback465) {
      try {
        const t2 = makeTransport({ secure: true, port: 465 });
        await t2.verify();
        console.log("[mailer] SMTP OK por fallback 465/SSL");
        return { ok: true, provider: "smtp-465" };
      } catch (err2) {
        console.warn(
          "[mailer] verifySMTP fallback:",
          String(err2?.message || err2)
        );
        if (RESEND_API_KEY) return { ok: true, provider: "resend" };
        return { ok: false, error: String(err2?.message || err2) };
      }
    }
    if (RESEND_API_KEY) return { ok: true, provider: "resend" };
    return { ok: false, error: String(err?.message || err) };
  }
}

export default { sendMail, sendMailSafe, verifySMTP };
