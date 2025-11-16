-- ============================================================================
-- Migración: Eliminar saturday_windows y mover datos a weekday_windows
-- ============================================================================
-- IMPORTANTE: Esta migración unifica el sistema de disponibilidad
-- Ahora weekday_windows funciona para CUALQUIER día de la semana (L-D)
-- ============================================================================

BEGIN;

-- Paso 1: Migrar datos existentes de saturday_windows a weekday_windows
-- Nota: Los sábados ahora necesitan especificar el tipo (TRYOUT o PICKUP)
-- Creamos UNA ventana por cada tipo para cada sábado existente

INSERT INTO weekday_windows (date, type_code, start_time, end_time, slot_minutes, created_by, created_at)
SELECT
  date,
  'TRYOUT' as type_code,
  start_time,
  end_time,
  slot_minutes,
  created_by,
  created_at
FROM saturday_windows
ON CONFLICT (date, type_code, start_time, end_time) DO NOTHING;

INSERT INTO weekday_windows (date, type_code, start_time, end_time, slot_minutes, created_by, created_at)
SELECT
  date,
  'PICKUP' as type_code,
  start_time,
  end_time,
  slot_minutes,
  created_by,
  created_at
FROM saturday_windows
ON CONFLICT (date, type_code, start_time, end_time) DO NOTHING;

-- Paso 2: Eliminar la tabla saturday_windows
DROP TABLE IF EXISTS saturday_windows CASCADE;

-- Paso 3: Renombrar weekday_windows a availability_windows (más genérico)
-- Primero renombrar índices
DROP INDEX IF EXISTS ux_weekday_windows_unique;
DROP INDEX IF EXISTS idx_weekday_windows_date;
DROP INDEX IF EXISTS idx_weekday_windows_type_date;

ALTER TABLE weekday_windows RENAME TO availability_windows;

-- Recrear índices con nuevo nombre
CREATE UNIQUE INDEX IF NOT EXISTS ux_availability_windows_unique
  ON availability_windows(date, type_code, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_availability_windows_date
  ON availability_windows(date);

CREATE INDEX IF NOT EXISTS idx_availability_windows_type_date
  ON availability_windows(type_code, date);

-- Paso 4: Añadir comentario para documentación
COMMENT ON TABLE availability_windows IS
  'Ventanas de disponibilidad para cualquier día de la semana (L-D). Cada ventana es específica por fecha y tipo de cita (TRYOUT/PICKUP).';

COMMIT;

-- ============================================================================
-- ROLLBACK (si algo sale mal):
-- ============================================================================
-- BEGIN;
-- ALTER TABLE availability_windows RENAME TO weekday_windows;
-- -- Recrear saturday_windows y restaurar backup si es necesario
-- ROLLBACK;
