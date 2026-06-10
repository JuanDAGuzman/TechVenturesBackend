-- ============================================================================
-- Separar "Insignia" (tope de línea/marca) de la "gama" (Baja/Media/Alta)
-- ============================================================================
-- Un producto puede ser "insignia" de su marca (ej. Sapphire Nitro+, ASUS ROG
-- Strix) sin que eso implique que su gama general sea Alta. La gama y el
-- estatus de insignia ahora son campos independientes.
--
-- NOTA: si existen filas con tier = 'Insignia' (valor del esquema anterior),
-- actualízalas a 'Baja' | 'Media' | 'Alta' (según corresponda) ANTES de correr
-- este script, ya que el nuevo CHECK constraint ya no admite 'Insignia'.

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flagship BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_tier;
ALTER TABLE products
  ADD CONSTRAINT chk_products_tier
  CHECK (tier IS NULL OR tier IN ('Baja', 'Media', 'Alta'));

COMMIT;
