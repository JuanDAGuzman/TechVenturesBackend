-- ============================================================================
-- Agregar campo manual de "gama" (tier) a los productos del catálogo
-- ============================================================================
-- Permite clasificar cada producto como Baja / Media / Alta / Insignia desde
-- el panel admin. Si queda en NULL, el catálogo público calcula un valor
-- automático en base al precio relativo dentro de su categoría.

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS tier TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_tier'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT chk_products_tier
      CHECK (tier IS NULL OR tier IN ('Baja', 'Media', 'Alta', 'Insignia'));
  END IF;
END$$;

COMMIT;
