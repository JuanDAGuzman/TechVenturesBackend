// db.js
import pg from "pg";
const { Pool } = pg;

// Toma la URL desde las envs del servicio (Railway)
const connectionString = process.env.DATABASE_URL;

// Falla rápido si no existe -> así evitas que pg “adivine” localhost:5432
if (!connectionString) {
  console.error("[DB] FALTA la variable de entorno DATABASE_URL");
  // Salir del proceso para que el deploy te muestre el error claramente
  process.exit(1);
}

// Neon requiere SSL. Con Pooler basta con sslmode=require, pero
// agregar rejectUnauthorized:false evita problemas de CA en contenedores.
const ssl =
  connectionString.includes("neon.tech") || process.env.PGSSL === "require"
    ? { rejectUnauthorized: false }
    : false;

export const pool = new Pool({
  connectionString,
  ssl,
});

export async function query(text, params) {
  return pool.query(text, params);
}
