// OP Central — seed data for trading/distribution scenario
// PCs, servers, networking. All Indian context.
//
// MASTER DATA ONLY. Transactional mock (sales orders, vendor POs, GRNs, vendor
// invoices, payments, surplus pool, RFQs) is intentionally empty — real records
// are created through the app's role workflow. The master data below is what the
// SO-creation form needs (customers, categories, products, BOMs) plus the users
// that drive the role flow.

const SEED_VERSION = 'opc-2026-06-03-v6-sourcing';

const CATEGORIES = [
  { id: 'cat-pc', name: 'Office PC Bundle', hsn: '8471', gst: 18, bundle_desc: 'Office PC bundle — Intel i5, 16GB RAM, 512GB SSD' },
  { id: 'cat-srv', name: 'Rack Server Setup', hsn: '8471', gst: 18, bundle_desc: 'Rack server setup — Xeon, 64GB ECC, dual SSD' },
  { id: 'cat-cctv', name: 'CCTV Setup (4-cam)', hsn: '8525', gst: 18, bundle_desc: 'CCTV Setup — 4 IP cameras + DVR + storage' },
  { id: 'cat-net', name: 'Networking Pack', hsn: '8517', gst: 18, bundle_desc: 'Networking pack — 24-port switch, router, cables' },
  { id: 'cat-laptop', name: 'Business Laptop', hsn: '8471', gst: 18, bundle_desc: 'Business laptop — i7, 16GB, 1TB SSD' },
];

const PRODUCTS = [
  { id: 'p-cpu-i5', code: 'CPU-I5-13', name: 'Intel Core i5-13400', hsn: '8473', uom: 'Piece', gst: 18, sell: 18500, buy: 16200 },
  { id: 'p-cpu-i7', code: 'CPU-I7-13', name: 'Intel Core i7-13700', hsn: '8473', uom: 'Piece', gst: 18, sell: 32000, buy: 28500 },
  { id: 'p-cpu-xeon', code: 'CPU-XEON-4310', name: 'Intel Xeon Silver 4310', hsn: '8473', uom: 'Piece', gst: 18, sell: 98000, buy: 86500 },
  { id: 'p-ram-16', code: 'RAM-DDR4-16', name: 'DDR4 16GB 3200MHz', hsn: '8473', uom: 'Piece', gst: 18, sell: 4200, buy: 3450 },
  { id: 'p-ram-32', code: 'RAM-ECC-32', name: 'ECC DDR4 32GB', hsn: '8473', uom: 'Piece', gst: 18, sell: 14500, buy: 12200 },
  { id: 'p-ssd-512', code: 'SSD-NVME-512', name: 'NVMe SSD 512GB', hsn: '8523', uom: 'Piece', gst: 18, sell: 4800, buy: 3950 },
  { id: 'p-ssd-1t', code: 'SSD-NVME-1T', name: 'NVMe SSD 1TB', hsn: '8523', uom: 'Piece', gst: 18, sell: 7600, buy: 6300 },
  { id: 'p-mobo-h610', code: 'MOBO-H610', name: 'Mobo Intel H610 LGA1700', hsn: '8473', uom: 'Piece', gst: 18, sell: 7200, buy: 6100 },
  { id: 'p-mobo-srv', code: 'MOBO-SRV-C621', name: 'Server board C621A', hsn: '8473', uom: 'Piece', gst: 18, sell: 42000, buy: 36500 },
  { id: 'p-case-mt', code: 'CASE-MT', name: 'Mid-tower cabinet 500W', hsn: '8473', uom: 'Piece', gst: 18, sell: 3600, buy: 2750 },
  { id: 'p-case-rack', code: 'CASE-2U', name: '2U rackmount chassis', hsn: '8473', uom: 'Piece', gst: 18, sell: 18500, buy: 15800 },
  { id: 'p-psu-650', code: 'PSU-650W', name: 'PSU 650W Bronze', hsn: '8504', uom: 'Piece', gst: 18, sell: 4500, buy: 3650 },
  { id: 'p-mon-24', code: 'MON-24-IPS', name: '24" IPS Monitor FHD', hsn: '8528', uom: 'Piece', gst: 18, sell: 12500, buy: 10200 },
  { id: 'p-kb', code: 'KB-WIRED', name: 'Wired Keyboard + Mouse', hsn: '8471', uom: 'Set', gst: 18, sell: 850, buy: 580 },
  { id: 'p-cam-ip', code: 'CAM-IP-4MP', name: 'IP Bullet Camera 4MP', hsn: '8525', uom: 'Piece', gst: 18, sell: 4200, buy: 3300 },
  { id: 'p-nvr-8', code: 'NVR-8CH', name: 'NVR 8-channel PoE', hsn: '8521', uom: 'Piece', gst: 18, sell: 14500, buy: 12100 },
  { id: 'p-hdd-2t', code: 'HDD-SURV-2T', name: 'Surveillance HDD 2TB', hsn: '8523', uom: 'Piece', gst: 18, sell: 5800, buy: 4750 },
  { id: 'p-cat6', code: 'CAB-CAT6-305', name: 'CAT6 Cable Box 305m', hsn: '8544', uom: 'Box', gst: 18, sell: 7200, buy: 5900 },
  { id: 'p-rj45', code: 'CON-RJ45', name: 'RJ45 Connector pack-100', hsn: '8536', uom: 'Pack', gst: 18, sell: 480, buy: 320 },
  { id: 'p-sw-24', code: 'SW-24P-GE', name: '24-port Gigabit Switch', hsn: '8517', uom: 'Piece', gst: 18, sell: 16500, buy: 13800 },
  { id: 'p-router', code: 'RTR-SMB', name: 'SMB Router Dual-WAN', hsn: '8517', uom: 'Piece', gst: 18, sell: 12500, buy: 10400 },
  { id: 'p-lapt-i7', code: 'LAP-I7-16', name: 'Laptop i7 16GB 1TB', hsn: '8471', uom: 'Piece', gst: 18, sell: 78000, buy: 68500 },
];

const BOMS = {
  'cat-pc': [
    { product_id: 'p-cpu-i5', qty: 1 },
    { product_id: 'p-mobo-h610', qty: 1 },
    { product_id: 'p-ram-16', qty: 1 },
    { product_id: 'p-ssd-512', qty: 1 },
    { product_id: 'p-case-mt', qty: 1 },
    { product_id: 'p-psu-650', qty: 1 },
    { product_id: 'p-mon-24', qty: 1 },
    { product_id: 'p-kb', qty: 1 },
  ],
  'cat-srv': [
    { product_id: 'p-cpu-xeon', qty: 2 },
    { product_id: 'p-mobo-srv', qty: 1 },
    { product_id: 'p-ram-32', qty: 4 },
    { product_id: 'p-ssd-1t', qty: 2 },
    { product_id: 'p-case-rack', qty: 1 },
  ],
  'cat-cctv': [
    { product_id: 'p-cam-ip', qty: 4 },
    { product_id: 'p-nvr-8', qty: 1 },
    { product_id: 'p-hdd-2t', qty: 1 },
    { product_id: 'p-cat6', qty: 1 },
    { product_id: 'p-rj45', qty: 1 },
  ],
  'cat-net': [
    { product_id: 'p-sw-24', qty: 1 },
    { product_id: 'p-router', qty: 1 },
    { product_id: 'p-cat6', qty: 1 },
    { product_id: 'p-rj45', qty: 1 },
  ],
  'cat-laptop': [
    { product_id: 'p-lapt-i7', qty: 1 },
  ],
};

const CUSTOMERS = [
  { id: 'c-rana', code: 'C0001', name: 'Rana Constructions Pvt Ltd', gstin: '27AABCR1234N1Z5', state: 'Maharashtra', address: 'Plot 14, Andheri MIDC, Mumbai 400093', contact: 'Vikas Rana', phone: '+91 98200 12340', terms: 'Net 30', credit_limit: 2500000, tier: 'Gold' },
  { id: 'c-zenith', code: 'C0002', name: 'Zenith Logistics LLP', gstin: '29AAFCZ5678M1ZK', state: 'Karnataka', address: 'Whitefield, Bengaluru 560066', contact: 'Anita Pillai', phone: '+91 99000 56781', terms: 'Net 45', credit_limit: 5000000, tier: 'Platinum' },
  { id: 'c-mehta', code: 'C0003', name: 'Mehta Textiles', gstin: '24AABFM9012P1Z8', state: 'Gujarat', address: 'Ring Road, Surat 395002', contact: 'Hardik Mehta', phone: '+91 98250 90120', terms: 'Net 15', credit_limit: 1000000, tier: 'Silver' },
  { id: 'c-orbit', code: 'C0004', name: 'Orbit Hospitals', gstin: '07AABCO3456L1Z2', state: 'Delhi', address: 'Saket District Centre, New Delhi 110017', contact: 'Dr. Reema Saxena', phone: '+91 98110 34561', terms: 'Net 30', credit_limit: 3000000, tier: 'Gold' },
  { id: 'c-southern', code: 'C0005', name: 'Southern Polymers', gstin: '33AAACS7890T1ZP', state: 'Tamil Nadu', address: 'Ambattur Industrial Estate, Chennai 600058', contact: 'Karthik R', phone: '+91 98400 78901', terms: 'Net 60', credit_limit: 4000000, tier: 'Gold' },
];

const VENDORS = [
  { id: 'v-techsource', code: 'V0001', name: 'TechSource Distributors', gstin: '27AABCT1111N1Z3', city: 'Mumbai', contact: 'Saurabh Joshi', phone: '+91 98201 11111', terms: 'Net 30', rating: 4.6, type: 'Goods' },
  { id: 'v-compworld', code: 'V0002', name: 'Compworld India', gstin: '07AABCC2222M1Z4', city: 'Delhi', contact: 'Priya Khanna', phone: '+91 98110 22222', terms: 'Net 15', rating: 4.2, type: 'Goods' },
  { id: 'v-rapidnet', code: 'V0003', name: 'Rapid Networks', gstin: '29AABCR3333P1Z5', city: 'Bengaluru', contact: 'Mohan Bhat', phone: '+91 99001 33333', terms: 'Net 30', rating: 4.4, type: 'Goods' },
  { id: 'v-orient', code: 'V0004', name: 'Orient IT Supplies', gstin: '24AABCO4444L1Z6', city: 'Ahmedabad', contact: 'Jignesh Patel', phone: '+91 98251 44444', terms: 'Net 45', rating: 3.9, type: 'Goods' },
  { id: 'v-prime', code: 'V0005', name: 'Prime Computech', gstin: '33AABCP5555T1Z7', city: 'Chennai', contact: 'Lalitha S', phone: '+91 98401 55555', terms: 'Net 30', rating: 4.5, type: 'Goods' },
];

// === Transactional data — intentionally empty (no mock). Real records flow in
// through the role workflow (Sales creates SO → PM approves → Purchase → …). ===
const SALES_ORDERS = [];
const POOL_ITEMS = [];
const VENDOR_POS = [];
const GRNS = [];
const VENDOR_INVOICES = [];
const PAYMENTS = [];
const RFQS = [];
const SOURCINGS = [];   // pre-SO sourcing/costing exercises (created via the app)

// No users seeded. The first admin self-signs-up on the login screen (only
// possible while no admin exists); the admin then creates all other users, who
// can only log in. Users live in the DB; this array stays empty.
const USERS = [];

const ORG = {
  name: 'Brightline Systems Pvt Ltd',
  short: 'Brightline',
  gstin: '27AABCB9999N1Z2',
  state: 'Maharashtra',
  address: 'Office 402, Lotus Tech Park, Powai, Mumbai 400076',
  industry: 'Trading',
  fiscal_year: '2025-26',
  brand_color: '#3563a4',
  logo_letter: 'B',
};

const SEED = {
  version: SEED_VERSION,
  org: ORG,
  users: USERS,
  categories: CATEGORIES,
  products: PRODUCTS,
  boms: BOMS,
  customers: CUSTOMERS,
  vendors: VENDORS,
  sales_orders: SALES_ORDERS,
  vendor_pos: VENDOR_POS,
  grns: GRNS,
  vendor_invoices: VENDOR_INVOICES,
  payments: PAYMENTS,
  pool: POOL_ITEMS,
  rfqs: RFQS,
  sourcings: SOURCINGS,
};

window.OPC_SEED = SEED;
