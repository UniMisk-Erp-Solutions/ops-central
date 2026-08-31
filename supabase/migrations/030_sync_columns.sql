-- ============================================================================
-- OP Central — 030: let the client see which columns a table actually has
-- ============================================================================
-- The store upserts its in-memory row objects straight to Supabase, assuming
-- they map 1:1 to columns. Any screen that adds a field the table does not have
-- makes PostgREST reject the WHOLE row, and the failure was only written to the
-- browser console — so the record lived in localStorage, looked saved, and was
-- invisible in every other browser.
--
-- That is exactly what happened to imported sales orders: the importer set
-- imported_from, po_ref and created_by, none of which are columns of
-- sales_orders. Fifty products and a customer saved; the order itself did not.
--
-- Rather than hard-code a column list in the frontend — which silently rots the
-- next time a migration adds a column — the client asks the database what the
-- columns are and filters each row to those. New columns work automatically;
-- stray UI-only fields can never poison a write again.
-- ============================================================================
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
         'vendors', 'users', 'config', 'item_aliases')
     group by c.table_name
  ) t;
$fn$;
grant execute on function public.opc_sync_columns() to authenticated;

notify pgrst, 'reload schema';
