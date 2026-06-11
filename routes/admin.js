import express from "express";
import { query } from "../db.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import { buildShippedEmail, buildRescheduledEmail, buildUpdatedDetailsEmail, buildConfirmationEmail } from "../services/emailTemplates.js";
import { sendMail } from "../services/mailer.js";
import { rpID, rpName, expectedOrigins } from "../lib/webauthnConfig.js";
import { setChallenge, takeChallenge } from "../lib/webauthnChallenges.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GUIDES_DIR = path.join(__dirname, "..", "uploads", "shipping-guides");

fs.mkdirSync(GUIDES_DIR, { recursive: true });

function guideAttachment(publicUrl) {
  if (!publicUrl) return null;
  // publicUrl viene como /uploads/shipping-guides/filename.ext
  const filePath = path.join(__dirname, "..", publicUrl);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png",  ".pdf": "application/pdf",
    ".gif": "image/gif",  ".webp": "image/webp",
  };
  return {
    filename: `guia${ext}`,
    path: filePath,
    contentType: mimeMap[ext] || "application/octet-stream",
  };
}

function toMin(hhmm = "") {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minutesBetween(a, b) {
  if (!a || !b) return null;
  return toMin(b) - toMin(a);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd);
}
function isSlotSize(n) {
  return [15, 20, 30].includes(Number(n));
}

router.use((req, res, next) => {
  const token = req.headers["x-admin-token"];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  next();
});

// ── OCR: extraer número de guía y valor desde imagen ────────────────────────
router.post("/extract-guide", async (req, res) => {
  const { imageBase64, filename = "guide.jpg" } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ ok: false, error: "NO_IMAGE" });
  }

  const ext = path.extname(filename).toLowerCase() || ".jpg";
  const tmpPath = path.join(os.tmpdir(), `ocr_${Date.now()}${ext}`);

  try {
    // Guardar imagen temporal
    fs.writeFileSync(tmpPath, Buffer.from(imageBase64, "base64"));

    const scriptPath = path.join(__dirname, "..", "ocr", "extract_guide.py");

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const result = await new Promise((resolve, reject) => {
      const py = spawn(pythonCmd, [scriptPath, tmpPath]);

      let stdout = "";
      let stderr = "";

      py.stdout.on("data", (d) => (stdout += d));
      py.stderr.on("data", (d) => (stderr += d));

      const timeout = setTimeout(() => {
        py.kill();
        reject(new Error("OCR_TIMEOUT"));
      }, 30000);

      py.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.error("[extract-guide] Python stderr:", stderr);
          reject(new Error(`Python exited ${code}: ${stderr.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error("JSON_PARSE_ERROR"));
        }
      });
    });

    return res.json(result);
  } catch (err) {
    console.error("[extract-guide] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ya fue borrado */ }
  }
});

// ── Evidencia fotográfica para envíos Picap/InDrive ─────────────────────────
router.post("/appointments/:id/evidence", async (req, res) => {
  try {
    const { id } = req.params;
    const { photos } = req.body || {};

    if (!Array.isArray(photos) || photos.length === 0)
      return res.status(400).json({ ok: false, error: "NO_PHOTOS" });
    if (photos.length > 5)
      return res.status(400).json({ ok: false, error: "TOO_MANY_PHOTOS" });

    // Reemplazar evidencia anterior del mismo envío
    await query(`DELETE FROM picap_evidence WHERE appointment_id = $1`, [id]);

    for (const photo of photos) {
      const buffer = Buffer.from(photo.data, "base64");
      await query(
        `INSERT INTO picap_evidence (appointment_id, filename, file_data) VALUES ($1, $2, $3)`,
        [id, photo.filename || "evidencia.jpg", buffer]
      );
    }

    return res.json({ ok: true, count: photos.length });
  } catch (err) {
    console.error("[evidence] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/appointments/:id/upload-guide", async (req, res) => {
  try {
    const { id } = req.params;
    const { filename, fileData } = req.body;

    if (!fileData || !filename) {
      console.error("[upload-guide] Faltan datos:", {
        filename: !!filename,
        fileData: !!fileData,
      });
      return res.status(400).json({ ok: false, error: "NO_FILE" });
    }

    console.log(
      "[upload-guide] Recibiendo archivo:",
      filename,
      "Tamaño base64:",
      fileData.length
    );

    const buffer = Buffer.from(fileData, "base64");
    const ext = path.extname(filename).toLowerCase();
    const newFilename = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}${ext}`;
    const filePath = path.join(GUIDES_DIR, newFilename);

    fs.writeFileSync(filePath, buffer);

    console.log(
      "[upload-guide] Archivo guardado:",
      newFilename,
      "Tamaño:",
      buffer.length,
      "bytes"
    );

    const publicUrl = `/uploads/shipping-guides/${newFilename}`;

    await query(
      `UPDATE appointments SET tracking_file_url = $1 WHERE id = $2`,
      [publicUrl, id]
    );

    return res.json({
      ok: true,
      url: publicUrl,
      filename: filename,
    });
  } catch (err) {
    console.error("[upload-guide] error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/windows", async (req, res) => {
  try {
    const { date, type_code, start_time, end_time } = req.body || {};
    const slot_minutes = req.body.slot_minutes ?? 15;

    if (!date || !type_code || !start_time || !end_time)
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    if (!["TRYOUT", "PICKUP"].includes(type_code))
      return res.status(400).json({ ok: false, error: "INVALID_TYPE" });
    if (!isSlotSize(slot_minutes))
      return res.status(400).json({ ok: false, error: "INVALID_SLOT_SIZE" });
    if (minutesBetween(start_time, end_time) <= 0)
      return res.status(400).json({ ok: false, error: "INVALID_RANGE" });
    if (slot_minutes > minutesBetween(start_time, end_time))
      return res.status(400).json({ ok: false, error: "SLOT_EXCEEDS_WINDOW" });

    const existing = await query(
      `SELECT id, start_time, end_time
   FROM availability_windows WHERE date=$1 AND type_code=$2`,
      [date, type_code]
    );
    const clash = existing.rows.find((w) =>
      overlaps(start_time, end_time, w.start_time, w.end_time)
    );
    if (clash)
      return res
        .status(409)
        .json({ ok: false, error: "WINDOW_OVERLAP", meta: { id: clash.id } });

    const ins = await query(
      `INSERT INTO availability_windows(date,type_code,start_time,end_time,created_by,slot_minutes)
   VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [date, type_code, start_time, end_time, "admin", slot_minutes]
    );
    return res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    console.error("[admin/windows POST]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.patch("/windows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { start_time, end_time, slot_minutes } = req.body || {};
    const cur = await query(`SELECT * FROM availability_windows WHERE id=$1`, [id]);
    if (!cur.rows.length)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const row = cur.rows[0];
    const st = start_time || row.start_time;
    const en = end_time || row.end_time;
    const sm = slot_minutes != null ? Number(slot_minutes) : row.slot_minutes;

    if (!isSlotSize(sm))
      return res.status(400).json({ ok: false, error: "INVALID_SLOT_SIZE" });
    if (minutesBetween(st, en) <= 0)
      return res.status(400).json({ ok: false, error: "INVALID_RANGE" });

    const others = await query(
      `SELECT id, start_time, end_time
   FROM availability_windows WHERE date=$1 AND type_code=$2 AND id<>$3`,
      [row.date, row.type_code, id]
    );
    const clash = others.rows.find((w) =>
      overlaps(st, en, w.start_time, w.end_time)
    );
    if (clash)
      return res
        .status(409)
        .json({ ok: false, error: "WINDOW_OVERLAP", meta: { id: clash.id } });

    await query(
      `UPDATE availability_windows
     SET start_time=$1, end_time=$2, slot_minutes=$3
   WHERE id=$4`,
      [st, en, sm, id]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[admin/windows PATCH]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.delete("/windows/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const del = await query(`DELETE FROM availability_windows WHERE id=$1`, [id]);
    return res.json({ ok: true, removed: del.rowCount });
  } catch (e) {
    console.error("[admin/windows DELETE]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/windows", async (req, res) => {
  try {
    const { date, type } = req.query;
    if (!date)
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });
    const rows = await query(
      `SELECT * FROM availability_windows WHERE date=$1 AND ($2::text IS NULL OR type_code=$2)
   ORDER BY start_time`,
      [date, type || null]
    );
    return res.json({ ok: true, rows: rows.rows });
  } catch (e) {
    console.error("[admin/windows GET]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/appointments", async (req, res) => {
  try {
    const {
      type_code, date, start_time, end_time,
      customer_name, customer_email, customer_phone, customer_id_number,
      product, notes,
      shipping_address, shipping_neighborhood, shipping_city, shipping_carrier,
      send_email = true,
    } = req.body || {};

    if (!type_code || !customer_name || !customer_email || !product)
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

    const delivery_method = type_code === "SHIPPING" ? "SHIPPING" : "IN_PERSON";

    let slot_minutes = null;
    if (start_time && end_time) {
      const [sh, sm] = start_time.split(":").map(Number);
      const [eh, em] = end_time.split(":").map(Number);
      slot_minutes = Math.max(0, eh * 60 + em - (sh * 60 + sm));
    }

    const { rows } = await query(
      `INSERT INTO appointments
        (type_code, date, start_time, end_time, slot_minutes,
         customer_name, customer_email, customer_phone, customer_id_number,
         product, notes, delivery_method, status,
         shipping_address, shipping_neighborhood, shipping_city, shipping_carrier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CONFIRMED',$13,$14,$15,$16)
       RETURNING id`,
      [
        type_code, date || null, start_time || null, end_time || null, slot_minutes,
        customer_name, customer_email, customer_phone || null, customer_id_number || null,
        product, notes || null, delivery_method,
        shipping_address || null, shipping_neighborhood || null, shipping_city || null, shipping_carrier || null,
      ]
    );

    const id = rows[0].id;

    if (send_email) {
      try {
        const apptForEmail = {
          id, type_code, date, start_time, end_time, slot_minutes,
          customer_name, customer_email, customer_phone, product, notes,
          delivery_method, status: "CONFIRMED",
          shipping_address, shipping_neighborhood, shipping_city, shipping_carrier,
        };
        const { subject, html, text } = buildConfirmationEmail(apptForEmail);
        await sendMail({ to: customer_email, subject, html, text });
        console.log("[admin-book] Correo de confirmación enviado a", customer_email);
      } catch (e) {
        console.error("[admin-book-email]", e);
      }
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[admin/appointments POST]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/appointments", async (req, res) => {
  try {
    const { date } = req.query || {};
    if (!date) {
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });
    }

    const { rows } = await query(
      `
      SELECT
        id,
        type_code,
        date,
        to_char(start_time, 'HH24:MI') AS start_time,
        to_char(end_time,   'HH24:MI') AS end_time,
        customer_name,
        customer_email,
        customer_phone,
        customer_id_number,
        product,
        notes,
        delivery_method,
        status,
        shipping_address,
        shipping_neighborhood,
        shipping_city,
        shipping_carrier,
        shipping_cost,
        shipping_trip_link,
        tracking_number,
        tracking_file_url,
        to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM appointments
      WHERE date = $1
      ORDER BY start_time NULLS LAST, created_at ASC
      `,
      [date]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("[admin] list appointments error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `
      SELECT
        id,
        type_code,
        date,
        to_char(start_time, 'HH24:MI') AS start_time,
        to_char(end_time,   'HH24:MI') AS end_time,
        customer_name,
        customer_email,
        customer_phone,
        customer_id_number,
        product,
        notes,
        delivery_method,
        status,
        shipping_address,
        shipping_neighborhood,
        shipping_city,
        shipping_carrier,
        shipping_cost,
        shipping_trip_link,
        tracking_number,
        tracking_file_url,
        to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
      FROM appointments
      WHERE id = $1
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error("[admin] get appointment by id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.patch("/appointments/:id/ship", async (req, res) => {
  try {
    const { id } = req.params;

    const apptQ = await query(`SELECT * FROM appointments WHERE id=$1`, [id]);
    if (!apptQ.rows.length) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    const appt = apptQ.rows[0];
    if (appt.type_code !== "SHIPPING") {
      return res
        .status(400)
        .json({ ok: false, error: "NOT_SHIPPING_APPOINTMENT" });
    }

    const carrier = String(appt.shipping_carrier || "").toUpperCase();
    const body = req.body || {};
    const tracking_number = (body.tracking_number || "").trim();
    const shipping_cost_raw = body.shipping_cost ?? null;
    const shipping_cost =
      shipping_cost_raw === null || shipping_cost_raw === ""
        ? null
        : Number(shipping_cost_raw);
    const shipping_trip_link = (body.shipping_trip_link || "").trim();
    const delivery_code = (body.delivery_code || "").trim() || null;

    // La URL del archivo ya está en la BD (si se subió antes)
    const publicUrl = appt.tracking_file_url || null;

    if (carrier === "PICAP") {
      if (!shipping_trip_link) {
        return res.status(400).json({ ok: false, error: "MISSING_TRIP_LINK" });
      }
      await query(
        `
          UPDATE appointments
          SET status = 'SHIPPED',
              tracking_number    = NULL,
              shipping_cost      = COALESCE($2, shipping_cost),
              shipping_trip_link = $3,
              delivery_code      = $4,
              shipped_at         = NOW()
          WHERE id = $1
        `,
        [id, shipping_cost, shipping_trip_link, delivery_code]
      );
    } else {
      if (!tracking_number) {
        return res.status(400).json({ ok: false, error: "MISSING_TRACKING" });
      }
      await query(
        `
          UPDATE appointments
          SET status = 'SHIPPED',
              tracking_number    = $2,
              shipping_cost      = COALESCE($3, shipping_cost),
              shipped_at         = NOW()
          WHERE id = $1
        `,
        [id, tracking_number, shipping_cost]
      );
    }

    const { rows: r2 } = await query(`SELECT * FROM appointments WHERE id=$1`, [
      id,
    ]);
    const updated = r2[0];

    // Cargar fotos de evidencia Picap si existen
    let evidenceAttachments = [];
    if (carrier === "PICAP") {
      try {
        const evQ = await query(
          `SELECT filename, file_data FROM picap_evidence WHERE appointment_id = $1 ORDER BY id`,
          [id]
        );
        evidenceAttachments = evQ.rows.map((row, i) => {
          const ext = path.extname(row.filename || "").toLowerCase() || ".jpg";
          const mimeMap = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
          return {
            filename: `evidencia_${i + 1}${ext}`,
            content: row.file_data,
            contentType: mimeMap[ext] || "image/jpeg",
          };
        });
      } catch (e) {
        console.error("[ship-evidence] Error cargando fotos:", e);
      }
    }

    try {
      const { subject, html, text } = buildShippedEmail(updated, {
        trackingNumber: carrier === "PICAP" ? null : tracking_number,
        publicUrl: carrier === "PICAP" ? null : publicUrl,
        shippingCost: shipping_cost,
        rideUrl: carrier === "PICAP" ? shipping_trip_link : null,
        deliveryCode: carrier === "PICAP" ? delivery_code : null,
        evidenceCount: evidenceAttachments.length,
      });

      const adminBcc = (process.env.MAIL_NOTIFY || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const guideAtt = guideAttachment(publicUrl);
      const attachments = [
        ...(guideAtt ? [guideAtt] : []),
        ...evidenceAttachments,
      ];

      await sendMail({
        to: updated.customer_email,
        subject,
        html,
        text,
        ...(adminBcc.length ? { bcc: adminBcc } : {}),
        ...(attachments.length ? { attachments } : {}),
      });

      console.log("[ship-email] Correo enviado al cliente");
    } catch (e) {
      console.error("[ship-email] ERROR:", e);
    }

    try {
      const adminTo =
        process.env.ADMIN_NOTIFY ||
        process.env.MAIL_FROM ||
        process.env.MAIL_USER;
      if (adminTo) {
        const { subject, html, text } = buildShippedEmail(updated, {
          trackingNumber: carrier === "PICAP" ? null : tracking_number,
          publicUrl: carrier === "PICAP" ? null : publicUrl,
          shippingCost: shipping_cost,
          rideUrl: carrier === "PICAP" ? shipping_trip_link : null,
          deliveryCode: carrier === "PICAP" ? delivery_code : null,
          evidenceCount: evidenceAttachments.length,
          adminCopy: true,
        });
        const guideAtt = guideAttachment(publicUrl);
        const attachments = [
          ...(guideAtt ? [guideAtt] : []),
          ...evidenceAttachments,
        ];
        await sendMail({
          to: adminTo,
          subject: `Copia — ${subject}`,
          html,
          text,
          ...(attachments.length ? { attachments } : {}),
        });
        console.log("[ship-email] Correo enviado al admin");
      }
    } catch (e) {
      console.error("[ship-email][admin] ERROR:", e);
    }

    return res.json({
      ok: true,
      item: {
        id,
        status: "SHIPPED",
        tracking_number: carrier === "PICAP" ? null : tracking_number,
        tracking_file_url: publicUrl,
        shipping_cost,
        shipping_trip_link: carrier === "PICAP" ? shipping_trip_link : null,
      },
    });
  } catch (err) {
    console.error("[admin] ship error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.patch("/appointments/:id/reschedule", async (req, res) => {
  try {
    const { id } = req.params;
    const { date, start_time, end_time, notify = true } = req.body || {};

    if (!date || !start_time || !end_time)
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });

    const { rows: cur } = await query(
      `SELECT id, type_code, customer_name, customer_email, slot_minutes,
       to_char(date,'YYYY-MM-DD') AS date,
       to_char(start_time,'HH24:MI') AS start_time,
       to_char(end_time,'HH24:MI') AS end_time
       FROM appointments WHERE id = $1`,
      [id]
    );
    if (!cur.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const appt = cur[0];

    const oldDate = appt.date;
    const oldStart = appt.start_time;
    const oldEnd = appt.end_time;

    const [sh, sm] = start_time.split(":").map(Number);
    const [eh, em] = end_time.split(":").map(Number);
    const slot_minutes = Math.max(0, eh * 60 + em - (sh * 60 + sm));

    await query(
      `UPDATE appointments SET date = $1, start_time = $2, end_time = $3, slot_minutes = $4 WHERE id = $5`,
      [date, start_time, end_time, slot_minutes, id]
    );

    if (notify && appt.customer_email) {
      try {
        const updated = { ...appt, date, start_time, end_time, slot_minutes };
        const { subject, html, text } = buildRescheduledEmail(updated, { oldDate, oldStart, oldEnd });
        await sendMail({ to: appt.customer_email, subject, html, text });
        console.log("[reschedule-email] Correo enviado a", appt.customer_email);
      } catch (e) {
        console.error("[reschedule-email]", e);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[reschedule]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.patch("/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      notify = false,
      customer_name,
      customer_id_number,
      customer_email,
      customer_phone,
      product,
      notes,
      status,
      delivery_method,
      shipping_address,
      shipping_neighborhood,
      shipping_city,
      shipping_carrier,
      shipping_cost,
      shipping_trip_link,
    } = req.body || {};

    // Fetch current record before update if notification requested
    let before = null;
    if (notify) {
      const { rows: cur } = await query(`SELECT * FROM appointments WHERE id = $1`, [id]);
      if (cur.length) before = cur[0];
    }

    const { rows } = await query(
      `
   UPDATE appointments SET
     customer_name         = COALESCE($1,  customer_name),
     customer_id_number    = COALESCE($2,  customer_id_number),
     customer_email        = COALESCE($3,  customer_email),
     customer_phone        = COALESCE($4,  customer_phone),
     product               = COALESCE($5,  product),
     notes                 = COALESCE($6,  notes),
     status                = COALESCE($7,  status),
     delivery_method       = COALESCE($8,  delivery_method),
     shipping_address      = COALESCE($9,  shipping_address),
     shipping_neighborhood = COALESCE($10, shipping_neighborhood),
     shipping_city         = COALESCE($11, shipping_city),
     shipping_carrier      = COALESCE($12, shipping_carrier),
     shipping_cost         = COALESCE($13, shipping_cost),
     shipping_trip_link    = COALESCE($14, shipping_trip_link)
    WHERE id = $15
    RETURNING id, customer_name, customer_id_number, customer_email, customer_phone

      `,
      [
        customer_name || null,
        customer_id_number || null,
        customer_email || null,
        customer_phone || null,
        product || null,
        notes || null,
        status || null,
        delivery_method || null,
        shipping_address || null,
        shipping_neighborhood || null,
        shipping_city || null,
        shipping_carrier || null,
        shipping_cost ?? null,
        shipping_trip_link || null,
        id,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    // 🚫 BLOQUEO AUTOMÁTICO: Si se marca como NO_SHOW, agregar a blacklist
    if (status === "NO_SHOW") {
      const appointment = rows[0];
      const idNumber = appointment.customer_id_number;

      // Solo bloquear si tiene cédula registrada
      if (idNumber) {
        try {
          await query(
            `INSERT INTO customer_blacklist (
              customer_id_number,
              customer_name,
              customer_email,
              customer_phone,
              reason,
              appointment_id,
              notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (customer_id_number)
            DO UPDATE SET
              reason = EXCLUDED.reason,
              appointment_id = EXCLUDED.appointment_id,
              blocked_at = now(),
              notes = COALESCE(EXCLUDED.notes, customer_blacklist.notes)`,
            [
              idNumber,
              appointment.customer_name,
              appointment.customer_email,
              appointment.customer_phone,
              "NO_SHOW",
              id,
              "Cliente marcado automáticamente por no aparecer a su cita",
            ]
          );
          console.log(
            `[AUTO-BLACKLIST] Cliente ${idNumber} bloqueado automáticamente por NO_SHOW`
          );
        } catch (blErr) {
          console.error("[AUTO-BLACKLIST] Error al bloquear cliente:", blErr);
          // No bloqueamos la respuesta si falla el blacklist
        }
      }
    }

    // Enviar notificación de cambios al cliente si se solicitó
    if (notify && before) {
      const TRACKED = [
        { field: "customer_name", label: "Nombre" },
        { field: "customer_email", label: "Correo electrónico" },
        { field: "customer_phone", label: "Celular" },
        { field: "product", label: "Producto" },
        { field: "shipping_address", label: "Dirección de envío" },
        { field: "shipping_neighborhood", label: "Barrio" },
        { field: "shipping_city", label: "Ciudad" },
      ];
      const changes = TRACKED.filter(
        (t) => req.body[t.field] != null && String(before[t.field] || "") !== String(req.body[t.field] || "")
      ).map((t) => ({ label: t.label, value: req.body[t.field] }));

      const emailTarget = customer_email || before.customer_email;
      if (changes.length && emailTarget) {
        try {
          const apptForEmail = { ...before, customer_name: customer_name || before.customer_name };
          const result = buildUpdatedDetailsEmail(apptForEmail, { changes });
          if (result) {
            await sendMail({ to: emailTarget, subject: result.subject, html: result.html, text: result.text });
            console.log("[update-email] Correo de cambios enviado a", emailTarget);
          }
        } catch (e) {
          console.error("[update-email]", e);
        }
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin] update appointment error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.delete("/appointments", async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_IDS" });
    }

    const uuids = ids
      .map((v) => (v == null ? "" : String(v).trim()))
      .filter(Boolean);

    if (uuids.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_IDS" });
    }

    await query("BEGIN");
    const r = await query(
      `DELETE FROM appointments WHERE id = ANY($1::uuid[])`,
      [uuids]
    );
    await query("COMMIT");

    return res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (err) {
    await query("ROLLBACK").catch(() => { });
    console.error("[admin] delete appointments error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ============================================================================
// AVAILABILITY WINDOWS - Gestión de horarios disponibles (cualquier día L-D)
// ============================================================================

router.get("/availability-windows", async (req, res) => {
  try {
    const { date, type } = req.query || {};
    if (!date) {
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });
    }

    const params = [date];
    let sql = `
      SELECT
        id,
        type_code,
        to_char(start_time,'HH24:MI') AS start,
        to_char(end_time,  'HH24:MI') AS end,
        slot_minutes
      FROM availability_windows
      WHERE date = $1
    `;
    if (type) {
      sql += ` AND type_code = $2`;
      params.push(type);
    }
    sql += ` ORDER BY start_time ASC`;

    const { rows } = await query(sql, params);
    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("[availability-windows][GET]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/availability-windows", async (req, res) => {
  try {
    const { date, type, ranges } = req.body || {};
    if (!date || !type || !Array.isArray(ranges) || !ranges.length) {
      return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
    }

    const validSlots = [15, 20, 30];

    await query("BEGIN");
    for (const r of ranges) {
      const start = String(r.start || "");
      const end = String(r.end || "");
      const minutes = Number(r.slot_minutes ?? 15);

      if (
        !/^\d{2}:\d{2}$/.test(start) ||
        !/^\d{2}:\d{2}$/.test(end) ||
        start >= end
      ) {
        await query("ROLLBACK").catch(() => { });
        return res.status(400).json({ ok: false, error: "INVALID_TIME" });
      }
      if (!validSlots.includes(minutes)) {
        await query("ROLLBACK").catch(() => { });
        return res.status(400).json({ ok: false, error: "INVALID_SLOT" });
      }

      await query(
        `INSERT INTO availability_windows(date,type_code,start_time,end_time,created_by,slot_minutes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [date, type, start, end, "admin", minutes]
      );
    }
    await query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    await query("ROLLBACK").catch(() => { });
    console.error("[availability-windows][POST]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.patch("/availability-windows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { start, end } = req.body || {};
    if (
      !/^\d{2}:\d{2}$/.test(start || "") ||
      !/^\d{2}:\d{2}$/.test(end || "") ||
      start >= end
    ) {
      return res.status(400).json({ ok: false, error: "INVALID_TIME" });
    }
    const { rows: cur } = await query(
      `SELECT date, type_code FROM availability_windows WHERE id=$1`,
      [id]
    );
    if (!cur.length)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const { date, type_code } = cur[0];

    const { rows: overlap } = await query(
      `
      SELECT 1
        FROM availability_windows
       WHERE date=$1 AND type_code=$2 AND id<>$3
         AND NOT ($4 >= end_time OR $5 <= start_time)
      `,
      [date, type_code, id, start, end]
    );
    if (overlap.length) {
      return res.status(400).json({ ok: false, error: "OVERLAP" });
    }

    await query(
      `UPDATE availability_windows
          SET start_time=$2, end_time=$3
        WHERE id=$1`,
      [id, start, end]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[PATCH availability-windows/:id]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.delete("/availability-windows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query(
      `DELETE FROM availability_windows WHERE id=$1 RETURNING id`,
      [id]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[availability-windows][DELETE]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ============================================================================
// BLACKLIST - Gestión de clientes bloqueados
// ============================================================================

// Buscar cliente por cédula, nombre o teléfono
router.get("/search-customer", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: "MISSING_QUERY" });
    }

    const searchTerm = `%${q.trim()}%`;

    // Buscar en appointments
    // Hacemos LEFT JOIN con blacklist para traer el estado de una vez
    // Agrupamos por los datos del cliente para consolidar estadísticas
    const { rows } = await query(
      `SELECT
        a.customer_name,
        a.customer_id_number,
        a.customer_email,
        a.customer_phone,
        COUNT(a.id) as total_appointments,
        COUNT(a.id) FILTER (WHERE a.status = 'NO_SHOW') as no_shows,
        COUNT(a.id) FILTER (WHERE a.status = 'CONFIRMED') as confirmed,
        COUNT(a.id) FILTER (WHERE a.status = 'DONE') as completed,
        COUNT(a.id) FILTER (WHERE a.status = 'CANCELLED') as cancelled,
        b.reason as blacklist_reason,
        b.blocked_at as blacklist_date,
        b.notes as blacklist_notes,
        CASE WHEN b.customer_id_number IS NOT NULL THEN true ELSE false END as is_blacklisted
      FROM appointments a
      LEFT JOIN customer_blacklist b ON a.customer_id_number = b.customer_id_number
      WHERE
        a.customer_id_number ILIKE $1 OR
        a.customer_phone ILIKE $1 OR
        a.customer_name ILIKE $1
      GROUP BY
        a.customer_name,
        a.customer_id_number,
        a.customer_email,
        a.customer_phone,
        b.customer_id_number,
        b.reason,
        b.blocked_at,
        b.notes
      LIMIT 50`,
      [searchTerm]
    );

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (err) {
    console.error("[search-customer]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Obtener datos completos del cliente más reciente por cédula (para autocompletar)
router.get("/customer-latest/:id_number", async (req, res) => {
  try {
    const { id_number } = req.params;
    const { rows } = await query(
      `SELECT customer_name, customer_id_number, customer_email, customer_phone,
              shipping_address, shipping_neighborhood, shipping_city, shipping_carrier
       FROM appointments
       WHERE customer_id_number = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id_number.trim()]
    );
    return res.json({ ok: true, customer: rows[0] || null });
  } catch (err) {
    console.error("[customer-latest]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Listar todos los clientes en blacklist
router.get("/blacklist", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customer_blacklist ORDER BY blocked_at DESC`
    );
    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("[blacklist][GET]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Agregar cliente a blacklist
router.post("/blacklist", async (req, res) => {
  try {
    const { customer_id_number, customer_name, customer_email, customer_phone, reason, appointment_id, notes } = req.body;

    if (!customer_id_number || !customer_name || !reason) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }

    const { rows } = await query(
      `INSERT INTO customer_blacklist
        (customer_id_number, customer_name, customer_email, customer_phone, reason, appointment_id, notes, blocked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin')
       ON CONFLICT (customer_id_number)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         notes = EXCLUDED.notes,
         blocked_at = NOW()
       RETURNING *`,
      [customer_id_number, customer_name, customer_email, customer_phone, reason, appointment_id || null, notes || null]
    );

    return res.json({ ok: true, blacklist: rows[0] });
  } catch (err) {
    console.error("[blacklist][POST]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Eliminar cliente de blacklist (desbloquear)
router.delete("/blacklist/:id_number", async (req, res) => {
  try {
    const { id_number } = req.params;
    const { rowCount } = await query(
      `DELETE FROM customer_blacklist WHERE customer_id_number = $1`,
      [id_number]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[blacklist][DELETE]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ── CATÁLOGO DE PRODUCTOS ─────────────────────────────────────────────────────

const PRODUCTS_DIR = path.join(__dirname, "..", "uploads", "products");
fs.mkdirSync(PRODUCTS_DIR, { recursive: true });

// Listar todos los productos (admin ve disponibles e indisponibles)
router.get("/products", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM products ORDER BY price ASC, name ASC`
    );
    return res.json({ ok: true, products: rows });
  } catch (err) {
    console.error("[admin/products GET]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

const VALID_TIERS = ["Baja", "Media", "Alta"];

// Crear producto
router.post("/products", async (req, res) => {
  try {
    const { name, category, memory_capacity, price, condition, description, available, image_url, tier, is_flagship } = req.body;
    if (!name?.trim() || !category?.trim() || price === undefined || price === null || price === "") {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS" });
    }
    const tierValue = VALID_TIERS.includes(tier) ? tier : null;
    const { rows } = await query(
      `INSERT INTO products (name, category, memory_capacity, price, condition, description, available, image_url, tier, is_flagship)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name.trim(),
        category.trim(),
        memory_capacity?.trim() || null,
        Number(price),
        condition?.trim() || "",
        description?.trim() || null,
        available !== false,
        image_url || null,
        tierValue,
        is_flagship === true,
      ]
    );
    return res.status(201).json({ ok: true, product: rows[0] });
  } catch (err) {
    console.error("[admin/products POST]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Actualizar producto
router.patch("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, memory_capacity, price, condition, description, available, image_url, tier, is_flagship } = req.body;

    // Si viene image_url en el body la actualiza; si no viene (undefined), conserva la existente
    const hasImage = image_url !== undefined;
    const tierValue = VALID_TIERS.includes(tier) ? tier : null;
    const flagshipValue = is_flagship === true;

    const { rows } = await query(
      hasImage
        ? `UPDATE products SET name=$1, category=$2, memory_capacity=$3, price=$4,
                condition=$5, description=$6, available=$7, image_url=$8, tier=$9, is_flagship=$10, updated_at=NOW()
           WHERE id=$11 RETURNING *`
        : `UPDATE products SET name=$1, category=$2, memory_capacity=$3, price=$4,
                condition=$5, description=$6, available=$7, tier=$8, is_flagship=$9, updated_at=NOW()
           WHERE id=$10 RETURNING *`,
      hasImage
        ? [name?.trim() ?? "", category?.trim() ?? "", memory_capacity?.trim() || null,
           Number(price ?? 0), condition?.trim() ?? "", description?.trim() || null,
           available !== false, image_url || null, tierValue, flagshipValue, id]
        : [name?.trim() ?? "", category?.trim() ?? "", memory_capacity?.trim() || null,
           Number(price ?? 0), condition?.trim() ?? "", description?.trim() || null,
           available !== false, tierValue, flagshipValue, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({ ok: true, product: rows[0] });
  } catch (err) {
    console.error("[admin/products PATCH]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Eliminar producto
router.delete("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query(`DELETE FROM products WHERE id = $1 RETURNING image_url`, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (rows[0].image_url) {
      const filename = rows[0].image_url.split("/").pop();
      const filePath = path.join(PRODUCTS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/products DELETE]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ── Categorías / secciones del catálogo ────────────────────────────────────

router.get("/categories", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, color, sort_order FROM categories ORDER BY sort_order ASC, name ASC`
    );
    return res.json({ ok: true, categories: rows });
  } catch (err) {
    console.error("[admin/categories GET]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Crear categoría/sección
router.post("/categories", async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, error: "MISSING_NAME" });

    const { rows: maxRows } = await query(`SELECT COALESCE(MAX(sort_order), -1) AS max FROM categories`);
    const sortOrder = Number(maxRows[0].max) + 1;

    const { rows } = await query(
      `INSERT INTO categories (name, color, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), color || "#64748b", sortOrder]
    );
    return res.status(201).json({ ok: true, category: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "DUPLICATE_NAME" });
    console.error("[admin/categories POST]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Actualizar color de una categoría
router.patch("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { color } = req.body;
    if (!color?.trim()) return res.status(400).json({ ok: false, error: "MISSING_COLOR" });

    const { rows } = await query(
      `UPDATE categories SET color = $1 WHERE id = $2 RETURNING *`,
      [color.trim(), id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({ ok: true, category: rows[0] });
  } catch (err) {
    console.error("[admin/categories PATCH]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Eliminar categoría/sección (solo si ningún producto la usa)
router.delete("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: catRows } = await query(`SELECT name FROM categories WHERE id = $1`, [id]);
    if (!catRows.length) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS count FROM products WHERE category = $1`,
      [catRows[0].name]
    );
    if (countRows[0].count > 0) {
      return res.status(409).json({ ok: false, error: "CATEGORY_IN_USE", count: countRows[0].count });
    }

    await query(`DELETE FROM categories WHERE id = $1`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/categories DELETE]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Subir / reemplazar imagen del producto (base64 en JSON)
router.post("/products/:id/image", async (req, res) => {
  try {
    const { id } = req.params;
    const { image, ext = "jpg" } = req.body;
    if (!image) return res.status(400).json({ ok: false, error: "MISSING_IMAGE" });

    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext.toLowerCase())
      ? ext.toLowerCase()
      : "jpg";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${safeExt}`;
    const filePath = path.join(PRODUCTS_DIR, filename);

    // Borrar imagen anterior si existe
    const { rows: oldRows } = await query(`SELECT image_url FROM products WHERE id = $1`, [id]);
    if (oldRows[0]?.image_url) {
      const oldFilename = oldRows[0].image_url.split("/").pop();
      const oldPath = path.join(PRODUCTS_DIR, oldFilename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    fs.writeFileSync(filePath, Buffer.from(image, "base64"));
    const publicUrl = `/uploads/products/${filename}`;
    await query(`UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2`, [publicUrl, id]);

    return res.json({ ok: true, image_url: publicUrl });
  } catch (err) {
    console.error("[admin/products image]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Leer configuración de la tienda
router.get("/store-settings", async (req, res) => {
  try {
    const { rows } = await query(`SELECT key, value FROM store_settings`);
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error("[admin/store-settings GET]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Guardar configuración de la tienda
router.patch("/store-settings", async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ ok: false, error: "INVALID_BODY" });
    }
    for (const [key, value] of Object.entries(settings)) {
      await query(
        `INSERT INTO store_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/store-settings PATCH]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ── BÚSQUEDA DE IMÁGENES (Google Custom Search) ───────────────────────────────

router.get("/image-search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.status(400).json({ ok: false, error: "MISSING_QUERY" });

    const key = process.env.SERPAPI_KEY;
    if (!key) return res.status(500).json({ ok: false, error: "SERPAPI_NOT_CONFIGURED" });

    const params = new URLSearchParams({
      engine: "google_images",
      api_key: key,
      q: q.trim(),
      num: "16",
      safe: "active",
    });

    const r    = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await r.json();

    if (!r.ok || data.error) {
      console.error("[image-search] SerpAPI error:", data.error ?? data);
      return res.status(502).json({ ok: false, error: "SEARCH_ERROR" });
    }

    const images = (data.images_results || []).slice(0, 16).map((item) => ({
      url:   item.original,
      thumb: item.thumbnail,
      title: item.title,
    }));

    return res.json({ ok: true, images });
  } catch (err) {
    console.error("[image-search]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Descargar imagen desde URL externa y guardarla en el servidor
router.post("/products/:id/image-url", async (req, res) => {
  try {
    const { id }  = req.params;
    const { url } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: "MISSING_URL" });

    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TechVenturesCO/1.0)" },
      redirect: "follow",
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: "FETCH_FAILED" });

    const contentType = r.headers.get("content-type") || "image/jpeg";
    const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const ext    = extMap[contentType.split(";")[0].trim()] ?? "jpg";

    const buffer   = Buffer.from(await r.arrayBuffer());
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(PRODUCTS_DIR, filename);

    // Borrar imagen anterior si existe
    const { rows: oldRows } = await query(`SELECT image_url FROM products WHERE id = $1`, [id]);
    if (oldRows[0]?.image_url?.startsWith("/uploads/")) {
      const oldFilename = oldRows[0].image_url.split("/").pop();
      const oldPath = path.join(PRODUCTS_DIR, oldFilename);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/products/${filename}`;
    await query(`UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2`, [publicUrl, id]);

    return res.json({ ok: true, image_url: publicUrl });
  } catch (err) {
    console.error("[image-url]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ── Passkeys (WebAuthn) para login del admin con Windows Hello / huella ────
const ADMIN_USER_ID = crypto.createHash("sha256").update("techventuresco-admin").digest();

router.get("/webauthn/credentials", async (req, res) => {
  const { rows } = await query(
    "SELECT id, device_name, created_at, last_used_at FROM admin_passkeys ORDER BY created_at DESC"
  );
  res.json({ ok: true, credentials: rows });
});

router.post("/webauthn/register-options", async (req, res) => {
  const { rows } = await query("SELECT credential_id, transports FROM admin_passkeys");
  const excludeCredentials = rows.map((r) => ({
    id: r.credential_id,
    transports: r.transports ? r.transports.split(",") : undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: "admin",
    userID: ADMIN_USER_ID,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  setChallenge("register", options.challenge);
  res.json({ ok: true, options });
});

router.post("/webauthn/register-verify", async (req, res) => {
  const { response, deviceName } = req.body || {};
  const expectedChallenge = takeChallenge("register");
  if (!expectedChallenge || !response?.id) {
    return res.status(400).json({ ok: false, error: "INVALID_REQUEST" });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
    });
  } catch (e) {
    console.error("[webauthn/register-verify]", e.message);
    return res.status(400).json({ ok: false, error: "VERIFICATION_FAILED" });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ ok: false, error: "VERIFICATION_FAILED" });
  }

  const { credential } = verification.registrationInfo;

  await query(
    `INSERT INTO admin_passkeys (credential_id, public_key, counter, device_name, transports)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      credential.id,
      Buffer.from(credential.publicKey).toString("base64"),
      credential.counter,
      (deviceName || "").slice(0, 100) || "Dispositivo",
      credential.transports ? credential.transports.join(",") : null,
    ]
  );

  res.json({ ok: true });
});

router.delete("/webauthn/credentials/:id", async (req, res) => {
  await query("DELETE FROM admin_passkeys WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
