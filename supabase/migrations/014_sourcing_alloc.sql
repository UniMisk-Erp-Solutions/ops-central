-- OP Central — 014: multi-vendor quantity allocation at the sourcing stage.
-- Additive only. alloc: { product_id: [{ vendor_id, qty, rate }] } — Purchase
-- splits each item's quantity across multiple quoted vendors right in the inquiry.
-- The margin engine and Vendor-PO generation read this, so the split flows
-- automatically into the SO without re-entering anything. Falls back to the
-- single-vendor `picks` when alloc is empty.
alter table public.sourcings
  add column if not exists alloc jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
