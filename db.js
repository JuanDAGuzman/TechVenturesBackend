// db.js
import pg from "pg";
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[DB] FALTA la variable de entorno DATABASE_URL");
  process.exit(1);
}

// SSL para Neon / o si fuerzas PGSSL=require
const ssl =
  connectionString.includes("neon.tech") || process.env.PGSSL === "require"
    ? { rejectUnauthorized: false }
    : false;

export const pool = new Pool({
  connectionString,
  ssl,
  max: Number(process.env.PG_POOL_MAX || 3),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 10_000), // 10s
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 5_000), // 5s
  allowExitOnIdle: true,
});

// Limita cada sesión
pool.on("connect", (client) => {
  client
    .query(
      `
      SET statement_timeout = '8s';
      SET idle_in_transaction_session_timeout = '5s';
    `
    )
    .catch(() => {});
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Cierre limpio en Railway
process.on("SIGTERM", async () => {
  try {
    await pool.end();
  } catch {}
  process.exit(0);
});
