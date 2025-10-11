// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import http from "http";

import { startRemindersWorker } from "./workers/reminders.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import diagnostics from "./routes/diagnostics.js";
import { verifySMTP } from "./services/mailer.js";
import { query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

/* ───────── Base ───────── */
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // compat

/* ───────── CORS (allow-list con fallback) ───────── */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // curl / same-origin
      const ok = allowedOrigins.length === 0 || allowedOrigins.includes(origin);
      cb(ok ? null : new Error("CORS_NOT_ALLOWED"), ok);
    },
  })
);

/* ───────── Rate limits ───────── */
// 1) 2 req / 5min por IP para crear citas
const createApptIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "RATE_LIMIT",
    meta: { scope: "IP", retry: "5m", max: 2 },
  },
  keyGenerator: ipKeyGenerator,
});

// 2) 3 req / 15min adicional
const createApptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", meta: { retry: "15m", max: 3 } },
});

// 3) Admin: cuenta solo fallos (401)
const adminBruteforceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "RATE_LIMIT",
    meta: { scope: "ADMIN", retry: "10m", max: 100 },
  },
  skipSuccessfulRequests: true,
});

/* ───────── Auth admin (x-admin-token) ───────── */
function requireAdmin(req, res, next) {
  const token = (req.headers["x-admin-token"] || "").trim();
  const expected = (process.env.ADMIN_TOKEN || "").trim();
  if (!token || token !== expected) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  next();
}

/* ───────── Rutas ───────── */
const apiRouter = express.Router();

// aplicar limiters SOLO al POST /api/appointments
apiRouter.post("/appointments", createApptIpLimiter, createApptLimiter);

// públicas
apiRouter.use(publicRoutes);
app.use("/api", apiRouter);

// admin (todas requieren header x-admin-token)
app.use("/api/admin", adminBruteforceLimiter, requireAdmin, adminRoutes);

// diagnósticos (SMTP, etc.)
app.use("/diag", diagnostics);

/* ───────── Health ───────── */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true })); // health del contenedor

/* ───────── 404 & Error handler ───────── */
app.use((req, res) => res.status(404).json({ ok: false, error: "NOT_FOUND" }));

app.use((err, _req, res, _next) => {
  const msg = err?.message || "INTERNAL_ERROR";
  if (msg !== "CORS_NOT_ALLOWED") console.error("[ERR]", msg);
  res
    .status(msg === "CORS_NOT_ALLOWED" ? 403 : 500)
    .json({ ok: false, error: msg });
});

/* ───────── Helpers de init de DB (idempotentes) ───────── */

// Aplica el schema pero ignora errores “seguros” de duplicados (columna/tabla/función ya existe)
async function applySchemaIdempotent() {
  const ddlPath = new URL("./sql/schema.sql", import.meta.url);
  const ddl = fs.readFileSync(ddlPath, "utf8");
  try {
    await query(ddl);
  } catch (e) {
    // Códigos típicos de duplicado en PG:
    // 42701 duplicate_column, 42P07 duplicate_table, 42723 duplicate_function, 23505 unique_violation
    const ignorable = new Set(["42701", "42P07", "42723", "23505"]);
    if (ignorable.has(e.code)) {
      console.warn(`[schema] Ignorado (${e.code}): ${e.message}`);
    } else {
      throw e;
    }
  }
}

// (Opcional) Garantiza columna slot_minutes y hace backfill sin romper si ya existe
async function ensureAppointmentsMinutesColumn() {
  await query(`
    ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS slot_minutes integer
  `);

  await query(`
    UPDATE appointments
    SET slot_minutes = GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 60)
    )::int
    WHERE slot_minutes IS NULL
      AND start_time IS NOT NULL
      AND end_time   IS NOT NULL
  `);
}

/* ───────── Arranque ───────── */
const PORT = Number(process.env.PORT || 4000);

(async () => {
  try {
    // Aplica schema de forma idempotente
    await applySchemaIdempotent();

    // (Opcional) Asegura columna/minutos calculados si la necesitas para analytics
    // Puedes comentar esta línea si no usas slot_minutes en reportes.
    await ensureAppointmentsMinutesColumn();

    // Verifica SMTP pero NO impide levantar el server
    verifySMTP().catch(() => {});

    // Server HTTP con timeouts claros
    const server = http.createServer(app);
    server.requestTimeout = 30_000; // 30s máx por request
    server.headersTimeout = 35_000; // > requestTimeout
    server.keepAliveTimeout = 10_000;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("DB init error", e);
    process.exit(1);
  }
})();

startRemindersWorker();
