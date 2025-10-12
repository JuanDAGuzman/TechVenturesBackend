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
  ADD COLUMN IF NOT EXISTS customer_id_number  TEXT NULL,
  ADD COLUMN IF NOT EXISTS product             TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes               TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_address        TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_neighborhood   TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_city           TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipping_carrier        TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_number     TEXT NULL,
  ADD COLUMN IF NOT EXISTS tracking_file_url   TEXT NULL,
  ADD COLUMN IF NOT EXISTS shipped_at          TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reminded_once_at    TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS shipping_cost       NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS shipping_trip_link  TEXT NULL;

-- 3) Constraints (añadir solo si no existen)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_type_code_known'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_type_code_known
      CHECK (type_code IN ('TRYOUT','PICKUP','SHIPPING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_delivery_method_known'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT chk_delivery_method_known
      CHECK (delivery_method IN ('IN_PERSON','SHIPPING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_status_known'
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

CREATE INDEX IF NOT EXISTS idx_saturday_windows_date
  ON saturday_windows(date);
CREATE INDEX IF NOT EXISTS idx_saturday_windows_range
  ON saturday_windows(date, start_time, end_time);

-- ============================================================================
-- Disponibilidad manual entre semana (weekday_windows)
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekday_windows (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date         date        NOT NULL,
  type_code    text        NOT NULL CHECK (type_code IN ('TRYOUT','PICKUP')),
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_by   text        NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_weekday_windows_unique
  ON weekday_windows(date, type_code, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_weekday_windows_date
  ON weekday_windows(date);
CREATE INDEX IF NOT EXISTS idx_weekday_windows_type_date
  ON weekday_windows(type_code, date);

-- Sábados
ALTER TABLE saturday_windows
ADD COLUMN IF NOT EXISTS slot_minutes integer NOT NULL DEFAULT 15;

-- L–V (manual)
ALTER TABLE weekday_windows
ADD COLUMN IF NOT EXISTS slot_minutes integer NOT NULL DEFAULT 15;


ALTER TABLE saturday_windows ADD COLUMN IF NOT EXISTS slot_minutes INT DEFAULT 15;

-- evita duplicados exactos en una misma fecha
CREATE UNIQUE INDEX IF NOT EXISTS ux_saturday_windows_unique
ON saturday_windows(date, start_time, end_time);


-- migration opcional
ALTER TABLE appointments ADD COLUMN slot_minutes integer;

-- backfill para registros existentes con hora
UPDATE appointments
SET slot_minutes = EXTRACT(EPOCH FROM (end_time - start_time))/60
WHERE start_time IS NOT NULL AND end_time IS NOT NULL;

-- Ventanas manuales de disponibilidad
CREATE TABLE IF NOT EXISTS appt_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  type_code TEXT NOT NULL CHECK (type_code IN ('TRYOUT','PICKUP')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes INT NOT NULL CHECK (slot_minutes IN (15,20,30)),
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT appt_windows_time_valid CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appt_windows_date_type
  ON appt_windows(date, type_code);
