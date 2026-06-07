-- OP Central — 007: Pre-SO Sourcing stage (inquiry → vendor comparison → margin
-- match → convert to SO). Additive only; does not touch existing tables.
--
-- A "sourcing" is a pre-sales costing exercise: Sales floats an inquiry with the
-- desired bundles/components; Purchase picks the best vendor per item (item-based
-- suggestion with a benefit %) and the system computes the customer-sell ⟷
-- vendor-buy margin; Sales then converts it into a real Sales Order (or not).
--
-- Nested data (lines, per-item vendor picks, captured quote prices, margin
-- summary) is jsonb so the row maps 1:1 to the frontend object — same convention
-- as sales_orders / rfqs.

create table if not exists public.sourcings (
  id              text primary key,
  src_no          text,
  customer_id     text,
  ref             text,                                   -- inquiry / customer reference (optional)
  date            date,
  status          text,                                   -- Sent to Purchase | Sourced | Sent to Sales | Converted
  notes           text,
  created_by      text,
  lines           jsonb not null default '[]'::jsonb,     -- [{id, category_id, bundle_qty, unit_price, components:[...]}]
  picks           jsonb not null default '{}'::jsonb,     -- { product_id: vendor_id }
  prices          jsonb not null default '{}'::jsonb,     -- { product_id: { vendor_id: unit_price } }
  margin          jsonb not null default '{}'::jsonb,     -- { sell, buy, marginAmt, marginPct, perItem:[...] }
  converted_so_id text,
  created_at      timestamptz not null default now()
);

-- RLS: same model as the other transactional tables (any authenticated member
-- may read/write; see migration 005's is_member()).
alter table public.sourcings enable row level security;
revoke all on public.sourcings from anon;
grant select, insert, update, delete on public.sourcings to authenticated;
drop policy if exists member_all_sourcings on public.sourcings;
create policy member_all_sourcings on public.sourcings
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- Expose over PostgREST immediately.
notify pgrst, 'reload schema';
