-- ============================================================================
-- Database: techventures (estructura base, idempotente y NO destructiva)
-- Compatibilidad: PostgreSQL 14+
-- ============================================================================

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Tabla principal de citas / appointments
-- ============================================================================

-- 1) Crea la tabla si no existe (solo columnas mínimas para poder ALTER después)
CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type_code           TEXT NOT NULL,
  date                DATE NOT NULL,
  start_time          TIME NULL,
  end_time            TIME NULL,
  customer_name       TEXT NOT NULL,
  customer_email      TEXT NOT NULL,
  customer_phone      TEXT NOT NULL,
  delivery_method     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'CONFIRMED',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2) Añadir/asegurar columnas que usamos (sin borrar nada)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS customer_id_number     TEXT NULL,
  ADD COLUMN IF NOT EXISTS product                TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_address       TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_neighborhood  TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_city          TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_carrier       TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_number        TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_file_url      TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipped_at             TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reminded_once_at       TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS shipping_cost          NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS shipping_trip_link     TEXT NULL;

-- 3) Constraints (añadir solo si no existen)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_type_code_known'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_type_code_known
      CHECK (type_code IN ('TRYOUT','PICKUP','SHIPPING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_method_known'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_delivery_method_known
      CHECK (delivery_method IN ('IN_PERSON','SHIPPING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_status_known'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_status_known
      CHECK (status IN ('CONFIRMED','CANCELLED','DONE','SHIPPED'));
  END IF;
END$$;

-- 4) Trigger para updated_at (seguro)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tr_appointments_updated_at'
  ) THEN
    CREATE TRIGGER tr_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();
  END IF;
END$$;

-- 5) Índices útiles
CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_type     ON appointments(type_code);
CREATE INDEX IF NOT EXISTS idx_appointments_status   ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_delivery ON appointments(delivery_method);
CREATE INDEX IF NOT EXISTS idx_appointments_email    ON appointments(customer_email);

-- Para consultas por fecha+hora (panel, recordatorios)
CREATE INDEX IF NOT EXISTS idx_appt_date_time
  ON appointments (date, start_time);

-- Escaneo genérico de recordatorios (legacy / opcional)
CREATE INDEX IF NOT EXISTS idx_appt_reminder_scan
  ON appointments (status, type_code, reminded_once_at);

-- Nuevos recordatorios específicos: 1h y 30m (aceleran el worker)
CREATE INDEX IF NOT EXISTS idx_appt_rem_1h_scan
  ON appointments (status, type_code, date, reminded_1h_at, start_time);

CREATE INDEX IF NOT EXISTS idx_appt_rem_30m_scan
  ON appointments (status, type_code, date, reminded_30m_at, start_time);

-- ============================================================================
-- Disponibilidad de sábados
-- ============================================================================

CREATE TABLE IF NOT EXISTS saturday_windows (
  id          BIGSERIAL PRIMARY KEY,
  date        DATE NOT NULL,     -- sábado específico
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  created_by  TEXT NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- evita duplicados exactos en una misma fecha
CREATE UNIQUE INDEX IF NOT EXISTS ux_saturday_windows_unique
  ON saturday_windows(date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_saturday_windows_date
  ON saturday_windows(date);

CREATE INDEX IF NOT EXISTS idx_saturday_windows_range
  ON saturday_windows(date, start_time, end_time);

-- Slot size de sábados
ALTER TABLE saturday_windows
  ADD COLUMN IF NOT EXISTS slot_minutes INTEGER NOT NULL DEFAULT 15;

-- ============================================================================
-- Disponibilidad manual entre semana (weekday_windows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekday_windows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date         DATE        NOT NULL,
  type_code    TEXT        NOT NULL CHECK (type_code IN ('TRYOUT','PICKUP')),
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  created_by   TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_weekday_windows_unique
  ON weekday_windows(date, type_code, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_weekday_windows_date
  ON weekday_windows(date);

CREATE INDEX IF NOT EXISTS idx_weekday_windows_type_date
  ON weekday_windows(type_code, date);

-- Slot size de L–V
ALTER TABLE weekday_windows
  ADD COLUMN IF NOT EXISTS slot_minutes INTEGER NOT NULL DEFAULT 15;

-- ============================================================================
-- Ventanas manuales de disponibilidad (L–V) para panel nuevo
-- ============================================================================

CREATE TABLE IF NOT EXISTS appt_windows (
  id           SERIAL PRIMARY KEY,
  date         DATE NOT NULL,
  type_code    TEXT NOT NULL CHECK (type_code IN ('TRYOUT','PICKUP')),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  slot_minutes INT  NOT NULL CHECK (slot_minutes IN (15,20,30)),
  created_at   TIMESTAMP DEFAULT now(),
  CONSTRAINT appt_windows_time_valid CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appt_windows_date_type
  ON appt_windows(date, type_code);

-- ============================================================================
-- Campos auxiliares / migraciones opcionales
-- ============================================================================

-- Duración (minutos) por cita
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS slot_minutes INTEGER;

-- Backfill para registros existentes con hora
UPDATE appointments
SET slot_minutes = GREATEST(
  0,
  FLOOR(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)
)::INT
WHERE slot_minutes IS NULL
  AND start_time IS NOT NULL
  AND end_time   IS NOT NULL;

-- Nuevos campos de recordatorio (para 1h y 30m)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminded_1h_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminded_30m_at TIMESTAMPTZ;
