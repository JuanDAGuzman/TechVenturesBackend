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

/* ───────── CORS CONFIG ───────── */
// 1. Parseamos la env var, limpiamos espacios Y saltos de línea
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.replace(/\s+/g, "")) // <- elimina espacios, saltos de línea, tabs
  .filter(Boolean);

console.log("[CORS] allowedOrigins sanitized:", allowedOrigins);

function isOriginAllowed(origin) {
  if (!origin) return true; // curl / same-origin / server-to-server
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

// Middleware CORS manual primero (afecta TODAS las requests, incl OPTIONS)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const ok = isOriginAllowed(origin);

  console.log(
    "[CORS] incoming origin:",
    origin,
    "| allowed:",
    ok,
    "| method:",
    req.method,
    "| path:",
    req.path
  );

  if (ok && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, x-admin-token"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    if (!ok) {
      console.warn("[CORS] BLOCKED preflight for origin:", origin);
      return res.status(403).json({ ok: false, error: "CORS_NOT_ALLOWED" });
    }
    return res.status(200).end();
  }

  return next();
});

// cors() oficial para las requests normales (GET/POST reales)
const corsConfig = {
  origin: function (origin, cb) {
    if (isOriginAllowed(origin)) {
      cb(null, true);
    } else {
      cb(new Error("CORS_NOT_ALLOWED"), false);
    }
  },
  credentials: true,
};
app.use(cors(corsConfig));

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

// Límite de rate para crear citas
apiRouter.post("/appointments", createApptIpLimiter, createApptLimiter);

// Rutas públicas de negocio:
//   GET  /availability
//   GET  /shipping-options
//   POST /appointments   (mismo path que arriba, ya con lógica real)
apiRouter.use(publicRoutes);

// Montamos /api/*
app.use("/api", apiRouter);

// Admin panel
app.use("/api/admin", adminBruteforceLimiter, requireAdmin, adminRoutes);

// Diagnóstico interno
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
    if (process.env.APPLY_SCHEMA_ON_BOOT === "1") {
      await applySchemaIdempotent();
      await ensureAppointmentsMinutesColumn();
    }

    verifySMTP().catch(() => {});

    const server = http.createServer(app);
    server.requestTimeout = 30_000;
    server.headersTimeout = 35_000;
    server.keepAliveTimeout = 10_000;

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ API running on http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("DB init error", e);
    process.exit(1);
  }
})();

startRemindersWorker();
