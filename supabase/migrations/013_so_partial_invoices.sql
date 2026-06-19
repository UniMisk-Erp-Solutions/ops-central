-- OP Central — 013: partial + final invoices per Sales Order. Additive only.
-- invoices: ordered list of customer invoices raised against the SO,
-- [{ id, no, date, type:'Partial'|'Final', lines:[{line_id,category_id,qty,unit_price,amount}],
--    subtotal, gst, total, created_by, role }]. As material is received the engine
-- raises partial invoices for completed bundles; the final invoice covers the
-- balance so the sum always reconciles to the billed value. Backward-compatible:
-- the legacy single invoice_no/invoice_amount fields stay as running aggregates.
alter table public.sales_orders
  add column if not exists invoices jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
