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
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ───────── CORS ───────── */
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

const createApptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", meta: { retry: "15m", max: 3 } },
});

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

/* ───────── Auth admin ───────── */
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
apiRouter.post("/appointments", createApptIpLimiter, createApptLimiter);
apiRouter.use(publicRoutes);
app.use("/api", apiRouter);

app.use("/api/admin", adminBruteforceLimiter, requireAdmin, adminRoutes);
app.use("/diag", diagnostics);

/* ───────── Health ───────── */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
async function applySchemaIdempotent() {
  const ddlPath = new URL("./sql/schema.sql", import.meta.url);
  const ddl = fs.readFileSync(ddlPath, "utf8");
  try {
    await query(ddl);
  } catch (e) {
    const ignorable = new Set(["42701", "42P07", "42723", "23505"]);
    if (ignorable.has(e.code)) {
      console.warn(`[schema] Ignorado (${e.code}): ${e.message}`);
    } else {
      throw e;
    }
  }
}

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
    // ▶️ Ejecuta migraciones SOLO si lo pides (ahorra compute en Neon)
    if (process.env.APPLY_SCHEMA_ON_BOOT === "1") {
      await applySchemaIdempotent();
      await ensureAppointmentsMinutesColumn();
    }

    // Verifica SMTP pero NO bloquea
    verifySMTP().catch(() => {});

    const server = http.createServer(app);
    server.requestTimeout = 30_000;
    server.headersTimeout = 35_000;
    server.keepAliveTimeout = 10_000;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("DB init error", e);
    process.exit(1);
  }
})();

// Worker de recordatorios
startRemindersWorker();
