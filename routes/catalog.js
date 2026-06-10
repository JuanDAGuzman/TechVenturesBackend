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
      `SELECT id, name, category, memory_capacity, price, condition, image_url, available, description, tier, is_flagship
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

export default router;
