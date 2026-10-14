import express from "express";
import { query } from "../db.js";

const router = express.Router();

// Listar productos (público) — filtros opcionales: category, q, min_price, max_price
router.get("/products", async (req, res) => {
  try {
    const { category, q, min_price, max_price } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (category && category !== "Todos") {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (q && q.trim()) {
      conditions.push(`name ILIKE $${idx++}`);
      params.push(`%${q.trim()}%`);
    }
    if (min_price && !isNaN(Number(min_price))) {
      conditions.push(`price >= $${idx++}`);
      params.push(Number(min_price));
    }
    if (max_price && !isNaN(Number(max_price))) {
      conditions.push(`price <= $${idx++}`);
      params.push(Number(max_price));
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await query(
      `SELECT id, name, category, memory_capacity, price, original_price, condition, image_url, available, description, tier, is_flagship, whatsapp_number
       FROM products ${where}
       ORDER BY price ASC, name ASC`,
      params
    );

    return res.json({ ok: true, products: rows });
  } catch (err) {
    console.error("[catalog/products]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Listar categorías/secciones del catálogo (público)
router.get("/categories", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, color, parent_id FROM categories ORDER BY sort_order ASC, name ASC`
    );
    return res.json({ ok: true, categories: rows });
  } catch (err) {
    console.error("[catalog/categories]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Configuración pública de la tienda
router.get("/settings", async (req, res) => {
  try {
    const { rows } = await query(`SELECT key, value FROM store_settings`);
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error("[catalog/settings]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// Ofertas de cantidad/bundle activas (público)
router.get("/bundle-deals", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        bd.id, bd.match_name, bd.min_quantity, bd.bundle_price, bd.sort_order,
        COALESCE(
          json_agg(
            json_build_object(
              'id', p.id, 'name', p.name, 'category', p.category,
              'price', p.price, 'image_url', p.image_url,
              'memory_capacity', p.memory_capacity,
              'whatsapp_number', p.whatsapp_number
            ) ORDER BY p.price ASC
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) AS products
      FROM bundle_deals bd
      LEFT JOIN products p
        ON p.name ILIKE '%' || bd.match_name || '%'
        AND p.available = true
      WHERE bd.active = true AND bd.match_name <> ''
      GROUP BY bd.id
      ORDER BY bd.sort_order ASC, bd.id ASC
    `);
    return res.json({ ok: true, deals: rows });
  } catch (err) {
    console.error("[catalog/bundle-deals]", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

export default router;
