-- OP Central — full domain schema (run after 001_op_central.sql)
-- Target: supabase-db-hws00sks44g8k04k8wccooco (API :54331)
--
-- Design notes:
--  * Text primary keys mirror the existing seed ids (e.g. 'so-001', 'u-ravi')
--    so frontend references and links keep working 1:1.
--  * Nested structures (SO lines/components, PO items, GRN items, RFQ quotes)
--    are stored as jsonb so the shape matches the current frontend exactly and
--    the store stays simple.
--  * RLS is enabled with PERMISSIVE anon policies (select/insert/update/delete).
--    DEMO-GRADE ONLY: this lets the public anon key read AND write every row.
--    Fine for an internal demo; tighten before any real/production use.
--  * Idempotent: safe to run multiple times (IF NOT EXISTS / ON CONFLICT).
--  * Only seeds MASTER data (config, users, categories, products, boms,
--    customers, vendors). Transactional tables are left empty — real records
--    are created through the app's role workflow.

create extension if not exists "pgcrypto";

-- ============================================================================
-- Tables
-- ============================================================================

-- Singleton customization/config blob (org profile, modules, approval gates,
-- workflow stages, permissions matrix, etc.). One row, id = 'singleton'.
create table if not exists public.config (
  id         text primary key default 'singleton',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id          text primary key,
  email       text unique,
  name        text not null,
  role        text not null,
  initials    text,
  permissions jsonb,                       -- optional per-user overrides
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.categories (
  id          text primary key,
  name        text not null,
  hsn         text,
  gst         numeric,
  bundle_desc text
);

create table if not exists public.products (
  id   text primary key,
  code text,
  name text not null,
  hsn  text,
  uom  text,
  gst  numeric,
  sell numeric,
  buy  numeric
);

-- One row per category; components is [{product_id, qty}, ...]
create table if not exists public.boms (
  category_id text primary key references public.categories(id) on delete cascade,
  components  jsonb not null default '[]'::jsonb
);

create table if not exists public.customers (
  id           text primary key,
  code         text,
  name         text not null,
  gstin        text,
  state        text,
  address      text,
  contact      text,
  phone        text,
  terms        text,
  credit_limit numeric,
  tier         text,
  extra        jsonb not null default '{}'::jsonb   -- custom fields
);

create table if not exists public.vendors (
  id      text primary key,
  code    text,
  name    text not null,
  gstin   text,
  city    text,
  contact text,
  phone   text,
  terms   text,
  rating  numeric,
  type    text,
  extra   jsonb not null default '{}'::jsonb        -- custom fields
);

create table if not exists public.sales_orders (
  id             text primary key,
  so_no          text,
  customer_id    text,
  customer_po    text,
  date           date,
  expected       date,
  status         text,
  priority       text,
  order_type     text,
  pm             text,
  ship_to        text,
  payment_terms  text,
  notes          text,
  hold_reason    text,
  invoice_no     text,
  invoice_date   date,
  invoice_amount numeric,
  days_overdue   integer,
  lines          jsonb not null default '[]'::jsonb,
  extra          jsonb not null default '{}'::jsonb,  -- custom fields
  created_at     timestamptz not null default now()
);

create table if not exists public.vendor_pos (
  id        text primary key,
  po_no     text,
  so_id     text,
  vendor_id text,
  date      date,
  expected  date,
  status    text,
  amount    numeric,
  items     jsonb not null default '[]'::jsonb
);

create table if not exists public.grns (
  id          text primary key,
  grn_no      text,
  po_id       text,
  date        date,
  lr          text,
  received_by text,
  status      text,
  items       jsonb not null default '[]'::jsonb
);

create table if not exists public.vendor_invoices (
  id                text primary key,
  vendor_invoice_no text,
  po_id             text,
  grn_id            text,
  vendor_id         text,
  date              date,
  amount            numeric,
  status            text,
  tolerance         text
);

create table if not exists public.payments (
  id         text primary key,
  so_id      text,
  invoice_no text,
  date       date,
  amount     numeric,
  mode       text,
  ref        text
);

-- Surplus pool items have no natural id in the frontend → synthetic id.
create table if not exists public.pool (
  id            bigint generated always as identity primary key,
  product_id    text,
  qty           numeric,
  source_so     text,
  received_date date
);

create table if not exists public.rfqs (
  id              text primary key,
  rfq_no          text,
  so_id           text,
  items_label     text,
  floated_date    date,
  closes_date     date,
  status          text,
  vendors         jsonb not null default '[]'::jsonb,
  quotes          jsonb not null default '[]'::jsonb,
  selected_vendor text
);

create table if not exists public.transfer_requests (
  id             text primary key,
  from_so        text,
  to_so          text,
  items          jsonb not null default '[]'::jsonb,
  status         text,
  requested_by   text,
  requested_date date,
  reason         text
);

create table if not exists public.notifications (
  id    text primary key,
  kind  text,
  text  text,
  date  date,
  read  boolean default false,
  role  text
);

create table if not exists public.audit (
  id        text primary key,
  action    text,
  entity    text,
  entity_id text,
  user_id   text,
  detail    jsonb not null default '{}'::jsonb,
  ts        timestamptz not null default now()
);

-- ============================================================================
-- RLS — permissive anon (DEMO ONLY)
-- ============================================================================

do $$
declare
  t text;
  tbls text[] := array[
    'config','users','categories','products','boms','customers','vendors',
    'sales_orders','vendor_pos','grns','vendor_invoices','payments','pool',
    'rfqs','transfer_requests','notifications','audit'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', 'anon_all_'||t, t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      'anon_all_'||t, t
    );
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated;', t);
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ============================================================================
-- Seed: MASTER DATA ONLY (mirrors frontend/src/seed.js v5)
-- ============================================================================

-- Config singleton (org profile + customization scaffold)
insert into public.config (id, data) values ('singleton', $json$
{
  "org": {
    "name": "Brightline Systems Pvt Ltd",
    "short": "Brightline",
    "gstin": "27AABCB9999N1Z2",
    "state": "Maharashtra",
    "address": "Office 402, Lotus Tech Park, Powai, Mumbai 400076",
    "industry": "Trading",
    "fiscal_year": "2025-26",
    "brand_color": "#3563a4",
    "logo_letter": "B"
  },
  "industry_template": "Trading",
  "teams": ["Sales","Pre-sales","Project Management","Purchase","Stores","Billing","Collections","Managing Director","Org Admin"],
  "enabled_modules": {
    "presales": true, "sales_desk": true, "stores": true,
    "cross_so_transfer": true, "surplus_pool": true, "partial_invoicing": true,
    "e_invoice": true, "e_way_bill": true, "whatsapp": true, "sms": true
  },
  "approval_gates": [
    { "id": "g1", "entity": "Vendor PO", "tier": "< 1,00,000", "approvers": ["Purchase"] },
    { "id": "g2", "entity": "Vendor PO", "tier": "1L - 5L", "approvers": ["Purchase","Managing Director"] },
    { "id": "g3", "entity": "Vendor PO", "tier": "> 5,00,000", "approvers": ["Purchase","Managing Director","Finance"] },
    { "id": "g4", "entity": "Sales Order", "tier": "Customer overdue > 1L", "approvers": ["Project Manager","Managing Director"] },
    { "id": "g5", "entity": "Inventory Write-off", "tier": "> 25,000", "approvers": ["Stores","Managing Director"] }
  ],
  "lpp_threshold": 10,
  "three_way_value_tolerance": 2,
  "three_way_qty_tolerance": 1,
  "pool_first": true,
  "workflow_stages": [
    "Draft","Pending Approval","Approved","Procurement Started","Material Received",
    "Ready to Dispatch","Partially Delivered","Fully Delivered","Invoiced",
    "Payment Pending","Fully Paid","Closed"
  ],
  "roles": ["Org Admin","Sales","Pre-sales","Project Manager","Purchase","Stores","Billing","Managing Director","Collections"],
  "permissions": {
    "Org Admin": { "nav": ["dashboard","inbox","sales-orders","customers","godown","pool","transfers","rfq","vendor-pos","grn","three-way","vendors","invoices","collections","products","settings","audit","onboarding"], "primary": { "route": "dashboard", "label": "Dashboard" }, "can": { "all": true } },
    "Sales": { "nav": ["dashboard","inbox","sales-orders","customers","products"], "primary": { "route": "sales-orders/new", "label": "New Sales Order", "icon": "plus" }, "can": { "createSO": true, "editOwnDraft": true, "viewProducts": true, "viewCustomers": true } },
    "Pre-sales": { "nav": ["dashboard","inbox","sales-orders","customers","products"], "primary": { "route": "sales-orders", "label": "Quotations" }, "can": { "viewProducts": true, "viewCustomers": true } },
    "Project Manager": { "nav": ["dashboard","inbox","sales-orders","customers","godown","pool","transfers","rfq","vendor-pos","grn","invoices"], "primary": { "route": "inbox", "label": "My Approvals", "icon": "bell" }, "can": { "approveSO": true, "editSO": true, "viewCost": true, "authDispatch": true, "initiateTransfer": true, "viewProducts": true, "viewCustomers": true } },
    "Purchase": { "nav": ["dashboard","inbox","sales-orders","rfq","vendor-pos","grn","vendors","pool","products"], "primary": { "route": "rfq", "label": "RFQs", "icon": "grid" }, "can": { "createRFQ": true, "selectVendor": true, "createVendorPO": true, "viewVendors": true, "viewCost": true, "viewProducts": true } },
    "Stores": { "nav": ["dashboard","inbox","vendor-pos","grn","godown","pool","products"], "primary": { "route": "grn", "label": "GRN", "icon": "package" }, "can": { "createGRN": true, "reconcileSurplus": true, "viewProducts": true } },
    "Billing": { "nav": ["dashboard","inbox","sales-orders","three-way","invoices","vendor-pos"], "primary": { "route": "three-way", "label": "3-Way Match", "icon": "check" }, "can": { "do3way": true, "raiseInvoice": true, "generateEWB": true, "viewCost": true } },
    "Managing Director": { "nav": ["dashboard","inbox","sales-orders","rfq","vendor-pos","godown","pool","transfers","invoices","collections","audit"], "primary": { "route": "inbox", "label": "Approvals queue", "icon": "bell" }, "can": { "approveAll": true, "viewCost": true, "viewMD": true } },
    "Collections": { "nav": ["dashboard","inbox","collections","customers","invoices"], "primary": { "route": "collections", "label": "Collections", "icon": "cash" }, "can": { "logFollowup": true, "viewCustomers": true } }
  },
  "so_form_fields": [
    { "key": "customer_id", "label": "Customer", "type": "select", "required": true, "removable": false },
    { "key": "customer_po", "label": "Customer PO Reference (UID)", "type": "text", "required": true, "removable": false },
    { "key": "date", "label": "SO Date", "type": "date", "required": true, "removable": false },
    { "key": "expected", "label": "Expected Delivery", "type": "date", "required": false, "removable": true },
    { "key": "order_type", "label": "Order Type", "type": "select", "required": false, "removable": true, "options": ["Supply","Supply + Implementation","Service / AMC"] },
    { "key": "priority", "label": "Priority", "type": "select", "required": false, "removable": true, "options": ["Standard","Urgent","Critical"] },
    { "key": "payment_terms", "label": "Payment Terms", "type": "select", "required": false, "removable": true, "options": ["Advance","Net 7","Net 15","Net 30","Net 45","Net 60"] },
    { "key": "pm", "label": "Project Manager", "type": "select", "required": false, "removable": true },
    { "key": "notes", "label": "Notes", "type": "textarea", "required": false, "removable": true }
  ]
}
$json$)
on conflict (id) do nothing;

-- Users (role flow personas). Emails are placeholders until auth is wired.
insert into public.users (id, email, name, role, initials) values
  ('u-admin',    'aanya@brightline.in',  'Aanya Kapoor', 'Org Admin',         'AK'),
  ('u-sales',    'karan@brightline.in',  'Karan Mehra',  'Sales',             'KM'),
  ('u-ravi',     'ravi@brightline.in',   'Ravi Iyer',    'Project Manager',   'RI'),
  ('u-divya',    'divya@brightline.in',  'Divya Shah',   'Project Manager',   'DS'),
  ('u-purchase', 'pooja@brightline.in',  'Pooja Nair',   'Purchase',          'PN'),
  ('u-arun',     'arun@brightline.in',   'Arun Bhatia',  'Stores',            'AB'),
  ('u-billing',  'sneha@brightline.in',  'Sneha Rao',    'Billing',           'SR'),
  ('u-md',       'mukesh@brightline.in', 'Mukesh Desai', 'Managing Director', 'MD'),
  ('u-coll',     'tara@brightline.in',   'Tara Pillai',  'Collections',       'TP')
on conflict (id) do nothing;

-- Categories
insert into public.categories (id, name, hsn, gst, bundle_desc) values
  ('cat-pc',     'Office PC Bundle',   '8471', 18, 'Office PC bundle — Intel i5, 16GB RAM, 512GB SSD'),
  ('cat-srv',    'Rack Server Setup',  '8471', 18, 'Rack server setup — Xeon, 64GB ECC, dual SSD'),
  ('cat-cctv',   'CCTV Setup (4-cam)', '8525', 18, 'CCTV Setup — 4 IP cameras + DVR + storage'),
  ('cat-net',    'Networking Pack',    '8517', 18, 'Networking pack — 24-port switch, router, cables'),
  ('cat-laptop', 'Business Laptop',    '8471', 18, 'Business laptop — i7, 16GB, 1TB SSD')
on conflict (id) do nothing;

-- Products
insert into public.products (id, code, name, hsn, uom, gst, sell, buy) values
  ('p-cpu-i5',     'CPU-I5-13',     'Intel Core i5-13400',     '8473', 'Piece', 18, 18500, 16200),
  ('p-cpu-i7',     'CPU-I7-13',     'Intel Core i7-13700',     '8473', 'Piece', 18, 32000, 28500),
  ('p-cpu-xeon',   'CPU-XEON-4310', 'Intel Xeon Silver 4310',  '8473', 'Piece', 18, 98000, 86500),
  ('p-ram-16',     'RAM-DDR4-16',   'DDR4 16GB 3200MHz',       '8473', 'Piece', 18, 4200,  3450),
  ('p-ram-32',     'RAM-ECC-32',    'ECC DDR4 32GB',           '8473', 'Piece', 18, 14500, 12200),
  ('p-ssd-512',    'SSD-NVME-512',  'NVMe SSD 512GB',          '8523', 'Piece', 18, 4800,  3950),
  ('p-ssd-1t',     'SSD-NVME-1T',   'NVMe SSD 1TB',            '8523', 'Piece', 18, 7600,  6300),
  ('p-mobo-h610',  'MOBO-H610',     'Mobo Intel H610 LGA1700', '8473', 'Piece', 18, 7200,  6100),
  ('p-mobo-srv',   'MOBO-SRV-C621', 'Server board C621A',      '8473', 'Piece', 18, 42000, 36500),
  ('p-case-mt',    'CASE-MT',       'Mid-tower cabinet 500W',  '8473', 'Piece', 18, 3600,  2750),
  ('p-case-rack',  'CASE-2U',       '2U rackmount chassis',    '8473', 'Piece', 18, 18500, 15800),
  ('p-psu-650',    'PSU-650W',      'PSU 650W Bronze',         '8504', 'Piece', 18, 4500,  3650),
  ('p-mon-24',     'MON-24-IPS',    '24" IPS Monitor FHD',     '8528', 'Piece', 18, 12500, 10200),
  ('p-kb',         'KB-WIRED',      'Wired Keyboard + Mouse',  '8471', 'Set',   18, 850,   580),
  ('p-cam-ip',     'CAM-IP-4MP',    'IP Bullet Camera 4MP',    '8525', 'Piece', 18, 4200,  3300),
  ('p-nvr-8',      'NVR-8CH',       'NVR 8-channel PoE',       '8521', 'Piece', 18, 14500, 12100),
  ('p-hdd-2t',     'HDD-SURV-2T',   'Surveillance HDD 2TB',    '8523', 'Piece', 18, 5800,  4750),
  ('p-cat6',       'CAB-CAT6-305',  'CAT6 Cable Box 305m',     '8544', 'Box',   18, 7200,  5900),
  ('p-rj45',       'CON-RJ45',      'RJ45 Connector pack-100', '8536', 'Pack',  18, 480,   320),
  ('p-sw-24',      'SW-24P-GE',     '24-port Gigabit Switch',  '8517', 'Piece', 18, 16500, 13800),
  ('p-router',     'RTR-SMB',       'SMB Router Dual-WAN',     '8517', 'Piece', 18, 12500, 10400),
  ('p-lapt-i7',    'LAP-I7-16',     'Laptop i7 16GB 1TB',      '8471', 'Piece', 18, 78000, 68500)
on conflict (id) do nothing;

-- BOMs (one row per category)
insert into public.boms (category_id, components) values
  ('cat-pc', '[{"product_id":"p-cpu-i5","qty":1},{"product_id":"p-mobo-h610","qty":1},{"product_id":"p-ram-16","qty":1},{"product_id":"p-ssd-512","qty":1},{"product_id":"p-case-mt","qty":1},{"product_id":"p-psu-650","qty":1},{"product_id":"p-mon-24","qty":1},{"product_id":"p-kb","qty":1}]'::jsonb),
  ('cat-srv', '[{"product_id":"p-cpu-xeon","qty":2},{"product_id":"p-mobo-srv","qty":1},{"product_id":"p-ram-32","qty":4},{"product_id":"p-ssd-1t","qty":2},{"product_id":"p-case-rack","qty":1}]'::jsonb),
  ('cat-cctv', '[{"product_id":"p-cam-ip","qty":4},{"product_id":"p-nvr-8","qty":1},{"product_id":"p-hdd-2t","qty":1},{"product_id":"p-cat6","qty":1},{"product_id":"p-rj45","qty":1}]'::jsonb),
  ('cat-net', '[{"product_id":"p-sw-24","qty":1},{"product_id":"p-router","qty":1},{"product_id":"p-cat6","qty":1},{"product_id":"p-rj45","qty":1}]'::jsonb),
  ('cat-laptop', '[{"product_id":"p-lapt-i7","qty":1}]'::jsonb)
on conflict (category_id) do nothing;

-- Customers
insert into public.customers (id, code, name, gstin, state, address, contact, phone, terms, credit_limit, tier) values
  ('c-rana',     'C0001', 'Rana Constructions Pvt Ltd', '27AABCR1234N1Z5', 'Maharashtra', 'Plot 14, Andheri MIDC, Mumbai 400093',          'Vikas Rana',       '+91 98200 12340', 'Net 30', 2500000, 'Gold'),
  ('c-zenith',   'C0002', 'Zenith Logistics LLP',       '29AAFCZ5678M1ZK', 'Karnataka',   'Whitefield, Bengaluru 560066',                  'Anita Pillai',     '+91 99000 56781', 'Net 45', 5000000, 'Platinum'),
  ('c-mehta',    'C0003', 'Mehta Textiles',             '24AABFM9012P1Z8', 'Gujarat',     'Ring Road, Surat 395002',                       'Hardik Mehta',     '+91 98250 90120', 'Net 15', 1000000, 'Silver'),
  ('c-orbit',    'C0004', 'Orbit Hospitals',            '07AABCO3456L1Z2', 'Delhi',       'Saket District Centre, New Delhi 110017',       'Dr. Reema Saxena', '+91 98110 34561', 'Net 30', 3000000, 'Gold'),
  ('c-southern', 'C0005', 'Southern Polymers',          '33AAACS7890T1ZP', 'Tamil Nadu',  'Ambattur Industrial Estate, Chennai 600058',    'Karthik R',        '+91 98400 78901', 'Net 60', 4000000, 'Gold')
on conflict (id) do nothing;

-- Vendors
insert into public.vendors (id, code, name, gstin, city, contact, phone, terms, rating, type) values
  ('v-techsource', 'V0001', 'TechSource Distributors', '27AABCT1111N1Z3', 'Mumbai',    'Saurabh Joshi', '+91 98201 11111', 'Net 30', 4.6, 'Goods'),
  ('v-compworld',  'V0002', 'Compworld India',         '07AABCC2222M1Z4', 'Delhi',     'Priya Khanna',  '+91 98110 22222', 'Net 15', 4.2, 'Goods'),
  ('v-rapidnet',   'V0003', 'Rapid Networks',          '29AABCR3333P1Z5', 'Bengaluru', 'Mohan Bhat',    '+91 99001 33333', 'Net 30', 4.4, 'Goods'),
  ('v-orient',     'V0004', 'Orient IT Supplies',      '24AABCO4444L1Z6', 'Ahmedabad', 'Jignesh Patel', '+91 98251 44444', 'Net 45', 3.9, 'Goods'),
  ('v-prime',      'V0005', 'Prime Computech',         '33AABCP5555T1Z7', 'Chennai',   'Lalitha S',     '+91 98401 55555', 'Net 30', 4.5, 'Goods')
on conflict (id) do nothing;
