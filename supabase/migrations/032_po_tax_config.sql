-- ============================================================================
-- OP Central — 032: per-line tax on a purchase order
-- ============================================================================
-- The PO e-Bill charged a flat 18% IGST on every line. Real purchasing is not
-- that tidy: a line may be CGST+SGST (9+9) or IGST (18), and labour or
-- professional charges carry TDS, which is WITHHELD rather than added. Purchase
-- have to be able to set that per line, or in bulk, and see the total move.
--
-- Kept in its own jsonb column rather than inside `items`, so the quantities and
-- rates that receiving, GRN matching and the profit maths read are untouched by
-- an editorial change to a tax code.
--
--   { "lines": { "<product_id>": { "key": "igst", "rate": 18 } },
--     "default": { "key": "igst", "rate": 18 } }
-- ============================================================================
alter table public.vendor_pos
  add column if not exists tax_config jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
