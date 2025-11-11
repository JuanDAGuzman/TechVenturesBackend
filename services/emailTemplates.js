import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "America/Bogota";

const BRAND = {
  indigo: "#6D28D9",
  indigoDark: "#5B21B6",
  ring: "rgba(99,102,241,0.35)",
  text: "#0f172a",
  muted: "#475569",
  border: "#e2e8f0",
  bg: "#ffffff",
  badgeTryout: "#EEF2FF",
  badgePickup: "#EFF6FF",
  badgeShip: "#ECFDF5",
};

function fmtApptLocal(appt) {
  const base = appt.start_time
    ? `${appt.date} ${String(appt.start_time).slice(0, 5)}`
    : `${appt.date} 00:00`;
  return dayjs
    .tz(base, "YYYY-MM-DD HH:mm", TZ)
    .format("ddd DD/MM/YYYY — h:mm a");
}

function fmtCreatedLocal(appt) {
  const src = appt.created_at ? appt.created_at : `${appt.date} 00:00`;
  const fmt = appt.created_at ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD HH:mm";
  return dayjs.tz(src, fmt, TZ).format("ddd DD/MM/YYYY — h:mm a");
}

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
function apptMinutes(appt) {
  if (appt?.minutes != null) return Number(appt.minutes);
  return minutesBetween(appt?.start_time, appt?.end_time);
}
function typeLabelWithMinutes(type, appt) {
  const m = apptMinutes(appt);
  if (type === "TRYOUT") return `Ensayo presencial${m ? ` (${m} min)` : ""}`;
  if (type === "PICKUP") return `Sin ensayo${m ? ` (${m} min)` : ""}`;
  return "Envío (no contraentrega)";
}

function formatTimeRange(start, end) {
  if (!start || !end) return "—";
  return `${start} – ${end}`;
}

function typeBadge(type) {
  if (type === "TRYOUT") return "Ensayo presencial (15 min)";
  if (type === "PICKUP") return "Sin ensayo (15 min)";
  return "Envío (no contraentrega)";
}

function header(dateStr = "") {
  return `
  <tr>
    <td style="padding:16px 20px;border-bottom:4px solid #6d28d9">
      <div style="font-weight:800;font-size:20px;color:#0f172a">TechVenturesCO</div>
      <div style="font-size:12px;color:#64748b">${new Date().toLocaleDateString()}</div>
    </td>
  </tr>`;
}

function tableRow(label, value) {
  return `
  <tr>
    <td style="width:180px;background:#f8fafc;border-right:1px solid #e2e8f0;font-weight:700;color:#334155">${esc(
      label
    )}</td>
    <td>${value == null || value === "" ? "—" : esc(String(value))}</td>
  </tr>`;
}

function layout({ title, preheader, bodyHtml }) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${escapeHtml(title)}</title>
  <style>
    /* Small helpers inline-safe */
    @media (max-width: 620px) {
      .container { width: 100% !important; }
      .content { padding: 16px !important; }
      .btn { width: 100% !important; }
    }
    a{ color:${BRAND.indigo}; text-decoration:none; }
  </style>
</head>
<body style="margin:0;background:#f8fafc;color:${BRAND.text};">
  <span style="display:none!important;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;">
    ${escapeHtml(preheader || "")}
  </span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:24px;">
        <table class="container" role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;background:${
          BRAND.bg
        };border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:4px;background:${BRAND.indigo};"></td>
          </tr>
          <tr>
            <td class="content" style="padding:24px;">
              <!-- Header -->
              <table role="presentation" width="100%">
                <tr>
                  <td style="font-weight:800;font-size:20px;line-height:1.2;">
                    TechVenturesCO
                  </td>
                  <td align="right" style="font-size:12px;color:${
                    BRAND.muted
                  };">
                    ${new Date().toLocaleDateString("es-CO")}
                  </td>
                </tr>
              </table>

              ${bodyHtml}

              <hr style="border:none;border-top:1px solid ${
                BRAND.border
              };margin:24px 0;" />
              <p style="margin:0;color:${
                BRAND.muted
              };font-size:12px;line-height:1.5;">
                Este correo se envió automáticamente desde TechVenturesCO. 
                Si recibiste este mensaje por error, ignóralo.
              </p>
            </td>
          </tr>
          <tr><td style="height:12px;"></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

function badge({ text, tone = "indigo" }) {
  const map = {
    indigo: { bg: BRAND.badgeTryout, color: BRAND.indigo },
    blue: { bg: BRAND.badgePickup, color: "#2563EB" },
    green: { bg: BRAND.badgeShip, color: "#059669" },
  };
  const c = map[tone] || map.indigo;
  return `<span style="display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px;background:${
    c.bg
  };color:${c.color};">${escapeHtml(text)}</span>`;
}

function row(label, value) {
  return `
  <tr>
    <td style="padding:10px 12px;border:1px solid ${
      BRAND.border
    };border-right:none;font-weight:600;color:${
    BRAND.muted
  };width:40%;">${escapeHtml(label)}</td>
    <td style="padding:10px 12px;border:1px solid ${
      BRAND.border
    };">${escapeHtml(value || "-")}</td>
  </tr>
  `.trim();
}

function box(contentHtml) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.border};border-radius:12px;">
    ${contentHtml}
  </table>
  `.trim();
}

function fmtCOP(n) {
  if (n == null || n === "") return "-";
  const v = Number(n);
  if (Number.isNaN(v)) return "-";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(v);
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtHour(hhmm, date) {
  const d = dayjs(`${date} ${hhmm}`);
  const suf = d.format("A") === "AM" ? "a. m." : "p. m.";
  return `${d.format("hh:mm")} ${suf}`;
}
function fmtRange(start, end, date) {
  const s = fmtHour(start, date);
  const e = fmtHour(end, date);
  const same =
    (s.endsWith("a. m.") && e.endsWith("a. m.")) ||
    (s.endsWith("p. m.") && e.endsWith("p. m."));
  if (same) return `${s.replace(/ (a\. m\.|p\. m\.)$/, "")} – ${e}`;
  return `${s} – ${e}`;
}

export function buildReminderEmail(appt, { minutesLeft } = {}) {
  const m = apptMinutes(appt) || 15;
  const methodLabel =
    appt.type_code === "TRYOUT"
      ? `Ensayo presencial (${m} min)`
      : `Sin ensayo (${m} min)`;
  const isVisit = appt.type_code === "TRYOUT" || appt.type_code === "PICKUP";
  const date = appt.date;
  const time = appt.start_time ? `${appt.start_time} – ${appt.end_time}` : "—";

  let etaLabel = "~1 hora";
  if (typeof minutesLeft === "number") {
    if (minutesLeft <= 10) etaLabel = "en breve";
    else if (minutesLeft <= 40) etaLabel = "~30 minutos";
    else etaLabel = "~1 hora";
  }

  const subject = `Recordatorio: tu cita hoy a las ${
    appt.start_time || ""
  } — TechVenturesCO`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;color:#0f172a">
    <div style="height:4px;background:#6d28d9;border-radius:2px"></div>
    <h1 style="margin:16px 0 4px;font-size:22px;">TechVenturesCO</h1>
    <h2 style="margin:0 0 16px;font-size:20px;">Recordatorio de tu cita</h2>

    ${
      isVisit
        ? `<span style="display:inline-block;background:#eef2ff;color:#3730a3;font-weight:700;border-radius:999px;padding:6px 10px;font-size:12px">${methodLabel}</span>`
        : ""
    }

    <table style="width:100%;margin-top:16px;border-collapse:collapse;border:1px solid #e2e8f0">
      <tr>
        <td style="width:160px;background:#f8fafc;border-right:1px solid #e2e8f0;padding:10px">Fecha</td>
        <td style="padding:10px">${date}</td>
      </tr>
      <tr>
        <td style="background:#f8fafc;border-right:1px solid #e2e8f0;padding:10px">Horario</td>
        <td style="padding:10px">${time}</td>
      </tr>
      <tr>
        <td style="background:#f8fafc;border-right:1px solid #e2e8f0;padding:10px">Estado</td>
        <td style="padding:10px">CONFIRMADA</td>
      </tr>
    </table>

    <div style="margin-top:16px">
      <p style="margin:0 0 8px"><b>Te esperamos ${etaLabel}.</b></p>
      ${
        appt.type_code === "TRYOUT"
          ? `<ul style="margin:8px 0 0 20px;line-height:1.45">
               <li>Llega unos minutos antes para aprovechar el bloque de ${m} min.</li>
               <li>Si quieres, trae tu equipo; también tenemos equipo de prueba.</li>
             </ul>`
          : `<ul style="margin:8px 0 0 20px;line-height:1.45">
               <li>Te enviaremos los videos de prueba antes de la entrega.</li>
               <li>Ten listo tu medio de pago.</li>
             </ul>`
      }
    </div>
    <p style="margin-top:16px;color:#64748b;font-size:12px">Este correo se envió automáticamente. Si recibiste este mensaje por error, ignóralo.</p>
  </div>`.trim();

  const text = `Recordatorio: cita ${methodLabel} el ${date} ${time}. Te esperamos ${etaLabel}.`;

  return { subject, html, text };
}

export function buildShippedEmail(appt, opts = {}) {
  const {
    trackingNumber = null,
    publicUrl = null,
    shippingCost = null,
    rideUrl = null,
    adminCopy = false,
  } = opts;

  const isPicap = String(appt.shipping_carrier || "").toUpperCase() === "PICAP";

  const BASE_URL =
    process.env.PUBLIC_URL ||
    process.env.BASE_URL ||
    "https://techventuresbackend-production.up.railway.app";
  const fullGuideUrl = publicUrl ? `${BASE_URL}${publicUrl}` : null;

  const subject = adminCopy
    ? `Copia — ¡Tu paquete ha sido enviado!`
    : "¡Tu paquete ha sido enviado!";

  let trackingInfo = "";

  if (isPicap && rideUrl) {
    trackingInfo = `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Transportadora:</strong>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
          PICAP
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Link del viaje:</strong>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
          <a href="${rideUrl}" style="color: #3b82f6; text-decoration: none;">Ver seguimiento</a>
        </td>
      </tr>
    `;
  } else if (trackingNumber) {
    trackingInfo = `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Número de guía:</strong>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
          ${trackingNumber}
        </td>
      </tr>
    `;

    if (fullGuideUrl) {
      trackingInfo += `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <strong style="color: #374151;">Imagen de la guía:</strong>
          </td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
            <a href="${fullGuideUrl}" style="color: #3b82f6; text-decoration: none;" target="_blank">Ver guía</a>
          </td>
        </tr>
      `;
    }
  }

  if (shippingCost != null) {
    trackingInfo += `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <strong style="color: #374151;">Valor del ${
            isPicap ? "servicio" : "envío"
          }:</strong>
        </td>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
          ${Number(shippingCost).toLocaleString("es-CO", {
            style: "currency",
            currency: "COP",
            maximumFractionDigits: 0,
          })}
        </td>
      </tr>
    `;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">TechVenturesCO</h1>
              <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 16px;">¡Tu paquete ha sido enviado!</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #111827; font-size: 24px; font-weight: 600;">
                ${
                  isPicap
                    ? "Envío (no contraentrega)"
                    : "Envío (no contraentrega)"
                }
              </h2>
              
              <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
                Tu pedido ha sido despachado. ${
                  isPicap
                    ? "Puedes hacer seguimiento de tu viaje usando el link que aparece abajo."
                    : fullGuideUrl
                    ? "Hemos adjuntado la imagen de la guía de envío para que puedas hacer seguimiento."
                    : "Usa el número de guía en el sitio de la transportadora para hacer seguimiento."
                }
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; background-color: #f9fafb; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${trackingInfo}
                    </table>
                  </td>
                </tr>
              </table>

              <div style="margin: 30px 0; padding: 20px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 1.6;">
                  <strong>¿Qué sigue?</strong><br>
                  • Usa el ${
                    isPicap ? "link" : "número de guía"
                  } para hacer seguimiento.<br>
                  ${
                    !isPicap
                      ? "• Al recibir, cancelas el costo del envío/servicio (si aplica)."
                      : ""
                  }
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">
                Este correo se envió automáticamente. Si recibiste este mensaje por error, ignóralo.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} TechVenturesCO — Bogotá, Colombia
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
TechVenturesCO

¡Tu paquete ha sido enviado!

${isPicap ? "Transportadora: PICAP" : `Número de guía: ${trackingNumber}`}
${
  shippingCost != null
    ? `Valor del ${isPicap ? "servicio" : "envío"}: $${Number(
        shippingCost
      ).toLocaleString("es-CO")}`
    : ""
}
${isPicap && rideUrl ? `Link del viaje: ${rideUrl}` : ""}
${!isPicap && fullGuideUrl ? `Ver guía: ${fullGuideUrl}` : ""}

${
  isPicap
    ? "Puedes hacer seguimiento de tu viaje usando el link de arriba."
    : "Usa el número de guía en el sitio de la transportadora para hacer seguimiento."
}

--
Este correo se envió automáticamente.
© ${new Date().getFullYear()} TechVenturesCO
  `;

  return { subject, html, text };
}

export function emailForInPerson(appt) {
  const { type_code, date, start_time, end_time, product, customer_name } =
    appt;

  const isTryout = type_code === "TRYOUT";
  const tone = isTryout ? "indigo" : "blue";
  const typeLabel = typeLabelWithMinutes(type_code, appt);
  const mins = apptMinutes(appt) || 15;

  const title = "Confirmación de cita — TechVenturesCO";
  const preheader = `Tu cita quedó confirmada para el ${dayjs(date).format(
    "YYYY-MM-DD"
  )} entre ${fmtRange(start_time, end_time, date)}.`;

  const bodyHtml = `
    <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;">¡Tu cita fue confirmada!</h1>
    <p style="margin:0 0 16px 0;color:${BRAND.muted};">Hola ${escapeHtml(
    customer_name || ""
  )}, estos son los detalles:</p>

    <div style="margin-bottom:12px;">${badge({ text: typeLabel, tone })}</div>

    ${box(`
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          ${row("Fecha", dayjs(date).format("YYYY-MM-DD"))}
          ${row("Horario", fmtRange(start_time, end_time, date))}
          ${row("Producto (opcional)", product || "-")}
          ${row("Estado", "CONFIRMADA")}
        </table>
      </td></tr>
    `)}

    <div style="height:16px;"></div>

    <p style="margin:0 0 8px 0;font-weight:700;">Indicaciones:</p>
    <ul style="margin:6px 0 0 18px;padding:0;color:${
      BRAND.muted
    };line-height:1.6;">
      ${
        isTryout
          ? `<li>Llega unos minutos antes para aprovechar los <b>${mins} min</b> del bloque.</li>
             <li>Si quieres, trae tu equipo; también tenemos <b>equipo de prueba</b>.</li>`
          : `<li>Validaremos tu producto y te enviaremos <b>videos de prueba</b> antes de la entrega.</li>
             <li>La recogida es dentro del bloque de <b>${mins} min</b> seleccionado.</li>`
      }
      <li>Si no puedes asistir, responde a este correo para reprogramar.</li>
    </ul>
  `;

  const html = layout({ title, preheader, bodyHtml });
  const text = `¡Tu cita fue confirmada!

Tipo: ${typeLabel}
Fecha: ${dayjs(date).format("YYYY-MM-DD")}
Horario: ${fmtRange(start_time, end_time, date)}
Producto: ${product || "-"}
Estado: CONFIRMADA

Si no puedes asistir, responde a este correo para reprogramar.`;

  return {
    subject: "Confirmación de cita — TechVenturesCO",
    html,
    text,
  };
}

export function emailForShipping(appt) {
  const {
    date,
    product,
    customer_name,
    shipping_address,
    shipping_neighborhood,
    shipping_city,
    shipping_carrier,
  } = appt;

  const title = "Confirmación de envío — TechVenturesCO";
  const preheader = `Procesaremos tu envío ${
    product ? `(${product})` : ""
  } y te confirmaremos por correo.`;

  const bodyHtml = `
    <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;">¡Recibimos tus datos de envío!</h1>
    <p style="margin:0 0 16px 0;color:${BRAND.muted};">Hola ${escapeHtml(
    customer_name || ""
  )}, estos son los detalles registrados:</p>

    <div style="margin-bottom:12px;">${badge({
      text: "Envío (no contraentrega)",
      tone: "green",
    })}</div>

    ${box(`
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          ${row("Fecha de solicitud", dayjs(date).format("YYYY-MM-DD"))}
          ${row("Producto", product || "-")}
          ${row("Ciudad", shipping_city || "-")}
          ${row("Dirección", shipping_address || "-")}
          ${row("Barrio", shipping_neighborhood || "-")}
          ${row("Transportadora", shipping_carrier || "-")}
          ${row("Modalidad", "No contraentrega")}
        </table>
      </td></tr>
    `)}

    <div style="height:16px;"></div>

    <p style="margin:0 0 8px 0;font-weight:700;">¿Qué sigue?</p>
    <ul style="margin:6px 0 0 18px;padding:0;color:${
      BRAND.muted
    };line-height:1.6;">
      <li>Te contactaremos para confirmar pago y coordinar la recolección.</li>
      <li>En <b>Bogotá</b> usamos <b>PICAP</b> o <b>INTERRAPIDÍSIMO</b>. Otras ciudades: <b>INTERRAPIDÍSIMO</b>.</li>
      <li>Al recibir, cancela el costo de envío a la transportadora (si aplica).</li>
    </ul>

    <div style="height:12px;"></div>
    <p style="margin:0;color:${
      BRAND.muted
    };font-size:12px;">Si hay un dato incorrecto, responde a este correo con la corrección.</p>
  `;

  const html = layout({ title, preheader, bodyHtml });
  const text = `¡Recibimos tus datos de envío!

Producto: ${product || "-"}
Ciudad: ${shipping_city || "-"}
Dirección: ${shipping_address || "-"}
Barrio: ${shipping_neighborhood || "-"}
Transportadora: ${shipping_carrier || "-"}
Modalidad: No contraentrega

Te contactaremos para confirmar pago y coordinar la recolección.`;

  return {
    subject: "Confirmación de envío — TechVenturesCO",
    html,
    text,
  };
}

export function buildAdminNewAppointmentEmail(appt) {
  const isShipping = appt.type_code === "SHIPPING";
  const typeLabel = typeLabelWithMinutes(appt.type_code, appt);

  const horario =
    appt.start_time && appt.end_time
      ? `${appt.start_time} – ${appt.end_time}`
      : "—";

  const subject = isShipping
    ? `Nuevo envío registrado — ${appt.date}`
    : `Nueva cita programada — ${appt.date}`;

  let rows = `
    ${tableRow("Tipo", typeLabel)}
    ${tableRow("Fecha", appt.date || "-")}
    ${tableRow("Horario", horario)}
    ${tableRow("Estado", appt.status || "CONFIRMED")}
    ${tableRow("Producto", appt.product || "-")}
    ${tableRow("Nombre", appt.customer_name || "-")}
    ${tableRow("Cédula", appt.customer_id_number || "-")}
    ${tableRow("Correo", appt.customer_email || "-")}
    ${tableRow("Celular", appt.customer_phone || "-")}
  `;

  if (isShipping) {
    rows += `
      ${tableRow("Ciudad", appt.shipping_city || "-")}
      ${tableRow("Dirección", appt.shipping_address || "-")}
      ${tableRow("Barrio", appt.shipping_neighborhood || "-")}
      ${tableRow("Transportadora", appt.shipping_carrier || "-")}
      ${tableRow("Modalidad", "No contraentrega")}
    `;
  }

  if (appt.notes) {
    rows += tableRow("Notas", appt.notes);
  }

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(subject)}</title>
</head>
<body style="background:#f8fafc;margin:0;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
    ${header()}
    <tr>
      <td style="padding:20px">
        <h1 style="margin:0 0 12px 0;font-size:22px;color:#0f172a">${esc(
          isShipping ? "Nuevo envío registrado" : "Nueva cita programada"
        )}</h1>

        <div style="display:inline-block;background:${
          isShipping ? "#ecfdf5" : "#eef2ff"
        };color:${
    isShipping ? "#065f46" : "#3730a3"
  };padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px;margin:6px 0 14px 0">
          ${esc(typeLabel)}
        </div>

        <table width="100%" cellspacing="0" cellpadding="10" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate">
          ${rows}
        </table>

        <p style="margin-top:14px;color:#475569;font-size:13px">
          Notificación interna automática.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    isShipping ? "Nuevo envío registrado" : "Nueva cita programada",
    `Tipo: ${typeLabel}`,
    `Fecha: ${appt.date || "-"}`,
    `Horario: ${horario}`,
    `Estado: ${appt.status || "CONFIRMED"}`,
    `Producto: ${appt.product || "-"}`,
    `Nombre: ${appt.customer_name || "-"}`,
    `Cédula: ${appt.customer_id_number || "-"}`,
    `Correo: ${appt.customer_email || "-"}`,
    `Celular: ${appt.customer_phone || "-"}`,
    ...(isShipping
      ? [
          `Ciudad: ${appt.shipping_city || "-"}`,
          `Dirección: ${appt.shipping_address || "-"}`,
          `Barrio: ${appt.shipping_neighborhood || "-"}`,
          `Transportadora: ${appt.shipping_carrier || "-"}`,
          `Modalidad: No contraentrega`,
        ]
      : []),
    `Notas: ${appt.notes || "-"}`,
  ].join("\n");

  return { subject, html, text };
}

export function buildConfirmationEmail(appt) {
  const isShipping = appt.type_code === "SHIPPING";
  const isPickup = appt.type_code === "PICKUP";
  const badge = typeLabelWithMinutes(appt.type_code, appt);
  const mins = apptMinutes(appt) || 15;

  const subject = isShipping
    ? "¡Recibimos tus datos de envío!"
    : "¡Tu cita fue confirmada!";

  const mainTitle = subject;
  const intro = `Hola ${esc(appt.customer_name || "")}, estos son los detalles${
    isShipping ? " registrados" : ""
  }:`;

  const horario =
    appt.start_time && appt.end_time
      ? `${appt.start_time} – ${appt.end_time}`
      : "—";

  let detailsTable = "";
  if (isShipping) {
    detailsTable = `
      ${tableRow("Fecha de solicitud", appt.date)}
      ${tableRow("Producto", appt.product)}
      ${tableRow("Ciudad", appt.shipping_city)}
      ${tableRow("Dirección", appt.shipping_address)}
      ${tableRow("Barrio", appt.shipping_neighborhood)}
      ${tableRow("Transportadora", appt.shipping_carrier)}
      ${tableRow("Modalidad", "No contraentrega")}
    `;
  } else {
    detailsTable = `
      ${tableRow("Fecha", appt.date)}
      ${tableRow("Horario", horario)}
      ${tableRow("Producto (opcional)", appt.product || "-")}
      ${tableRow("Estado", appt.status || "CONFIRMADA")}
    `;
  }

  const tips = isShipping
    ? `
      <h3 style="margin:18px 0 8px 0;color:#0f172a;font-size:16px">¿Qué sigue?</h3>
      <ul style="margin:0 0 0 18px;padding:0;color:#475569;line-height:1.45">
        <li>Te <b>contactaremos</b> para confirmar el pago y <b>coordinar el despacho</b>.</li>
        <li>En <b>Bogotá</b> usamos <b>PICAP</b> o <b>INTERRAPIDÍSIMO</b>. Otras ciudades: <b>INTERRAPIDÍSIMO</b>.</li>
        <li>Al recibir, cancela el <b>costo de envío</b> a la transportadora (si aplica).</li>
      </ul>
      <p style="margin-top:12px;color:#475569;font-size:13px">
        Si hay un dato incorrecto, responde a este correo con la corrección.
      </p>
    `
    : isPickup
    ? `
      <h3 style="margin:18px 0 8px 0;color:#0f172a;font-size:16px">Indicaciones:</h3>
      <ul style="margin:0 0 0 18px;padding:0;color:#475569;line-height:1.45">
        <li>Antes de la entrega te enviaremos <b>videos de funcionamiento</b> del producto.</li>
        <li>El bloque reservado es de <b>hasta ${mins} min</b> solo para <b>coordinar pago y entrega</b>; normalmente toma pocos minutos.</li>
        <li><b>Confirma tu medio de pago</b> (transferencia/efectivo) antes de llegar.</li>
        <li>Si no puedes asistir, responde a este correo para <b>reprogramar</b>.</li>
      </ul>
    `
    : `
      <h3 style="margin:18px 0 8px 0;color:#0f172a;font-size:16px">Indicaciones:</h3>
      <ul style="margin:0 0 0 18px;padding:0;color:#475569;line-height:1.45">
        <li>Llega unos minutos antes para aprovechar los <b>${mins} min</b> del bloque.</li>
        <li>Si quieres, trae tu equipo; también tenemos <b>equipo de prueba</b>.</li>
        <li>Si no puedes asistir, responde a este correo para <b>reprogramar</b>.</li>
      </ul>
    `;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(subject)}</title>
</head>
<body style="background:#f8fafc;margin:0;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
    ${header()}
    <tr>
      <td style="padding:20px">
        <h1 style="margin:0 0 6px 0;font-size:22px;color:#0f172a">${esc(
          mainTitle
        )}</h1>
        <p style="margin:0 0 12px 0;color:#475569">${esc(intro)}</p>

        <div style="display:inline-block;background:${
          isShipping ? "#ecfdf5" : "#eef2ff"
        };color:${
    isShipping ? "#065f46" : "#3730a3"
  };padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px;margin:6px 0 14px 0">
          ${esc(badge)}
        </div>

        <table width="100%" cellspacing="0" cellpadding="10" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate">
          ${detailsTable}
        </table>

        ${tips}

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0"/>
        <p style="margin:0;color:#64748b;font-size:12px">
          Este correo se envió automáticamente desde TechVenturesCO.
          Si recibiste este mensaje por error, ignóralo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = isShipping
    ? `Recibimos tus datos de envío
Fecha: ${appt.date}
Producto: ${appt.product}
Ciudad: ${appt.shipping_city}
Dirección: ${appt.shipping_address}
Barrio: ${appt.shipping_neighborhood || "-"}
Transportadora: ${appt.shipping_carrier}
Modalidad: No contraentrega

¿Qué sigue?
- Te contactaremos para confirmar el pago y coordinar el despacho.
- En Bogotá: PICAP o INTERRAPIDÍSIMO. Otras ciudades: INTERRAPIDÍSIMO.
- Al recibir, pagas el costo de envío a la transportadora (si aplica).`
    : isPickup
    ? `Tu entrega sin ensayo fue confirmada
 Fecha: ${appt.date}
 Horario: ${horario}
 Producto: ${appt.product || "-"}
 Estado: ${appt.status || "CONFIRMADA"}

Indicaciones:
- Recibirás videos de funcionamiento antes de la entrega.
- El bloque (hasta ${mins} min) es para coordinar pago y entrega; suele tomar pocos minutos.
- Confirma tu medio de pago (transferencia/efectivo) antes de llegar.
- Si no puedes asistir, responde para reprogramar.`
    : `Tu cita fue confirmada
Fecha: ${appt.date}
Horario: ${horario}
Producto: ${appt.product || "-"}
Estado: ${appt.status || "CONFIRMADA"}

Indicaciones:
- Llega unos minutos antes (bloque de ${mins} min).
- Puedes traer tu equipo; también contamos con equipo de prueba.
- Si no puedes asistir, responde para reprogramar.`;

  return { subject, html, text };
}
