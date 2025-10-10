// services/mailer.js
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import fs from "fs";

// Opcional (solo si dejas Resend como fallback)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

// ===== ENV =====
const MAIL_PROVIDER = String(process.env.MAIL_PROVIDER || "").toLowerCase(); // 'gmailapi' | 'resend' | ''
const FROM = process.env.MAIL_FROM || `"TechVenturesCO" <no-reply@localhost>`;
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";

const DEBUG =
  String(process.env.MAIL_DEBUG ?? "false").toLowerCase() === "true";

// ===== Utiles =====
function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const CRLF = "\r\n";

function encodeSubjectUtf8B(s = "") {
  // "=?UTF-8?B?...?="  (encoded-word para encabezados no ASCII)
  return `=?UTF-8?B?${Buffer.from(String(s), "utf8").toString("base64")}?=`;
}

function b64utf8(s = "") {
  return Buffer.from(String(s), "utf8").toString("base64");
}

function buildMime({
  from,
  to,
  cc,
  bcc,
  subject,
  text,
  html,
  replyTo,
  attachments,
}) {
  const boundary = "----=_Part_TechVent_" + Date.now();

  const headers = [];
  headers.push(`From: ${from}`);
  headers.push(`To: ${Array.isArray(to) ? to.join(", ") : to}`);
  if (cc) headers.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
  if (bcc) headers.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(", ") : bcc}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  // 👇 Subject codificado (evita mojibake)
  headers.push(`Subject: ${encodeSubjectUtf8B(subject || "")}`);
  headers.push(`MIME-Version: 1.0`);

  const hasAttachments = attachments && attachments.length > 0;

  if (!hasAttachments) {
    // multipart/alternative (texto + html)
    if (html && text) {
      headers.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"${CRLF}`
      );

      const body = [
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        b64utf8(text),
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        b64utf8(html),
        `--${boundary}--`,
        ``,
      ].join(CRLF);

      return headers.join(CRLF) + CRLF + CRLF + body;
    }

    // Solo html
    if (html) {
      headers.push(
        `Content-Type: text/html; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``
      );
      return headers.join(CRLF) + CRLF + CRLF + b64utf8(html);
    }

    // Solo texto
    headers.push(
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``
    );
    return headers.join(CRLF) + CRLF + CRLF + b64utf8(text || "");
  }

  // Con adjuntos (multipart/mixed + multipart/alternative dentro)
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}`);

  const parts = [];
  const altBoundary = boundary + "_alt";

  // Parte alternativa (texto / html)
  parts.push(`--${boundary}`);
  parts.push(
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``
  );

  // text
  parts.push(`--${altBoundary}`);
  parts.push(`Content-Type: text/plain; charset=UTF-8`);
  parts.push(`Content-Transfer-Encoding: base64`, ``);
  parts.push(b64utf8(text || ""));

  // html
  if (html) {
    parts.push(`--${altBoundary}`);
    parts.push(`Content-Type: text/html; charset=UTF-8`);
    parts.push(`Content-Transfer-Encoding: base64`, ``);
    parts.push(b64utf8(html));
  }
  parts.push(`--${altBoundary}--`, ``);

  // adjuntos (ya los tenías en base64, lo dejamos igual)
  for (const a of attachments || []) {
    let content = null;
    if (a.content && Buffer.isBuffer(a.content)) {
      content = a.content.toString("base64");
    } else if (a.path) {
      content = fs.readFileSync(a.path).toString("base64");
    } else if (typeof a.content === "string") {
      content = Buffer.from(a.content, "utf8").toString("base64");
    } else {
      continue;
    }

    parts.push(`--${boundary}`);
    parts.push(
      `Content-Type: ${a.contentType || "application/octet-stream"}; name="${
        a.filename || "attachment"
      }"`
    );
    parts.push(`Content-Transfer-Encoding: base64`);
    parts.push(
      `Content-Disposition: attachment; filename="${
        a.filename || "attachment"
      }"`,
      ``
    );
    parts.push(content);
    parts.push(``);
  }

  parts.push(`--${boundary}--`, ``);

  return headers.join(CRLF) + CRLF + CRLF + parts.join(CRLF);
}

async function fetchGmailAccessToken() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error(
      "[mailer] Falta GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN"
    );
  }
  const params = new URLSearchParams();
  params.set("client_id", GMAIL_CLIENT_ID);
  params.set("client_secret", GMAIL_CLIENT_SECRET);
  params.set("refresh_token", GMAIL_REFRESH_TOKEN);
  params.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`[gmail] token HTTP ${res.status} ${res.statusText} ${t}`);
  }
  const json = await res.json();
  if (DEBUG) console.log("[gmail] token ok, exp:", json.expires_in);
  return json.access_token;
}

async function sendViaGmailAPI({
  to,
  subject,
  html,
  text,
  cc,
  bcc,
  attachments,
  headers,
}) {
  const accessToken = await fetchGmailAccessToken();
  const raw = buildMime({
    from: FROM,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    replyTo: REPLY_TO,
    attachments,
  });
  const body = { raw: toBase64Url(raw) };

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(
      `[gmail] send HTTP ${res.status} ${res.statusText} ${errTxt}`
    );
  }
  const json = await res.json();
  return { messageId: json.id || null, provider: "gmailapi" };
}

// ===== Resend (opcional, solo si pones RESEND_API_KEY) =====
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
    return { filename: a.filename || "attachment", content: contentBase64 };
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
  if (!RESEND_API_KEY)
    throw new Error("[mailer] RESEND_API_KEY no configurado");
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
    attachments: mapAttachmentsForResend(attachments),
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

// ===== API unificada =====
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

  if (MAIL_PROVIDER === "gmailapi") {
    return await sendViaGmailAPI({
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

  // Si alguien deja MAIL_PROVIDER vacío, intentamos Gmail API y luego Resend si existe
  try {
    return await sendViaGmailAPI({
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      attachments,
      headers,
    });
  } catch (e) {
    if (RESEND_API_KEY)
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
    throw e;
  }
}

export async function sendMailSafe(msg) {
  try {
    await sendMail(msg);
    console.log("[mailer] enviado:", msg.subject);
  } catch (e) {
    console.error("[mailer] fallo de envío (no bloquea):", e?.message || e);
  }
}

export async function verifySMTP() {
  if (MAIL_PROVIDER === "gmailapi") return { ok: true, provider: "gmailapi" };
  if (MAIL_PROVIDER === "resend")
    return { ok: !!RESEND_API_KEY, provider: "resend" };
  return { ok: false, error: "MAIL_PROVIDER no configurado" };
}

export default { sendMail, sendMailSafe, verifySMTP };
