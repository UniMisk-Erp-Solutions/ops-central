-- ============================================================================
-- Demo Org (dm) — dummy test data: 5 vendors, 5 customers, 5 kit "items" each
-- with their own line items (a category + its BOM)
-- ============================================================================
-- For testing the client-requests flow end to end (recommendations, matching,
-- vendor allocation) against something other than an empty catalogue. Scoped
-- to Demo Org ONLY (organization_id below) via ON CONFLICT DO NOTHING, so a
-- re-run never overwrites anything already edited by hand.
--
-- "Item" here = a category (a kit/bundle a client can order as one thing);
-- its "line items" = the BOM: the real, individually-priced products that
-- make it up. This is the same category+BOM structure every Sales Order
-- bundle line already uses (screens-sourcing.jsx reads state.boms[categoryId]
-- to build a line's components) — not a new concept, just data for it.
--
-- Run: SSH_PASSWORD='...' python scripts/ssh-apply-sql.py scripts/sql/dm-dummy-test-data.sql
-- ============================================================================

do $$
declare
  org uuid := (select id from public.organizations where slug = 'demo');
begin
  if org is null then
    raise exception 'Demo Org (slug=demo) not found -- refusing to guess an organization_id';
  end if;

  -- ---- Vendors --------------------------------------------------------------
  insert into public.vendors (id, organization_id, code, name, gstin, city, contact, phone, terms, rating, type, extra)
  values
    ('v-dm-01', org, 'VEN-01', 'Cisco Systems India Pvt Ltd', '29AACCC1234M1ZP', 'Bengaluru', 'Rohan Mehta', '9876500011', 'Net 30', 4.5, 'OEM', '{}'::jsonb),
    ('v-dm-02', org, 'VEN-02', 'Juniper Networks India', '27AACCJ5678N1ZQ', 'Pune', 'Ananya Rao', '9876500022', 'Net 45', 4.2, 'OEM', '{}'::jsonb),
    ('v-dm-03', org, 'VEN-03', 'Redington Distribution Ltd', '27AABCR4321P1ZR', 'Mumbai', 'Karan Shah', '9876500033', 'Net 30', 4.0, 'Distributor', '{}'::jsonb),
    ('v-dm-04', org, 'VEN-04', 'Ingram Micro India Pvt Ltd', '33AABCI8765Q1ZS', 'Chennai', 'Divya Nair', '9876500044', 'Net 15', 3.8, 'Distributor', '{}'::jsonb),
    ('v-dm-05', org, 'VEN-05', 'Rashi Peripherals Ltd', '07AABCR2109R1ZT', 'New Delhi', 'Vikram Singh', '9876500055', 'Net 30', 4.1, 'Distributor', '{}'::jsonb)
  on conflict (id) do nothing;

  -- ---- Customers (clients) ---------------------------------------------------
  insert into public.customers (id, organization_id, code, name, gstin, state, address, contact, phone, terms, credit_limit, tier, extra)
  values
    ('c-dm-01', org, 'CUST-01', 'Relience Infotech Pvt Ltd', '27AAACR1111M1ZA', 'Maharashtra', 'Plot 14, MIDC, Andheri East, Mumbai', 'Neha Kulkarni', '9988700011', 'Net 30', 500000, 'Gold', '{}'::jsonb),
    ('c-dm-02', org, 'CUST-02', 'Bluepeak Networks', '29AAACB2222N1ZB', 'Karnataka', '2nd Floor, Whitefield Main Rd, Bengaluru', 'Arjun Nambiar', '9988700022', 'Net 30', 300000, 'Silver', '{}'::jsonb),
    ('c-dm-03', org, 'CUST-03', 'Orion Retail Chain', '07AAACO3333P1ZC', 'Delhi', 'Unit 8, Okhla Industrial Area, New Delhi', 'Simran Kaur', '9988700033', 'Net 45', 750000, 'Gold', '{}'::jsonb),
    ('c-dm-04', org, 'CUST-04', 'Nimbus Hospitality Group', '36AAACN4444Q1ZD', 'Telangana', 'Road No. 2, Banjara Hills, Hyderabad', 'Farhan Ali', '9988700044', 'Net 30', 200000, 'Silver', '{}'::jsonb),
    ('c-dm-05', org, 'CUST-05', 'Anchor Manufacturing Co', '24AAACA5555R1ZE', 'Gujarat', 'GIDC Estate, Vatva, Ahmedabad', 'Priya Desai', '9988700055', 'Net 15', 150000, 'Bronze', '{}'::jsonb)
  on conflict (id) do nothing;

  -- ---- Products (the pool the 5 kits are built from) --------------------------
  insert into public.products (id, organization_id, code, name, hsn, uom, gst, sell, buy)
  values
    ('p-dm-01', org, 'SW-24P',     '24-Port Gigabit Switch',        '8517', 'Nos.', 18, 45000, 32000),
    ('p-dm-02', org, 'PSU-750',    'Redundant PSU 750W',            '8504', 'Nos.', 18,  8500,  6000),
    ('p-dm-03', org, 'SFP-10G',    '10G SFP+ Module',               '8517', 'Nos.', 18,  3200,  2100),
    ('p-dm-04', org, 'RTR-EDGE',   'Enterprise Edge Router',        '8517', 'Nos.', 18, 65000, 48000),
    ('p-dm-05', org, 'CBL-C6-2M',  'Cat6 Patch Cable 2M',           '8544', 'Nos.', 18,   250,   140),
    ('p-dm-06', org, 'AP-AX',      'Wireless Access Point AX',      '8517', 'Nos.', 18, 18500, 13000),
    ('p-dm-07', org, 'POE-INJ',    'PoE Injector 802.3at',          '8504', 'Nos.', 18,  2400,  1600),
    ('p-dm-08', org, 'BRK-AP',     'AP Mounting Bracket',           '7326', 'Nos.', 18,   450,   250),
    ('p-dm-09', org, 'FW-UTM',     'Firewall Appliance (UTM)',      '8517', 'Nos.', 18, 95000, 72000),
    ('p-dm-10', org, 'RMK-1U',     '1U Rack Mount Kit',             '7326', 'Nos.', 18,  1200,   700),
    ('p-dm-11', org, 'UPS-3KVA',   'Online UPS 3KVA',               '8504', 'Nos.', 18, 42000, 31000),
    ('p-dm-12', org, 'BAT-12V',    'Sealed Battery Pack 12V',       '8507', 'Nos.', 18,  6800,  4800),
    ('p-dm-13', org, 'CBL-ORG',    'Cable Management Organizer',    '7326', 'Nos.', 18,   900,   550)
  on conflict (organization_id, id) do nothing;

  -- ---- Categories ("items") ---------------------------------------------------
  insert into public.categories (id, organization_id, name, hsn, gst, bundle_desc)
  values
    ('cat-dm-01', org, 'Core Switching Stack',   '8517', 18, '24-port switch with redundant PSU and 10G uplinks'),
    ('cat-dm-02', org, 'Edge Router Kit',        '8517', 18, 'Enterprise edge router with uplink module and patch leads'),
    ('cat-dm-03', org, 'Wireless Access Kit',    '8517', 18, 'AX access point with PoE injector and mounting bracket'),
    ('cat-dm-04', org, 'Firewall Appliance Kit', '8517', 18, 'UTM firewall appliance, rack-mounted'),
    ('cat-dm-05', org, 'UPS Backup Kit',         '8504', 18, 'Online UPS with battery pack and cable management')
  on conflict (organization_id, id) do nothing;

  -- ---- BOMs ("line items" of each item) ----------------------------------------
  insert into public.boms (organization_id, category_id, components)
  values
    (org, 'cat-dm-01', jsonb_build_array(
       jsonb_build_object('product_id','p-dm-01','qty',2),
       jsonb_build_object('product_id','p-dm-02','qty',1),
       jsonb_build_object('product_id','p-dm-03','qty',2))),
    (org, 'cat-dm-02', jsonb_build_array(
       jsonb_build_object('product_id','p-dm-04','qty',1),
       jsonb_build_object('product_id','p-dm-03','qty',1),
       jsonb_build_object('product_id','p-dm-05','qty',4))),
    (org, 'cat-dm-03', jsonb_build_array(
       jsonb_build_object('product_id','p-dm-06','qty',1),
       jsonb_build_object('product_id','p-dm-07','qty',1),
       jsonb_build_object('product_id','p-dm-08','qty',1))),
    (org, 'cat-dm-04', jsonb_build_array(
       jsonb_build_object('product_id','p-dm-09','qty',1),
       jsonb_build_object('product_id','p-dm-10','qty',1),
       jsonb_build_object('product_id','p-dm-05','qty',1))),
    (org, 'cat-dm-05', jsonb_build_array(
       jsonb_build_object('product_id','p-dm-11','qty',1),
       jsonb_build_object('product_id','p-dm-12','qty',2),
       jsonb_build_object('product_id','p-dm-13','qty',1)))
  on conflict (organization_id, category_id) do nothing;
end $$;

-- Verify
select 'vendors' t, count(*) from public.vendors where organization_id = (select id from public.organizations where slug='demo')
union all select 'customers', count(*) from public.customers where organization_id = (select id from public.organizations where slug='demo')
union all select 'products', count(*) from public.products where organization_id = (select id from public.organizations where slug='demo')
union all select 'categories', count(*) from public.categories where organization_id = (select id from public.organizations where slug='demo')
union all select 'boms', count(*) from public.boms where organization_id = (select id from public.organizations where slug='demo');
