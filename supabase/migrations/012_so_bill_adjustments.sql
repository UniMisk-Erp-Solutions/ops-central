-- OP Central — 012: automatic client-bill reductions. Additive only.
-- bill_adjustments: items removed at GRN (not supplied to the customer), each
-- [{ product_id, qty, amount, reason, grn_id, date }]. The customer invoice /
-- e-Way Bill subtracts the total automatically, so the client is never billed
-- for what they didn't receive. (`amount` = product sell price × removed qty.)
alter table public.sales_orders
  add column if not exists bill_adjustments jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
