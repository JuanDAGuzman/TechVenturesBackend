-- ============================================================================
-- Agregar número de WhatsApp alternativo por producto
-- ============================================================================
-- Permite que ciertos productos (ej. manejados por otra persona) dirijan el
-- botón "Contactar por WhatsApp" a un número distinto al de la tienda. Si
-- queda en NULL, se usa el número general (store_settings.whatsapp_number).

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

COMMIT;
