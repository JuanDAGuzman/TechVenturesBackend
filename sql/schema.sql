-- ============================================================================
-- Database: techventures (estructura base)
-- Compatibilidad: PostgreSQL 14+
-- ============================================================================

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Tabla principal de citas / appointments
-- ============================================================================

DROP TABLE IF EXISTS appointments CASCADE;

CREATE TABLE appointments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Tipo de cita: TRYOUT (ensayar), PICKUP (sin ensayo), SHIPPING (envío)
  type_code           TEXT NOT NULL,

  -- Fecha de la cita (día)
  date                DATE NOT NULL,

  -- Horarios (opcionales si es envío)
  start_time          TIME NULL,
  end_time            TIME NULL,

  -- Datos de cliente
  customer_name       TEXT NOT NULL,
  customer_email      TEXT NOT NULL,
  customer_phone      TEXT NOT NULL,
  customer_id_number  TEXT NULL,          -- <- ya la necesita el backend
  notes TEXT NULL,
  shipping_cost          NUMERIC(12,2) NULL, -- valor del envío / tarifa PICAP
  shipping_trip_link     TEXT NULL,          -- link del viaje (ej. pibox)

  -- Producto libre
  product             TEXT NULL,

  -- Método de entrega: IN_PERSON | SHIPPING
  delivery_method     TEXT NOT NULL,

  -- Estado de la cita: CONFIRMED | CANCELLED | DONE | SHIPPED
  status              TEXT NOT NULL DEFAULT 'CONFIRMED',

  -- Datos de envío (solo si delivery_method = SHIPPING)
  shipping_address        TEXT NULL,
  shipping_neighborhood   TEXT NULL,
  shipping_city           TEXT NULL,
  shipping_carrier        TEXT NULL, -- p.ej. PICAP, INTERRAPIDISIMO

  -- Tracking
  tracking_number     TEXT NULL,
  tracking_file_url   TEXT NULL, -- compatibilidad (NULL en flujo actual)
  shipped_at          TIMESTAMP NULL,

  -- Recordatorios (usado por el worker)
  reminded_once_at    TIMESTAMP NULL,     -- <- NUEVA: para no volver a avisar

  -- Auditoría
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Restricciones de dominio
ALTER TABLE appointments
  ADD CONSTRAINT chk_type_code_known
  CHECK (type_code IN ('TRYOUT', 'PICKUP', 'SHIPPING'));

ALTER TABLE appointments
  ADD CONSTRAINT chk_delivery_method_known
  CHECK (delivery_method IN ('IN_PERSON', 'SHIPPING'));

ALTER TABLE appointments
  ADD CONSTRAINT chk_status_known
  CHECK (status IN ('CONFIRMED', 'CANCELLED', 'DONE', 'SHIPPED'));

-- Nota semántica:
-- si delivery_method = IN_PERSON idealmente los campos de envío deberían ser NULL;
-- si es SHIPPING, start_time y end_time pueden ser NULL.

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_appointments_updated_at ON appointments;
CREATE TRIGGER tr_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appointments_type     ON appointments(type_code);
CREATE INDEX IF NOT EXISTS idx_appointments_status   ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_delivery ON appointments(delivery_method);
CREATE INDEX IF NOT EXISTS idx_appointments_email    ON appointments(customer_email);

-- ============================================================================
-- Disponibilidad de sábados
-- ============================================================================

DROP TABLE IF EXISTS saturday_windows CASCADE;

CREATE TABLE saturday_windows (
  id          BIGSERIAL PRIMARY KEY,
  date        DATE NOT NULL,     -- sábado específico
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  created_by  TEXT NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saturday_windows_date  ON saturday_windows(date);
CREATE INDEX IF NOT EXISTS idx_saturday_windows_range ON saturday_windows(date, start_time, end_time);

-- ============================================================================
-- Datos de ejemplo (opcional)
-- ============================================================================

-- INSERT INTO appointments (type_code, date, start_time, end_time, customer_name, customer_email, customer_phone, product, delivery_method, status)
-- VALUES ('SHIPPING', CURRENT_DATE, NULL, NULL, 'Valentina', 'valentina@example.com', '3111111111', '3060TI EVGA', 'SHIPPING', 'CONFIRMED');

-- INSERT INTO saturday_windows (date, start_time, end_time, created_by)
-- VALUES (DATE_TRUNC('week', CURRENT_DATE)::date + 6, '08:00', '11:00', 'admin');  -- próximo sábado

-- Requiere la extensión uuid-ossp (ya existe en tu schema).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Weekday (manual) windows: abrir huecos L–V o cualquier día puntual
CREATE TABLE IF NOT EXISTS weekday_windows (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  date         date        NOT NULL,
  type_code    text        NOT NULL CHECK (type_code IN ('TRYOUT','PICKUP')),
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_by   text        NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Evita duplicados exactos (misma fecha+tipo+hora)
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekday_windows_unique
  ON weekday_windows(date, type_code, start_time, end_time);

-- Índices útiles (opcionales)
CREATE INDEX IF NOT EXISTS idx_weekday_windows_date
  ON weekday_windows(date);
CREATE INDEX IF NOT EXISTS idx_weekday_windows_type_date
  ON weekday_windows(type_code, date);
