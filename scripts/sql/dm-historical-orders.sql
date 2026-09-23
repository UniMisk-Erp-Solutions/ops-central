-- ============================================================================
-- Demo Org — 3 historical, closed Sales Orders (one each for 3 of the 5
-- dummy customers), so clientPastItems() has something to recommend from
-- ============================================================================
-- Without at least one past order, a brand-new customer's Item Request screen
-- shows no recommendations -- correct behaviour, but it means the
-- recommendation engine can never be demonstrated on a fresh tenant. These
-- three orders are already Closed (a manual, final SO_LIFECYCLE state), so
-- they sit in history and never appear as something "in flight" to test
-- against; they exist purely so a client typing a request sees "ordered
-- before" suggestions the first time they try it.
-- ============================================================================

do $$
declare
  org uuid := (select id from public.organizations where slug = 'demo');
begin
  if org is null then raise exception 'Demo Org (slug=demo) not found'; end if;

  insert into public.sales_orders (id, organization_id, so_no, customer_id, customer_po, date, expected,
    status, priority, order_type, payment_terms, notes, lines, extra)
  values
    ('so-dm-hist-01', org, 'SO/DM/2026/0001', 'c-dm-01', 'RIPL/PO/2026/0041', '2026-04-15', '2026-04-22',
     'Closed', 'Standard', 'Supply', 'Net 30', 'Core network refresh, phase 1',
     jsonb_build_array(jsonb_build_object(
       'id', 'l-dm-h1a', 'bundle_qty', 1, 'unit_price', 0, 'client_name', 'Core switching stack',
       'components', jsonb_build_array(
         jsonb_build_object('product_id', 'p-dm-01', 'qty', 2, 'sell', 45000,
           'customer_ref', jsonb_build_object('desc', '24 port core switch')),
         jsonb_build_object('product_id', 'p-dm-03', 'qty', 2, 'sell', 3200,
           'customer_ref', jsonb_build_object('desc', '10G uplink module'))
       )
     )), '{}'::jsonb),
    ('so-dm-hist-02', org, 'SO/DM/2026/0002', 'c-dm-02', 'BPN/PO/2026/0118', '2026-04-20', '2026-04-27',
     'Closed', 'Standard', 'Supply', 'Net 30', 'Office wireless rollout',
     jsonb_build_array(jsonb_build_object(
       'id', 'l-dm-h2a', 'bundle_qty', 1, 'unit_price', 0, 'client_name', 'Wireless access kit',
       'components', jsonb_build_array(
         jsonb_build_object('product_id', 'p-dm-06', 'qty', 3, 'sell', 18500,
           'customer_ref', jsonb_build_object('desc', 'wifi access point')),
         jsonb_build_object('product_id', 'p-dm-07', 'qty', 3, 'sell', 2400,
           'customer_ref', jsonb_build_object('desc', 'PoE adapter'))
       )
     )), '{}'::jsonb),
    ('so-dm-hist-03', org, 'SO/DM/2026/0003', 'c-dm-03', 'ORC/PO/2026/0209', '2026-05-02', '2026-05-09',
     'Closed', 'Standard', 'Supply', 'Net 45', 'Store backup power',
     jsonb_build_array(jsonb_build_object(
       'id', 'l-dm-h3a', 'bundle_qty', 1, 'unit_price', 0, 'client_name', 'UPS backup kit',
       'components', jsonb_build_array(
         jsonb_build_object('product_id', 'p-dm-11', 'qty', 1, 'sell', 42000,
           'customer_ref', jsonb_build_object('desc', 'backup power unit')),
         jsonb_build_object('product_id', 'p-dm-12', 'qty', 2, 'sell', 6800,
           'customer_ref', jsonb_build_object('desc', 'battery pack'))
       )
     )), '{}'::jsonb)
  on conflict (id) do nothing;
end $$;

select so_no, customer_id, status from public.sales_orders
 where organization_id = (select id from public.organizations where slug='demo')
 order by so_no;
