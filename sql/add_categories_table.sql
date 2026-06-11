-- ============================================================================
-- Categorías / secciones del catálogo configurables desde el admin
-- ============================================================================
-- Antes las categorías (NVIDIA, AMD, Intel, Componentes, Celulares) estaban
-- fijas en el código. Ahora viven en esta tabla para poder agregar nuevas
-- secciones (ej. "Periféricos", "Monitores") desde admin/catalogo, cada una
-- con su propio color de marca para el catálogo público.

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (name, color, sort_order) VALUES
  ('NVIDIA',      '#76B900', 0),
  ('AMD',         '#ED1C24', 1),
  ('Intel',       '#0068B5', 2),
  ('Componentes', '#64748b', 3),
  ('Celulares',   '#8B5CF6', 4)
ON CONFLICT (name) DO NOTHING;

COMMIT;
