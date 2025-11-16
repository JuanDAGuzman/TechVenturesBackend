-- ============================================================================
-- Agregar sistema de Blacklist para usuarios que incumplen
-- ============================================================================

BEGIN;

-- Paso 1: Agregar nuevo estado NO_SHOW (no apareció)
DO $$
BEGIN
  -- Eliminar el constraint anterior
  ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_status_known;

  -- Agregar el nuevo constraint con NO_SHOW
  ALTER TABLE appointments
    ADD CONSTRAINT chk_status_known
    CHECK (status IN ('CONFIRMED','CANCELLED','DONE','SHIPPED','NO_SHOW'));
END$$;

-- Paso 2: Crear tabla de blacklist
CREATE TABLE IF NOT EXISTS customer_blacklist (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id_number TEXT NOT NULL UNIQUE,
  customer_name     TEXT NOT NULL,
  customer_email    TEXT,
  customer_phone    TEXT,
  reason            TEXT NOT NULL, -- Motivo del bloqueo
  blocked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_by        TEXT DEFAULT 'admin',
  appointment_id    UUID REFERENCES appointments(id), -- Cita que causó el bloqueo
  notes             TEXT -- Notas adicionales
);

CREATE INDEX IF NOT EXISTS idx_blacklist_id_number
  ON customer_blacklist(customer_id_number);

COMMENT ON TABLE customer_blacklist IS
  'Lista de clientes bloqueados por incumplimiento de citas o comportamiento inapropiado';

-- Paso 3: Función helper para verificar si un cliente está en blacklist
CREATE OR REPLACE FUNCTION is_customer_blacklisted(id_number TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM customer_blacklist
    WHERE customer_id_number = id_number
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ============================================================================
-- Ejemplo de uso:
-- ============================================================================

-- Agregar un cliente a la blacklist:
-- INSERT INTO customer_blacklist (customer_id_number, customer_name, customer_email, customer_phone, reason, appointment_id, notes)
-- VALUES ('1234567890', 'Juan Perez', 'juan@example.com', '3001234567', 'NO_SHOW', 'uuid-de-cita', 'No apareció y no avisó');

-- Verificar si un cliente está en blacklist:
-- SELECT is_customer_blacklisted('1234567890');

-- Eliminar un cliente de la blacklist (desbloquear):
-- DELETE FROM customer_blacklist WHERE customer_id_number = '1234567890';
