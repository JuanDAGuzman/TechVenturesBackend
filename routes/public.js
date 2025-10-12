// backend/routes/public.js
import express from "express";
import dayjs from "dayjs";
import { query } from "../db.js";
import { getAvailability } from "../services/availability.js";

import {
  buildConfirmationEmail,
  buildAdminNewAppointmentEmail,
} from "../services/emailTemplates.js";

const router = express.Router();

/* ================= Helpers ================= */
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}
function onlyDigits(s) {
  return /^[0-9]+$/.test(String(s || "").trim());
}
function toDigits(s = "") {
  return String(s || "").replace(/\D/g, "");
}
function toEmailNorm(s = "") {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function addMin(hm, mins) {
  const [H, M] = (hm || "00:00").split(":").map(Number);
  return dayjs()
    .hour(H)
    .minute(M)
    .second(0)
    .millisecond(0)
    .add(mins, "minute")
    .format("HH:mm");
}
function minutesBetween(a, b) {
  if (!a || !b) return null;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

/* ================= Env limits ================= */
const LIMIT_SHIP_WEEK = Number(
  process.env.BOOKING_LIMIT_SHIPPING_PER_WEEK || 3
);

/* ================= Availability ================= */
router.get("/availability", async (req, res) => {
  try {
    const { date, type } = req.query;
    if (!date || !type)
      return res.status(400).json({ ok: false, error: "MISSING_PARAMS" });
    if (!["TRYOUT", "PICKUP"].includes(type))
      return res.status(400).json({ ok: false, error: "INVALID_TYPE" });

    const data = await getAvailability({ dbQuery: query, date, type });
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[availability] error:", e);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ================= Shipping options ================= */
router.get("/shipping-options", async (req, res) => {
  try {
    const raw = (req.query.city || "").trim();
    const norm = raw
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const isBogota =
      norm === "bogota" ||
      norm === "bogota dc" ||
      norm === "bogota d.c." ||
      norm.includes("bogota");
    const options = isBogota
      ? ["PICAP", "INTERRAPIDISIMO"]
      : ["INTERRAPIDISIMO"];
    return res.json({ ok: true, options });
  } catch (e) {
    console.error("[shipping-options] error:", e);
    return res.status(500).json({ ok: false, options: ["INTERRAPIDISIMO"] });
  }
});

/* ================= Create appointment ================= */
router.post("/appointments", async (req, res) => {
  try {
    const {
      type_code, // TRYOUT | PICKUP | SHIPPING
      date, // YYYY-MM-DD
      start_time, // HH:MM
      end_time, // opcional
      product,
      customer_name,
      customer_email,
      customer_phone,
      customer_id_number,
      delivery_method, // IN_PERSON | SHIPPING
      notes,
      // envío
      shipping_address,
      shipping_neighborhood,
      shipping_city,
      shipping_carrier,
    } = req.body || {};

    // -------- Validaciones base --------
    if (
      !type_code ||
      !date ||
      !customer_name ||
      !customer_email ||
      !customer_phone
    ) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }
    if (!isValidEmail(customer_email)) {
      return res.status(400).json({ ok: false, error: "INVALID_EMAIL" });
    }
    if (!onlyDigits(toDigits(customer_phone))) {
      return res.status(400).json({ ok: false, error: "INVALID_PHONE" });
    }
    if (customer_id_number && !onlyDigits(toDigits(customer_id_number))) {
      return res.status(400).json({ ok: false, error: "INVALID_ID" });
    }

    // Normalizaciones
    const emailNorm = toEmailNorm(customer_email);
    const phoneDigits = toDigits(customer_phone);
    const idDigits = toDigits(customer_id_number);

    // -------- Reglas por tipo --------
    let finalStart = start_time || null;
    let finalEnd = null;

    if (type_code === "TRYOUT" || type_code === "PICKUP") {
      if (!start_time)
        return res.status(400).json({ ok: false, error: "MISSING_SLOT" });

      // Buscar la ventana que contenga el start_time: start <= t < end
      const winQ = await query(
        `SELECT
            to_char(start_time,'HH24:MI') AS s,
            to_char(end_time,'HH24:MI')   AS e,
            slot_minutes
         FROM appt_windows
        WHERE date=$1 AND type_code=$2
          AND start_time <= $3::time
          AND end_time   >  $3::time
        ORDER BY start_time
        LIMIT 1`,
        [date, type_code, start_time]
      );
      if (!winQ.rows.length) {
        return res.status(400).json({ ok: false, error: "OUTSIDE_WINDOW" });
      }

      const slotMins = Number(winQ.rows[0].slot_minutes);
      const winEnd = winQ.rows[0].e;

      // Si no vino end_time, calcularlo con el tamaño de bloque de la ventana
      finalStart = start_time;
      finalEnd = end_time || addMin(start_time, slotMins);

      // Tamaño exacto del bloque
      const diff = minutesBetween(finalStart, finalEnd);
      if (diff !== slotMins) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_SLOT_SIZE",
          meta: { expected: slotMins, got: diff },
        });
      }

      // No salirse de la ventana
      if (dayjs(`${date} ${finalEnd}`).isAfter(dayjs(`${date} ${winEnd}`))) {
        return res.status(400).json({ ok: false, error: "OUTSIDE_WINDOW" });
      }

      // Choque exacto del slot
      const clash = await query(
        `SELECT 1 FROM appointments
          WHERE type_code=$1 AND date=$2 AND status='CONFIRMED'
            AND start_time=$3 AND end_time=$4
          LIMIT 1`,
        [type_code, date, finalStart, finalEnd]
      );
      if (clash.rows.length) {
        return res.status(409).json({ ok: false, error: "SLOT_TAKEN" });
      }
    }

    if (type_code === "SHIPPING") {
      if (!product) {
        return res.status(400).json({ ok: false, error: "PRODUCT_REQUIRED" });
      }
      if (!shipping_address || !shipping_city || !shipping_carrier) {
        return res
          .status(400)
          .json({ ok: false, error: "SHIPPING_DATA_REQUIRED" });
      }
      finalStart = null;
      finalEnd = null;
    }

    // ============= LIMITES ANTI-SPAM =============
    const sameDaySameType = await query(
      `SELECT 1 FROM appointments
        WHERE date = $1
          AND type_code = $2
          AND status <> 'CANCELLED'
          AND (
            LOWER(customer_email) = $3
            OR customer_phone = $4
            OR (customer_id_number IS NOT NULL AND customer_id_number = $5)
          )
        LIMIT 1`,
      [date, type_code, emailNorm, phoneDigits, idDigits || null]
    );

    if (sameDaySameType.rows.length) {
      return res.status(429).json({
        ok: false,
        error: "USER_LIMIT_REACHED",
        meta: { scope: "DAY" },
      });
    }

    // Límite semanal para SHIPPING
    if (type_code === "SHIPPING") {
      const startOfWeek = dayjs(date).startOf("week").format("YYYY-MM-DD");
      const endOfWeek = dayjs(date).endOf("week").format("YYYY-MM-DD");

      const shipCount = await query(
        `SELECT COUNT(*)::int AS c
           FROM appointments
          WHERE type_code='SHIPPING'
            AND status <> 'CANCELLED'
            AND date BETWEEN $1 AND $2
            AND (
              LOWER(customer_email) = $3
              OR customer_phone = $4
              OR (customer_id_number IS NOT NULL AND customer_id_number = $5)
            )`,
        [startOfWeek, endOfWeek, emailNorm, phoneDigits, idDigits || null]
      );

      if (shipCount.rows[0].c >= LIMIT_SHIP_WEEK) {
        return res.status(429).json({
          ok: false,
          error: "USER_LIMIT_REACHED",
          meta: { scope: "WEEK", limit: LIMIT_SHIP_WEEK },
        });
      }
    }
    // ============= FIN LIMITES =============

    // -------- INSERT --------
    const insert = await query(
      `INSERT INTO appointments (
         type_code, date, start_time, end_time, product,
         customer_name, customer_email, customer_phone, customer_id_number,
         delivery_method, notes,
         shipping_address, shipping_neighborhood, shipping_city, shipping_carrier
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        type_code,
        date,
        finalStart,
        finalEnd,
        product || null,
        customer_name,
        emailNorm,
        phoneDigits,
        idDigits || null,
        delivery_method ||
          (type_code === "SHIPPING" ? "SHIPPING" : "IN_PERSON"),
        notes || null,
        shipping_address || null,
        shipping_neighborhood || null,
        shipping_city || null,
        shipping_carrier || null,
      ]
    );
    const apptId = insert.rows[0].id;
    const minutes = minutesBetween(finalStart, finalEnd); // null si SHIPPING

    // -------- Emails (no bloquea la respuesta) --------
    try {
      const appointmentForEmail = {
        id: apptId,
        type_code,
        date,
        start_time: finalStart,
        end_time: finalEnd,
        minutes,
        product,
        customer_name,
        customer_email: emailNorm,
        customer_phone: phoneDigits,
        customer_id_number: idDigits,
        delivery_method:
          delivery_method ||
          (type_code === "SHIPPING" ? "SHIPPING" : "IN_PERSON"),
        notes,
        shipping_address,
        shipping_neighborhood,
        shipping_city,
        shipping_carrier,
        status: "CONFIRMED",
      };

      // Cliente
      const { subject, html, text } =
        buildConfirmationEmail(appointmentForEmail);
      const adminBcc = (process.env.MAIL_NOTIFY || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      import("../services/mailer.js").then(({ sendMailSafe }) => {
        sendMailSafe({
          to: emailNorm,
          subject,
          html,
          text,
          ...(adminBcc.length ? { bcc: adminBcc } : {}),
        });
      });

      // Admin (copia)
      const adminTo =
        process.env.MAIL_NOTIFY ||
        process.env.ADMIN_NOTIFY ||
        process.env.MAIL_FROM ||
        process.env.MAIL_USER;

      if (adminTo) {
        const adminEmail = buildAdminNewAppointmentEmail(appointmentForEmail);
        import("../services/mailer.js").then(({ sendMailSafe }) => {
          sendMailSafe({
            to: adminTo,
            subject: adminEmail.subject,
            html: adminEmail.html,
            text: adminEmail.text,
          });
        });
      }
    } catch (e) {
      console.warn(
        "[mailer] preparación de correo falló (no bloquea):",
        e.message
      );
    }

    return res.json({ ok: true, id: apptId });
  } catch (err) {
    console.error("[appointments] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

export default router;
