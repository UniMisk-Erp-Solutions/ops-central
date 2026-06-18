-- OP Central — 011: pool allocations on a Sales Order. Additive only.
-- pool_alloc: components fulfilled from the Master Surplus Pool at SO creation,
-- [{ product_id, qty, name }]. Procurement subtracts these so the same stock is
-- never re-purchased; the pool rows are decremented when the allocation is made.
alter table public.sales_orders
  add column if not exists pool_alloc jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
