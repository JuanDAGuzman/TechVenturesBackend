import { Router } from "express";
import { query } from "../db.js";

const router = Router();

// ── Palabras a eliminar (marcas, series, SKUs) ────────────────────────────────
const NOISE_WORDS = [
  // Fabricantes GPU/CPU
  "nvidia","amd","intel",
  // Marcas AIB
  "asus","evga","msi","gigabyte","sapphire","xfx","powercolor","palit",
  "zotac","pny","inno3d","gainward","galax","colorful","manli",
  // Sub-marcas y series
  "rog","strix","aorus","nitro\\+","nitro","red devil","hellhound","pulse",
  "gaming x trio","gaming x","gaming oc","gaming","ventus","trio","suprim",
  "eagle","dual","tuf","phoenix","rebel","founders edition","founders",
  "reference","black edition","white edition","black","white","edition",
  "boost","le","v2","v3",
  // Prefijos de arquitectura (versión CON espacio: "RTX 3070")
  "rtx","gtx","rx","geforce","radeon",
  // Códigos de SKU
  "xc3","ftw3","ftw","xc ultra","xc","oc",
  // Prefijos de familia CPU
  "core","ryzen","threadripper","pentium","celeron","athlon",
];

const NOISE_RE = new RegExp(`\\b(${NOISE_WORDS.join("|")})\\b`, "gi");

// Prefijos de arquitectura pegados al número sin espacio: rx580, rtx3070, gtx1660
const ARCH_GLUED_RE = /\b(rtx|gtx|rx|radeon|geforce)(?=\d)/gi;

// Specs de memoria/capacidad: 8gb, 16gb, 1tb, 512mb, 24gb gddr6x, etc.
const MEMORY_RE = /\b\d+\s*(gb|tb|mb|gddr\w*)\b/gi;

// Cantidades de unidades: "x5", "x2" al final (ej. "5600xt x5" = 5 unidades)
const QUANTITY_RE = /\bx\d+\b/gi;

// Normalizar sufijos de modelo: "3060ti" → "3060 ti", "5600xt" → "5600 xt"
const SUFFIX_RE = /(\d)(ti|xt|xtx|super|gre|plus|ultra)\b/gi;

function normalizeProduct(raw) {
  if (!raw?.trim()) return null;
  let s = raw.toLowerCase().replace(/-/g, " ").trim();

  // 1. Prefijos de arquitectura sin espacio (rx580 → 580, rtx3070 → 3070)
  s = s.replace(ARCH_GLUED_RE, "");

  // 2. Palabras de ruido con word boundary (marcas, series, prefijos con espacio)
  s = s.replace(NOISE_RE, " ");

  // 2b. Limpiar caracteres no alfanuméricos sobrantes (ej. "+" de "nitro+")
  s = s.replace(/[^a-z0-9\s]/g, " ");

  // 3. Specs de memoria (8gb, 16gb gddr6x, etc.)
  s = s.replace(MEMORY_RE, " ");

  // 4. Cantidades de unidades (x2, x5…)
  s = s.replace(QUANTITY_RE, " ");

  // 5. Asegurar espacio entre número y sufijo de modelo
  s = s.replace(SUFFIX_RE, "$1 $2");

  // 6. Colapsar espacios
  s = s.replace(/\s+/g, " ").trim();

  return s || null;
}

// Agrupa un array de { name, count } por nombre normalizado.
// Devuelve [{ name, count, variants }] ordenado desc por count.
function groupByNormalized(rows) {
  const map = new Map();
  for (const { name, count } of rows) {
    const key = normalizeProduct(name) ?? "(sin producto)";
    if (!map.has(key)) map.set(key, { name: key, count: 0, variants: [] });
    const entry = map.get(key);
    entry.count += Number(count);
    if (name && !entry.variants.includes(name)) entry.variants.push(name);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// GET /api/admin/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/", async (req, res) => {
  try {
    const {
      from = "2000-01-01",
      to   = "2099-12-31",
    } = req.query;

    // ── 1. Overview global ──────────────────────────────────────────────────
    const overviewQ = await query(`
      SELECT
        COUNT(*)                                            AS total,
        COUNT(*) FILTER (WHERE status = 'DONE')            AS done,
        COUNT(*) FILTER (WHERE status = 'SHIPPED')         AS shipped,
        COUNT(*) FILTER (WHERE status = 'CONFIRMED')       AS confirmed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')       AS cancelled,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')         AS no_show,
        COUNT(*) FILTER (WHERE type_code = 'TRYOUT')       AS tryout,
        COUNT(*) FILTER (WHERE type_code = 'PICKUP')       AS pickup,
        COUNT(*) FILTER (WHERE type_code = 'SHIPPING')     AS shipping_type,
        COUNT(*) FILTER (WHERE delivery_method = 'IN_PERSON')  AS in_person,
        COUNT(*) FILTER (WHERE delivery_method = 'SHIPPING')   AS by_shipping,
        COUNT(*) FILTER (WHERE shipping_carrier = 'PICAP')        AS picap,
        COUNT(*) FILTER (WHERE shipping_carrier = 'INTERRAPIDISIMO') AS interrapidisimo,
        COALESCE(SUM(shipping_cost) FILTER (WHERE status = 'SHIPPED'), 0) AS shipping_revenue
      FROM appointments
      WHERE date BETWEEN $1 AND $2
    `, [from, to]);

    const overview = overviewQ.rows[0];

    // ── 2. Timeline diario ──────────────────────────────────────────────────
    const timelineQ = await query(`
      SELECT
        date::text            AS date,
        COUNT(*)              AS total,
        COUNT(*) FILTER (WHERE status IN ('DONE','SHIPPED'))  AS completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')          AS cancelled,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW')            AS no_show
      FROM appointments
      WHERE date BETWEEN $1 AND $2
      GROUP BY date
      ORDER BY date ASC
    `, [from, to]);

    // ── 3. Top productos (texto libre → normalizado) ────────────────────────
    const productsQ = await query(`
      SELECT product AS name, COUNT(*) AS count
      FROM appointments
      WHERE date BETWEEN $1 AND $2
        AND product IS NOT NULL AND product <> ''
      GROUP BY product
      ORDER BY count DESC
      LIMIT 200
    `, [from, to]);

    const products = groupByNormalized(productsQ.rows).slice(0, 20);

    // ── 4. Clientes frecuentes ──────────────────────────────────────────────
    const customersQ = await query(`
      SELECT
        customer_name                         AS name,
        customer_id_number                    AS id_number,
        customer_phone                        AS phone,
        COUNT(*)                              AS total,
        COUNT(*) FILTER (WHERE status IN ('DONE','SHIPPED')) AS completed,
        MAX(date)::text                       AS last_date
      FROM appointments
      WHERE date BETWEEN $1 AND $2
      GROUP BY customer_name, customer_id_number, customer_phone
      HAVING COUNT(*) > 1
      ORDER BY total DESC
      LIMIT 20
    `, [from, to]);

    // ── 5. Distribución por día de la semana ────────────────────────────────
    const weekdayQ = await query(`
      SELECT
        EXTRACT(DOW FROM date)::int  AS dow,
        COUNT(*)                     AS total
      FROM appointments
      WHERE date BETWEEN $1 AND $2
      GROUP BY dow
      ORDER BY dow
    `, [from, to]);

    const DAYS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    const weekdays = DAYS.map((label, i) => {
      const row = weekdayQ.rows.find(r => Number(r.dow) === i);
      return { day: label, total: row ? Number(row.total) : 0 };
    });

    // ── 6. Ciudades de envío ────────────────────────────────────────────────
    const citiesQ = await query(`
      SELECT
        COALESCE(NULLIF(TRIM(shipping_city),''), 'Sin ciudad') AS city,
        COUNT(*) AS total
      FROM appointments
      WHERE date BETWEEN $1 AND $2
        AND type_code = 'SHIPPING'
      GROUP BY city
      ORDER BY total DESC
      LIMIT 15
    `, [from, to]);

    // ── 7. Timeline mensual (para vista de largo plazo) ─────────────────────
    const monthlyQ = await query(`
      SELECT
        TO_CHAR(date, 'YYYY-MM')              AS month,
        COUNT(*)                              AS total,
        COUNT(*) FILTER (WHERE status IN ('DONE','SHIPPED')) AS completed
      FROM appointments
      WHERE date BETWEEN $1 AND $2
      GROUP BY month
      ORDER BY month ASC
    `, [from, to]);

    return res.json({
      ok: true,
      period: { from, to },
      overview: {
        total:           Number(overview.total),
        byStatus: {
          done:          Number(overview.done),
          shipped:       Number(overview.shipped),
          confirmed:     Number(overview.confirmed),
          cancelled:     Number(overview.cancelled),
          no_show:       Number(overview.no_show),
        },
        byType: {
          tryout:        Number(overview.tryout),
          pickup:        Number(overview.pickup),
          shipping:      Number(overview.shipping_type),
        },
        byCarrier: {
          picap:         Number(overview.picap),
          interrapidisimo: Number(overview.interrapidisimo),
        },
        shippingRevenue: Number(overview.shipping_revenue),
      },
      timeline:  timelineQ.rows.map(r => ({
        date:      r.date,
        total:     Number(r.total),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
        no_show:   Number(r.no_show),
      })),
      monthly: monthlyQ.rows.map(r => ({
        month:     r.month,
        total:     Number(r.total),
        completed: Number(r.completed),
      })),
      products,
      customers: customersQ.rows.map(r => ({
        name:      r.name,
        id_number: r.id_number,
        phone:     r.phone,
        total:     Number(r.total),
        completed: Number(r.completed),
        last_date: r.last_date,
      })),
      weekdays,
      cities: citiesQ.rows.map(r => ({
        city:  r.city,
        total: Number(r.total),
      })),
    });
  } catch (err) {
    console.error("[metrics]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

export default router;
