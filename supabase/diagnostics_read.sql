-- READ-ONLY diagnostics. No INSERT/UPDATE/DELETE/DROP. Safe to run anytime.
\echo '== public.users (actual rows) =='
select id, name, email, role, active from public.users order by created_at;

\echo '== which schema is users in =='
select table_schema, table_name from information_schema.tables where table_name = 'users';

\echo '== row counts (key tables) =='
select 'users' t, count(*) n from public.users
union all select 'config', count(*) from public.config
union all select 'customers', count(*) from public.customers
union all select 'products', count(*) from public.products
union all select 'sales_orders', count(*) from public.sales_orders
union all select 'notifications', count(*) from public.notifications
order by t;

\echo '== reload PostgREST/Studio schema cache (non-destructive) =='
notify pgrst, 'reload schema';
