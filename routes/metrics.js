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

// ── Normalización de texto libre (ciudades, nombres) ──────────────────────────
// Quita tildes/diacríticos y colapsa mayúsculas/espacios para poder agrupar
// "bogota", "Bogotá", "BOGOTÁ " como el mismo valor.
function stripAccents(s) {
  // Descompone acentos (NFD) y descarta los caracteres de marca diacrítica
  // combinante (rango Unicode 0x0300–0x036F) sin escribir el rango como
  // literal de regex, para evitar mojibake al editar este archivo.
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("");
}

function normalizeText(raw) {
  if (!raw?.trim()) return null;
  return stripAccents(raw.toLowerCase().trim()).replace(/\s+/g, " ");
}

function toTitleCase(s) {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// Alias de ciudades que suelen escribirse de más de una forma
const CITY_ALIASES = {
  "bogota dc": "bogota",
  "bogota d c": "bogota",
  "bogota distrito capital": "bogota",
};

function normalizeCity(raw) {
  let key = normalizeText(raw);
  if (!key) return null;
  key = key.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  return CITY_ALIASES[key] ?? key;
}

// Agrupa filas { city, count } por ciudad normalizada.
// Devuelve [{ city, total, variants }] ordenado desc por total.
function groupCities(rows) {
  const map = new Map();
  for (const { city, count } of rows) {
    const norm = normalizeCity(city);
    const key = norm ?? "__sin_ciudad__";
    if (!map.has(key)) {
      map.set(key, { city: norm ? toTitleCase(norm) : "Sin ciudad", total: 0, variants: [] });
    }
    const entry = map.get(key);
    entry.total += Number(count);
    const original = city?.trim();
    if (original && !entry.variants.includes(original)) entry.variants.push(original);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ── Identidad real de un cliente a partir de citas individuales ──────────────
// Agrupar por texto exacto de nombre/teléfono fragmenta al mismo cliente si
// alguna cita tiene el nombre en minúsculas o el teléfono con otro formato.
// La cédula es el identificador confiable; si falta, se usa el teléfono
// (solo dígitos) y, en último caso, el nombre normalizado.
function normalizePhoneDigits(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function customerKey(row) {
  const id = row.id_number?.trim();
  if (id) return `id:${id}`;
  const phone = normalizePhoneDigits(row.phone);
  if (phone) return `phone:${phone}`;
  return `name:${normalizeText(row.name) ?? "desconocido"}`;
}

// Agrupa citas individuales por cliente. Devuelve solo quienes tienen > 1 cita.
function groupCustomers(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = customerKey(r);
    if (!map.has(key)) {
      map.set(key, { name: r.name, id_number: r.id_number, phone: r.phone, total: 0, completed: 0, last_date: r.date });
    }
    const entry = map.get(key);
    entry.total += 1;
    if (r.status === "DONE" || r.status === "SHIPPED") entry.completed += 1;
    // Conserva el nombre/teléfono/cédula más reciente como dato representativo
    if (!entry.last_date || r.date > entry.last_date) {
      entry.last_date  = r.date;
      entry.name       = r.name || entry.name;
      entry.phone      = r.phone || entry.phone;
      entry.id_number  = r.id_number || entry.id_number;
    } else {
      entry.id_number = entry.id_number || r.id_number;
    }
  }
  return [...map.values()].filter((e) => e.total > 1).sort((a, b) => b.total - a.total);
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

    // ── 4. Clientes frecuentes (agrupados por cédula/teléfono, no por texto) ──
    const customersQ = await query(`
      SELECT
        customer_name       AS name,
        customer_id_number  AS id_number,
        customer_phone      AS phone,
        status,
        date::text          AS date
      FROM appointments
      WHERE date BETWEEN $1 AND $2
    `, [from, to]);

    const customers = groupCustomers(customersQ.rows).slice(0, 20);

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

    // ── 6. Ciudades de envío (agrupadas por nombre normalizado) ──────────────
    const citiesQ = await query(`
      SELECT
        shipping_city AS city,
        COUNT(*)      AS count
      FROM appointments
      WHERE date BETWEEN $1 AND $2
        AND type_code = 'SHIPPING'
      GROUP BY shipping_city
      ORDER BY count DESC
    `, [from, to]);

    const cities = groupCities(citiesQ.rows).slice(0, 15);

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
      customers: customers.map(c => ({
        name:      c.name,
        id_number: c.id_number,
        phone:     c.phone,
        total:     c.total,
        completed: c.completed,
        last_date: c.last_date,
      })),
      weekdays,
      cities: cities.map(c => ({
        city:     c.city,
        total:    c.total,
        variants: c.variants,
      })),
    });
  } catch (err) {
    console.error("[metrics]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

export default router;
