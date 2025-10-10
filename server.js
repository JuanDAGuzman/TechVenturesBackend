// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { startRemindersWorker } from "./workers/reminders.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import { query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

/* ───────── Base ───────── */
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // compat

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

/* ───────── Health ───────── */
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true })); // health del contenedor

/* ───────── Arranque ───────── */
const PORT = Number(process.env.PORT || 4000);

(async () => {
  try {
    // Idempotente (tu schema usa DROP IF EXISTS)
    const ddl = fs.readFileSync(new URL("./sql/schema.sql", import.meta.url));
    await query(ddl.toString());

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`API running on http://0.0.0.0:${PORT}`);
    });
  } catch (e) {
    console.error("DB init error", e);
    process.exit(1);
  }
})();

startRemindersWorker();
