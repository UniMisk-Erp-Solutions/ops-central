-- OP Central — 015: pending vendor-change request on a Vendor PO. Additive only.
-- pending_change: { vendor_id, items:[{product_id,qty,rate}], amount, old_vendor_id,
-- old_amount, requested_by, date }. Purchase proposes a CHEAPER vendor; the PO goes
-- to 'Pending MD Approval'; on MD approval the PO's vendor/items/amount swap to the
-- new vendor automatically and the flow continues. Null when there is no request.
alter table public.vendor_pos
  add column if not exists pending_change jsonb;

notify pgrst, 'reload schema';
