import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "America/Bogota";

const BASE_URL =
  process.env.PUBLIC_URL ||
  process.env.BASE_URL ||
  "https://techventuresbackend-production.up.railway.app";

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function modernLayout({ title, headerText, content }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
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
              <p style="margin: 10px 0 0 0; color: #e0e7ff; font-size: 16px;">${escapeHtml(
                headerText
              )}</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              ${content}
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
}

function detailsTable(rows) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0; background-color: #f9fafb; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
}

function detailRow(label, value) {
  return `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
        <strong style="color: #374151;">${escapeHtml(label)}:</strong>
      </td>
      <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">
        ${escapeHtml(value || "—")}
      </td>
    </tr>
  `;
}

function infoBox(content) {
  return `
    <div style="margin: 30px 0; padding: 20px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
      <p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 1.6;">
        ${content}
      </p>
    </div>
  `;
}

export function emailForInPerson(appt) {
  const { type_code, date, start_time, end_time, product, customer_name } =
    appt;

  const isTryout = type_code === "TRYOUT";
  const typeLabel = typeLabelWithMinutes(type_code, appt);
  const mins = apptMinutes(appt) || 15;

  const title = "Confirmación de cita — TechVenturesCO";
  const headerText = "¡Tu cita fue confirmada!";

  const rows = `
    ${detailRow("Fecha", dayjs(date).format("DD/MM/YYYY"))}
    ${detailRow("Horario", `${start_time || "—"} – ${end_time || "—"}`)}
    ${detailRow("Tipo de cita", typeLabel)}
    ${detailRow("Producto", product || "—")}
    ${detailRow("Estado", "CONFIRMADA")}
  `;

  const instructions = isTryout
    ? `<strong>Indicaciones:</strong><br>
       • Llega unos minutos antes para aprovechar los <strong>${mins} min</strong> del bloque.<br>
       • Si quieres, trae tu equipo; también tenemos equipo de prueba.<br>
       • Si no puedes asistir, responde a este correo para reprogramar.`
    : `<strong>Indicaciones:</strong><br>
       • Antes de la entrega te enviaremos <strong>videos de funcionamiento</strong> del producto.<br>
       • El bloque reservado es de <strong>hasta ${mins} min</strong> solo para coordinar pago y entrega.<br>
       • Confirma tu medio de pago (transferencia/efectivo) antes de llegar.<br>
       • Si no puedes asistir, responde a este correo para reprogramar.`;

  const content = `
    <h2 style="margin: 0 0 10px 0; color: #111827; font-size: 24px; font-weight: 600;">
      Hola ${escapeHtml(customer_name || "")},
    </h2>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
      Tu cita ha sido confirmada. Estos son los detalles:
    </p>

    ${detailsTable(rows)}

    ${infoBox(instructions)}
  `;

  const html = modernLayout({ title, headerText, content });

  const text = `¡Tu cita fue confirmada!

Tipo: ${typeLabel}
Fecha: ${dayjs(date).format("DD/MM/YYYY")}
Horario: ${start_time || "—"} – ${end_time || "—"}
Producto: ${product || "—"}
Estado: CONFIRMADA

${
  isTryout
    ? `Llega unos minutos antes para aprovechar los ${mins} min del bloque. Si quieres, trae tu equipo; también tenemos equipo de prueba.`
    : `Antes de la entrega te enviaremos videos de funcionamiento. El bloque es de hasta ${mins} min para coordinar pago y entrega.`
}

Si no puedes asistir, responde a este correo para reprogramar.

--
TechVenturesCO
© ${new Date().getFullYear()}`;

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
  const headerText = "¡Recibimos tus datos de envío!";

  const rows = `
    ${detailRow("Fecha de solicitud", dayjs(date).format("DD/MM/YYYY"))}
    ${detailRow("Producto", product || "—")}
    ${detailRow("Ciudad", shipping_city || "—")}
    ${detailRow("Dirección", shipping_address || "—")}
    ${detailRow("Barrio", shipping_neighborhood || "—")}
    ${detailRow("Transportadora", shipping_carrier || "—")}
    ${detailRow("Modalidad", "No contraentrega")}
  `;

  const instructions = `<strong>¿Qué sigue?</strong><br>
    • Te contactaremos para confirmar pago y coordinar la recolección.<br>
    • En <strong>Bogotá</strong> usamos <strong>PICAP</strong> o <strong>INTERRAPIDÍSIMO</strong>. Otras ciudades: <strong>INTERRAPIDÍSIMO</strong>.<br>
    • Al recibir, cancela el costo de envío a la transportadora (si aplica).`;

  const content = `
    <h2 style="margin: 0 0 10px 0; color: #111827; font-size: 24px; font-weight: 600;">
      Hola ${escapeHtml(customer_name || "")},
    </h2>
    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 16px; line-height: 1.6;">
      Recibimos tu solicitud de envío. Estos son los datos registrados:
    </p>

    ${detailsTable(rows)}

    ${infoBox(instructions)}

    <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px;">
      Si hay algún dato incorrecto, responde a este correo con la corrección.
    </p>
  `;

  const html = modernLayout({ title, headerText, content });

  const text = `¡Recibimos tus datos de envío!

Producto: ${product || "—"}
Ciudad: ${shipping_city || "—"}
Dirección: ${shipping_address || "—"}
Barrio: ${shipping_neighborhood || "—"}
Transportadora: ${shipping_carrier || "—"}
Modalidad: No contraentrega

¿Qué sigue?
- Te contactaremos para confirmar pago y coordinar la recolección.
- En Bogotá: PICAP o INTERRAPIDÍSIMO. Otras ciudades: INTERRAPIDÍSIMO.
- Al recibir, cancela el costo de envío a la transportadora (si aplica).

--
TechVenturesCO
© ${new Date().getFullYear()}`;

  return {
    subject: "Confirmación de envío — TechVenturesCO",
    html,
    text,
  };
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

  const title = `Recordatorio: tu cita hoy a las ${
    appt.start_time || ""
  } — TechVenturesCO`;
  const headerText = "Recordatorio de tu cita";

  const rows = `
    ${detailRow("Fecha", dayjs(date).format("DD/MM/YYYY"))}
    ${detailRow("Horario", time)}
    ${detailRow("Tipo de cita", methodLabel)}
    ${detailRow("Estado", "CONFIRMADA")}
  `;

  const instructions =
    appt.type_code === "TRYOUT"
      ? `<strong>Te esperamos ${etaLabel}.</strong><br>
         • Llega unos minutos antes para aprovechar el bloque de ${m} min.<br>
         • Si quieres, trae tu equipo; también tenemos equipo de prueba.`
      : `<strong>Te esperamos ${etaLabel}.</strong><br>
         • Te enviaremos los videos de prueba antes de la entrega.<br>
         • Ten listo tu medio de pago.`;

  const content = `
    <h2 style="margin: 0 0 20px 0; color: #111827; font-size: 24px; font-weight: 600;">
      Tu cita es hoy
    </h2>

    ${detailsTable(rows)}

    ${infoBox(instructions)}
  `;

  const html = modernLayout({ title, headerText, content });

  const text = `Recordatorio: cita ${methodLabel} el ${dayjs(date).format(
    "DD/MM/YYYY"
  )} ${time}. Te esperamos ${etaLabel}.

--
TechVenturesCO
© ${new Date().getFullYear()}`;

  return { subject: title, html, text };
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

  const title = subject;
  const headerText = isShipping
    ? "Nuevo envío registrado"
    : "Nueva cita programada";

  let rows = `
    ${detailRow("Tipo", typeLabel)}
    ${detailRow("Fecha", appt.date || "—")}
    ${detailRow("Horario", horario)}
    ${detailRow("Estado", appt.status || "CONFIRMED")}
    ${detailRow("Producto", appt.product || "—")}
    ${detailRow("Nombre", appt.customer_name || "—")}
    ${detailRow("Cédula", appt.customer_id_number || "—")}
    ${detailRow("Correo", appt.customer_email || "—")}
    ${detailRow("Celular", appt.customer_phone || "—")}
  `;

  if (isShipping) {
    rows += `
      ${detailRow("Ciudad", appt.shipping_city || "—")}
      ${detailRow("Dirección", appt.shipping_address || "—")}
      ${detailRow("Barrio", appt.shipping_neighborhood || "—")}
      ${detailRow("Transportadora", appt.shipping_carrier || "—")}
      ${detailRow("Modalidad", "No contraentrega")}
    `;
  }

  if (appt.notes) {
    rows += detailRow("Notas", appt.notes);
  }

  const content = `
    <h2 style="margin: 0 0 20px 0; color: #111827; font-size: 24px; font-weight: 600;">
      ${escapeHtml(headerText)}
    </h2>

    ${detailsTable(rows)}

    <p style="margin: 20px 0 0 0; color: #6b7280; font-size: 14px;">
      Notificación interna automática.
    </p>
  `;

  const html = modernLayout({ title, headerText, content });

  const text = [
    headerText,
    `Tipo: ${typeLabel}`,
    `Fecha: ${appt.date || "—"}`,
    `Horario: ${horario}`,
    `Estado: ${appt.status || "CONFIRMED"}`,
    `Producto: ${appt.product || "—"}`,
    `Nombre: ${appt.customer_name || "—"}`,
    `Cédula: ${appt.customer_id_number || "—"}`,
    `Correo: ${appt.customer_email || "—"}`,
    `Celular: ${appt.customer_phone || "—"}`,
    ...(isShipping
      ? [
          `Ciudad: ${appt.shipping_city || "—"}`,
          `Dirección: ${appt.shipping_address || "—"}`,
          `Barrio: ${appt.shipping_neighborhood || "—"}`,
          `Transportadora: ${appt.shipping_carrier || "—"}`,
          `Modalidad: No contraentrega`,
        ]
      : []),
    `Notas: ${appt.notes || "—"}`,
    "",
    "--",
    "Notificación interna automática",
    `© ${new Date().getFullYear()} TechVenturesCO`,
  ].join("\n");

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
  const fullGuideUrl = publicUrl ? `${BASE_URL}${publicUrl}` : null;

  const subject = adminCopy
    ? `Copia — ¡Tu paquete ha sido enviado!`
    : "¡Tu paquete ha sido enviado!";

  const title = subject;
  const headerText = "¡Tu paquete ha sido enviado!";

  let trackingInfo = "";

  if (isPicap && rideUrl) {
    trackingInfo = `
      ${detailRow("Transportadora", "PICAP")}
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
    trackingInfo = detailRow("Número de guía", trackingNumber);

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
    trackingInfo += detailRow(
      `Valor del ${isPicap ? "servicio" : "envío"}`,
      Number(shippingCost).toLocaleString("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      })
    );
  }

  const instructions = `<strong>¿Qué sigue?</strong><br>
    • Usa el ${isPicap ? "link" : "número de guía"} para hacer seguimiento.<br>
    ${
      !isPicap
        ? "• Al recibir, cancelas el costo del envío/servicio (si aplica)."
        : ""
    }`;

  const content = `
    <h2 style="margin: 0 0 10px 0; color: #111827; font-size: 24px; font-weight: 600;">
      Envío (no contraentrega)
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

    ${detailsTable(trackingInfo)}

    ${infoBox(instructions)}
  `;

  const html = modernLayout({ title, headerText, content });

  const text = `¡Tu paquete ha sido enviado!

${isPicap ? "Transportadora: PICAP" : `Número de guía: ${trackingNumber}`}
${
  shippingCost != null
    ? `Valor del ${isPicap ? "servicio" : "envío"}: ${Number(
        shippingCost
      ).toLocaleString("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      })}`
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
TechVenturesCO
© ${new Date().getFullYear()}`;

  return { subject, html, text };
}

export function buildConfirmationEmail(appt) {
  const isShipping = appt.type_code === "SHIPPING";
  if (isShipping) {
    return emailForShipping(appt);
  } else {
    return emailForInPerson(appt);
  }
}
