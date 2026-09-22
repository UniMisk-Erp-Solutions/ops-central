-- ============================================================================
-- OP Central — 036: client requests — what the client wants, before there is
-- an SO to want it on
-- ============================================================================
-- The client never creates a Sales Order here. They send a REQUEST — a plain
-- list of item names, typed in their own words, with a quantity and an
-- optional note each — and Purchase is the one who turns it into an SO,
-- matching each name to a real catalogue item on the way. Everything from that
-- point on (procurement, receiving, dispatch, client review) is the existing
-- machinery, untouched.
--
-- Gated behind wf('client_order_requests'); off everywhere except an
-- organization that asks for it, same discipline as client_acceptance.
--
-- Status: Draft (the client is still building it) -> Sent (Purchase's queue)
-- -> Converted (an SO now exists for it) | Cancelled.
-- ============================================================================

create table if not exists public.client_requests (
  id              text primary key,               -- client-generated, same convention as sales_orders/sourcings
  organization_id uuid not null references public.organizations(id) on delete cascade
                    default public.active_org_id(),
  request_no      text,
  customer_id     text,
  status          text not null default 'Draft',   -- Draft | Sent | Converted | Cancelled
  -- [{id, text, qty, note, product_id, matched_by}] — text is exactly what the
  -- client typed; product_id/matched_by are filled in by Purchase's mapping
  -- step, never by the client.
  items           jsonb not null default '[]'::jsonb,
  notes           text,
  created_by      text,
  sent_at         timestamptz,
  converted_so_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_client_requests_org_status
  on public.client_requests (organization_id, status);
create index if not exists idx_client_requests_customer
  on public.client_requests (organization_id, customer_id);

alter table public.client_requests enable row level security;
revoke all on public.client_requests from anon;
grant select, insert, update, delete on public.client_requests to authenticated;
drop policy if exists tenant_all_client_requests on public.client_requests;
create policy tenant_all_client_requests on public.client_requests for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- The sync-column guard (030) has a fixed table list; a table missing from it
-- is sent unfiltered rather than refused, so this is not load-bearing for
-- correctness — but leaving a new transactional table out of it is exactly the
-- kind of drift that migration exists to prevent, so it joins the list.
create or replace function public.opc_sync_columns()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(t.table_name, t.cols), '{}'::jsonb)
  from (
    select c.table_name,
           jsonb_agg(c.column_name order by c.ordinal_position) as cols
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in (
         'sales_orders', 'vendor_pos', 'grns', 'vendor_invoices', 'payments',
         'rfqs', 'sourcings', 'transfer_requests', 'notifications', 'audit',
         'outward_dispatches', 'products', 'categories', 'boms', 'customers',
         'vendors', 'users', 'config', 'item_aliases', 'client_requests')
     group by c.table_name
  ) t;
$fn$;
grant execute on function public.opc_sync_columns() to authenticated;

notify pgrst, 'reload schema';
