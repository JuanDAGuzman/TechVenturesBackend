// services/admin.js (o routes/admin.js)
import express from "express";
import { query } from "../db.js";

import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { buildShippedEmail } from "../services/emailTemplates.js";
import { sendMail } from "../services/mailer.js";

const router = express.Router();

// 1) Primero __filename / __dirname (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2) Luego paths que dependan de __dirname
const GUIDES_DIR = path.join(__dirname, "..", "uploads", "shipping-guides");

// 3) Asegurar carpeta de guías
fs.mkdirSync(GUIDES_DIR, { recursive: true });

/* ───────────────────────────
   Multer: guía adjunta (PDF/JPG/PNG/WEBP)
   ─────────────────────────── */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, GUIDES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = /pdf|png|jpg|jpeg|webp/i.test(
      path.extname(file.originalname || "").slice(1)
    );
    cb(ok ? null : new Error("INVALID_FILE"));
  },
});

/* ───────────────────────────
   Auth admin por header x-admin-token
   ─────────────────────────── */
router.use((req, res, next) => {
  const token = req.headers["x-admin-token"];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  next();
});

/* ───────────────────────────
   GET /api/admin/appointments?date=YYYY-MM-DD
   ─────────────────────────── */
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

/* ───────────────────────────
   GET /api/admin/appointments/:id
   ─────────────────────────── */
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

/* ───────────────────────────
   PATCH /api/admin/appointments/:id/ship
   body: tracking_number (text)
         shipping_cost (number, opcional)
         shipping_trip_link (text, opcional; útil en PICAP)
   file: guía (pdf/jpg/png/webp) (opcional) — campo: guide
   ─────────────────────────── */
router.patch(
  "/appointments/:id/ship",
  upload.any(), // sigue permitiendo multipart para adjunto de guía
  async (req, res) => {
    try {
      const { id } = req.params;

      // Lee la cita
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

      // Normaliza body (puede venir json o multipart)
      const body = req.body || {};
      const tracking_number = (body.tracking_number || "").trim();
      const shipping_cost_raw = body.shipping_cost ?? null;
      const shipping_cost =
        shipping_cost_raw === null || shipping_cost_raw === ""
          ? null
          : Number(shipping_cost_raw);
      const shipping_trip_link = (body.shipping_trip_link || "").trim();

      // Archivo (solo para transportadoras con guía)
      const file =
        Array.isArray(req.files) && req.files.length ? req.files[0] : null;
      let publicUrl = appt.tracking_file_url || null;
      if (file?.filename) {
        publicUrl = `/uploads/shipping-guides/${file.filename}`;
      }

      // Reglas por carrier
      if (carrier === "PICAP") {
        if (!shipping_trip_link) {
          return res
            .status(400)
            .json({ ok: false, error: "MISSING_TRIP_LINK" });
        }
        // Marca enviado sin guía
        await query(
          `
          UPDATE appointments
          SET status = 'SHIPPED',
              tracking_number    = NULL,
              tracking_file_url  = NULL,
              shipping_cost      = COALESCE($2, shipping_cost),
              shipping_trip_link = $3,
              shipped_at         = NOW()
          WHERE id = $1
        `,
          [id, shipping_cost, shipping_trip_link]
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
              tracking_file_url  = $3,
              shipping_cost      = COALESCE($4, shipping_cost),
              shipped_at         = NOW()
          WHERE id = $1
        `,
          [id, tracking_number, publicUrl, shipping_cost]
        );
      }

      // Relee para correo
      const { rows: r2 } = await query(
        `SELECT * FROM appointments WHERE id=$1`,
        [id]
      );
      const updated = r2[0];

      // Email a cliente
      try {
        const { subject, html, text } = buildShippedEmail(updated, {
          trackingNumber: carrier === "PICAP" ? null : tracking_number,
          publicUrl: carrier === "PICAP" ? null : publicUrl,
          shippingCost: shipping_cost,
          rideUrl: carrier === "PICAP" ? shipping_trip_link : null,
        });

        const adminBcc = (process.env.MAIL_NOTIFY || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        await sendMail({
          to: updated.customer_email,
          subject,
          html,
          text,
          ...(file && carrier !== "PICAP"
            ? {
                attachments: [
                  {
                    filename: file.originalname,
                    path: path.join(GUIDES_DIR, file.filename),
                  },
                ],
              }
            : {}),
          ...(adminBcc.length ? { bcc: adminBcc } : {}),
        });
      } catch (e) {
        console.warn("[ship-email]", e.message);
      }

      // Copia a admin
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
            adminCopy: true,
          });
          await sendMail({
            to: adminTo,
            subject: `Copia — ${subject}`,
            html,
            text,
            attachments:
              file && carrier !== "PICAP"
                ? [
                    {
                      filename: file.originalname,
                      path: path.join(GUIDES_DIR, file.filename),
                    },
                  ]
                : [],
          });
        }
      } catch (e) {
        console.warn("[ship-email][admin]", e.message);
      }

      return res.json({
        ok: true,
        item: {
          id,
          status: "SHIPPED",
          tracking_number: carrier === "PICAP" ? null : tracking_number,
          tracking_file_url: carrier === "PICAP" ? null : publicUrl,
          shipping_cost,
          shipping_trip_link: carrier === "PICAP" ? shipping_trip_link : null,
        },
      });
    } catch (err) {
      console.error("[admin] ship error:", err);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
  }
);

/* ───────────────────────────
   PATCH /api/admin/appointments/:id (editar)
   ─────────────────────────── */
router.patch("/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
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
    RETURNING id

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
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin] update appointment error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ───────────────────────────
   DELETE /api/admin/appointments (masivo)
   ─────────────────────────── */
router.delete("/appointments", async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "INVALID_IDS" });
    }
    await query("BEGIN");
    await query(`DELETE FROM appointments WHERE id = ANY($1::uuid[])`, [ids]);
    await query("COMMIT");
    return res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    await query("ROLLBACK").catch(() => {});
    console.error("[admin] delete appointments error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

/* ───────────────────────────
   SÁBADOS — ventanas de disponibilidad
   ─────────────────────────── */
// POST /api/admin/saturday-windows
// Guarda rangos. Por defecto AGREGA sin borrar; si quieres reemplazar todo usa ?replace=1
router.post("/saturday-windows", async (req, res) => {
  try {
    const { date, ranges } = req.body || {};
    if (!date || !Array.isArray(ranges) || !ranges.length) {
      return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
    }

    const validSlots = [15, 20, 30];
    await query("BEGIN");

    for (const r of ranges) {
      const start = (r.start || "").trim();
      const end = (r.end || "").trim();
      const minutes = Number(r.slot_minutes ?? 15);

      if (
        !/^\d{2}:\d{2}$/.test(start) ||
        !/^\d{2}:\d{2}$/.test(end) ||
        start >= end ||
        !validSlots.includes(minutes)
      ) {
        await query("ROLLBACK").catch(() => {});
        return res
          .status(400)
          .json({ ok: false, error: "INVALID_TIME_OR_SLOT" });
      }

      await query(
        `
        INSERT INTO saturday_windows(date, start_time, end_time, created_by, slot_minutes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (date, start_time, end_time) DO NOTHING
        `,
        [date, start, end, "admin", minutes]
      );
    }

    await query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await query("ROLLBACK").catch(() => {});
    console.error("[admin] saturday-windows POST error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/saturday-windows", async (req, res) => {
  try {
    const { date } = req.query || {};
    if (!date)
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });

    const { rows } = await query(
      `
      SELECT id,
             to_char(start_time,'HH24:MI') AS start_time,
             to_char(end_time,  'HH24:MI') AS end_time,
             slot_minutes
        FROM saturday_windows
       WHERE date=$1
       ORDER BY start_time ASC
      `,
      [date]
    );
    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("[admin] saturday-windows GET error:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.delete("/saturday-windows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await query(
      `DELETE FROM saturday_windows WHERE id=$1 RETURNING id`,
      [id]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin] saturday-windows DELETE by id error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// PATCH /api/admin/saturday-windows/:id  body: { start, end }
router.patch("/saturday-windows/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { start, end, slot_minutes } = req.body || {};
    const validSlots = [15, 20, 30];

    if (
      !/^\d{2}:\d{2}$/.test(start) ||
      !/^\d{2}:\d{2}$/.test(end) ||
      start >= end ||
      (slot_minutes != null && !validSlots.includes(Number(slot_minutes)))
    ) {
      return res.status(400).json({ ok: false, error: "INVALID_TIME_OR_SLOT" });
    }

    const r = await query(
      `
      UPDATE saturday_windows
         SET start_time = $2,
             end_time   = $3,
             slot_minutes = COALESCE($4, slot_minutes)
       WHERE id = $1
       RETURNING id
      `,
      [id, start, end, slot_minutes ?? null]
    );

    if (!r.rowCount)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[saturday-windows][PATCH]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.delete("/saturday-windows", async (req, res) => {
  try {
    const { date } = req.query || {};
    if (!date) {
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });
    }
    const r = await query(`DELETE FROM saturday_windows WHERE date=$1`, [date]);
    return res.json({ ok: true, deleted: r.rowCount || 0 });
  } catch (err) {
    console.error("[admin] saturday-windows DELETE by date error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.get("/weekday-windows", async (req, res) => {
  try {
    const { date, type } = req.query || {};
    if (!date)
      return res.status(400).json({ ok: false, error: "MISSING_DATE" });

    const params = [date];
    let sql = `
      SELECT id,
             type_code,
             to_char(start_time,'HH24:MI') AS start,
             to_char(end_time,'HH24:MI')   AS end
        FROM weekday_windows
       WHERE date=$1`;

    if (type) {
      sql += ` AND type_code=$2`;
      params.push(type);
    }
    sql += ` ORDER BY type_code, start_time ASC`;

    const { rows } = await query(sql, params);
    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("[weekday-windows][GET]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

router.post("/weekday-windows", async (req, res) => {
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
        await query("ROLLBACK").catch(() => {});
        return res.status(400).json({ ok: false, error: "INVALID_TIME" });
      }
      if (!validSlots.includes(minutes)) {
        await query("ROLLBACK").catch(() => {});
        return res.status(400).json({ ok: false, error: "INVALID_SLOT" });
      }

      await query(
        `INSERT INTO weekday_windows(date,type_code,start_time,end_time,created_by,slot_minutes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [date, type, start, end, "admin", minutes]
      );
    }
    await query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    await query("ROLLBACK").catch(() => {});
    console.error("[weekday-windows][POST]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// PATCH /api/admin/weekday-windows/:id  body: { start, end }
router.patch("/weekday-windows/:id", async (req, res) => {
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
      `SELECT date, type_code FROM weekday_windows WHERE id=$1`,
      [id]
    );
    if (!cur.length)
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    const { date, type_code } = cur[0];

    // evitar solapes con otros manuales del mismo día+tipo
    const { rows: overlap } = await query(
      `
      SELECT 1
        FROM weekday_windows
       WHERE date=$1 AND type_code=$2 AND id<>$3
         AND NOT ($4 >= end_time OR $5 <= start_time)
      `,
      [date, type_code, id, start, end]
    );
    if (overlap.length) {
      return res.status(400).json({ ok: false, error: "OVERLAP" });
    }

    await query(
      `UPDATE weekday_windows
          SET start_time=$2, end_time=$3
        WHERE id=$1`,
      [id, start, end]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error("[PATCH weekday-windows/:id]", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});
export default router;
