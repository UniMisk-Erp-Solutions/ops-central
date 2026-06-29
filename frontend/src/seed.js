// OP Central — seed data for trading/distribution scenario
// PCs, servers, networking. All Indian context.
//
// MASTER DATA ONLY. Transactional mock (sales orders, vendor POs, GRNs, vendor
// invoices, payments, surplus pool, RFQs) is intentionally empty — real records
// are created through the app's role workflow. The master data below is what the
// SO-creation form needs (customers, categories, products, BOMs) plus the users
// that drive the role flow.

const SEED_VERSION = 'opc-2026-06-29-v7-aliases';

// `aliases` are the customer-facing names a client/sales person might say. They
// drive 1-to-1 mapping at SO creation: searching "rack server" resolves to the
// internal "Rack Server Setup" bundle, so inventory is managed by the real BOM.
const CATEGORIES = [
  { id: 'cat-pc', name: 'Office PC Bundle', hsn: '8471', gst: 18, bundle_desc: 'Office PC bundle — Intel i5, 16GB RAM, 512GB SSD', aliases: ['desktop', 'office computer', 'desktop pc', 'staff computer', 'office pc'] },
  { id: 'cat-srv', name: 'Rack Server Setup', hsn: '8471', gst: 18, bundle_desc: 'Rack server setup — Xeon, 64GB ECC, dual SSD', aliases: ['rack server', 'server', 'asp server', 'server setup', 'rackserver'] },
  { id: 'cat-cctv', name: 'CCTV Setup (4-cam)', hsn: '8525', gst: 18, bundle_desc: 'CCTV Setup — 4 IP cameras + DVR + storage', aliases: ['cctv', 'camera setup', 'surveillance', 'security camera', 'cctv setup'] },
  { id: 'cat-net', name: 'Networking Pack', hsn: '8517', gst: 18, bundle_desc: 'Networking pack — 24-port switch, router, cables', aliases: ['networking', 'lan setup', 'switch setup', 'network pack'] },
  { id: 'cat-laptop', name: 'Business Laptop', hsn: '8471', gst: 18, bundle_desc: 'Business laptop — i7, 16GB, 1TB SSD', aliases: ['laptop', 'notebook', 'business laptop'] },
  { id: 'cat-ws', name: 'Workstation Bundle', hsn: '8471', gst: 18, bundle_desc: 'Design workstation — i7, 64GB, RTX 4070, 4K monitor', aliases: ['design workstation', 'cad pc', 'graphics workstation', 'editing pc', 'workstation'] },
  { id: 'cat-gaming', name: 'Gaming PC Build', hsn: '8471', gst: 18, bundle_desc: 'Gaming rig — i9, 64GB, RTX 4060, 850W', aliases: ['gaming rig', 'gaming computer', 'gaming pc', 'gaming setup'] },
  { id: 'cat-nas', name: 'NAS Storage Server', hsn: '8471', gst: 18, bundle_desc: 'NAS — 4-bay, 16TB, dual RAM', aliases: ['nas', 'storage box', 'file server', 'network storage', 'nas box'] },
  { id: 'cat-vc', name: 'Video Conferencing Kit', hsn: '8525', gst: 18, bundle_desc: 'VC kit — 4K PTZ camera, speakerphone, 55" display', aliases: ['vc kit', 'conference room setup', 'meeting room kit', 'video conf', 'conference room'] },
  { id: 'cat-bio', name: 'Biometric Access System', hsn: '8536', gst: 18, bundle_desc: 'Access control — controller, readers, EM locks', aliases: ['attendance machine', 'access control', 'fingerprint system', 'door access', 'biometric'] },
  { id: 'cat-solar', name: 'Solar Power Backup', hsn: '8541', gst: 18, bundle_desc: 'Solar backup — panels, hybrid inverter, Li-ion battery', aliases: ['solar setup', 'inverter system', 'solar ups', 'power backup', 'solar'] },
  { id: 'cat-pos', name: 'POS Billing Terminal', hsn: '8470', gst: 18, bundle_desc: 'POS — terminal, thermal printer, scanner, cash drawer', aliases: ['billing machine', 'pos system', 'cash counter', 'billing counter', 'pos'] },
  { id: 'cat-signage', name: 'Digital Signage Display', hsn: '8528', gst: 18, bundle_desc: 'Signage — dual 55" 4K displays + media player', aliases: ['led display', 'advertising screen', 'digital board', 'signage', 'display board'] },
  { id: 'cat-wifi', name: 'WiFi Mesh Network', hsn: '8517', gst: 18, bundle_desc: 'WiFi — 4 WiFi-6 APs, controller, PoE switch', aliases: ['wifi setup', 'office wifi', 'mesh network', 'wireless network', 'wifi'] },
  { id: 'cat-rack', name: 'Server Rack Cabinet', hsn: '9403', gst: 18, bundle_desc: 'Rack — 42U cabinet, PDUs, shelves, fans', aliases: ['server rack', 'network rack', 'data cabinet', 'rack cabinet', 'rack'] },
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
  // --- Components for the additional test bundles ---
  { id: 'p-cpu-i9', code: 'CPU-I9-13', name: 'Intel Core i9-13900', hsn: '8473', uom: 'Piece', gst: 18, sell: 52000, buy: 46000 },
  { id: 'p-mobo-z790', code: 'MOBO-Z790', name: 'Mobo Z790 ATX', hsn: '8473', uom: 'Piece', gst: 18, sell: 24500, buy: 21000 },
  { id: 'p-gpu-rtx', code: 'GPU-RTX4060', name: 'GPU RTX 4060 8GB', hsn: '8473', uom: 'Piece', gst: 18, sell: 38000, buy: 33000 },
  { id: 'p-gpu-rtx70', code: 'GPU-RTX4070', name: 'GPU RTX 4070 12GB', hsn: '8473', uom: 'Piece', gst: 18, sell: 62000, buy: 54000 },
  { id: 'p-case-full', code: 'CASE-FT', name: 'Full-tower cabinet', hsn: '8473', uom: 'Piece', gst: 18, sell: 6800, buy: 5400 },
  { id: 'p-psu-850', code: 'PSU-850W', name: 'PSU 850W Gold', hsn: '8504', uom: 'Piece', gst: 18, sell: 8200, buy: 6800 },
  { id: 'p-mon-27', code: 'MON-27-4K', name: '27" 4K Monitor', hsn: '8528', uom: 'Piece', gst: 18, sell: 28000, buy: 23500 },
  { id: 'p-nas-4bay', code: 'NAS-4BAY', name: 'NAS 4-bay chassis', hsn: '8471', uom: 'Piece', gst: 18, sell: 32000, buy: 27500 },
  { id: 'p-hdd-4t', code: 'HDD-NAS-4T', name: 'NAS HDD 4TB', hsn: '8523', uom: 'Piece', gst: 18, sell: 9800, buy: 8100 },
  { id: 'p-cam-4k', code: 'CAM-4K-PTZ', name: '4K Conference Camera', hsn: '8525', uom: 'Piece', gst: 18, sell: 42000, buy: 36000 },
  { id: 'p-speak', code: 'SPK-USB', name: 'USB Speakerphone', hsn: '8518', uom: 'Piece', gst: 18, sell: 14500, buy: 12000 },
  { id: 'p-disp-55', code: 'DISP-55-4K', name: '55" 4K Display', hsn: '8528', uom: 'Piece', gst: 18, sell: 54000, buy: 46500 },
  { id: 'p-disp-mount', code: 'MNT-WALL', name: 'Display Wall Mount', hsn: '8302', uom: 'Piece', gst: 18, sell: 2800, buy: 1900 },
  { id: 'p-media-player', code: 'MEDIA-PLR', name: 'Signage Media Player', hsn: '8521', uom: 'Piece', gst: 18, sell: 12500, buy: 10200 },
  { id: 'p-bio-ctrl', code: 'BIO-CTRL', name: 'Biometric Controller', hsn: '8536', uom: 'Piece', gst: 18, sell: 18500, buy: 15500 },
  { id: 'p-bio-reader', code: 'BIO-RDR', name: 'Fingerprint Reader', hsn: '8536', uom: 'Piece', gst: 18, sell: 6500, buy: 5200 },
  { id: 'p-emlock', code: 'LOCK-EM600', name: 'EM Lock 600lb', hsn: '8301', uom: 'Piece', gst: 18, sell: 3200, buy: 2400 },
  { id: 'p-solar-panel', code: 'SOL-PNL-540', name: 'Solar Panel 540W', hsn: '8541', uom: 'Piece', gst: 18, sell: 14500, buy: 12000 },
  { id: 'p-inverter', code: 'INV-5KVA', name: 'Hybrid Inverter 5KVA', hsn: '8504', uom: 'Piece', gst: 18, sell: 48000, buy: 41000 },
  { id: 'p-battery', code: 'BAT-LI-5K', name: 'Li-ion Battery 5KWh', hsn: '8507', uom: 'Piece', gst: 18, sell: 165000, buy: 145000 },
  { id: 'p-pos-term', code: 'POS-TERM', name: 'POS Terminal 15"', hsn: '8470', uom: 'Piece', gst: 18, sell: 32000, buy: 27000 },
  { id: 'p-pos-print', code: 'PRN-THERM', name: 'Thermal Receipt Printer', hsn: '8443', uom: 'Piece', gst: 18, sell: 8500, buy: 6900 },
  { id: 'p-barcode', code: 'SCN-2D', name: 'Barcode Scanner 2D', hsn: '8471', uom: 'Piece', gst: 18, sell: 4200, buy: 3300 },
  { id: 'p-cashdrawer', code: 'CASH-DRW', name: 'Cash Drawer', hsn: '8304', uom: 'Piece', gst: 18, sell: 3800, buy: 2900 },
  { id: 'p-ap-wifi6', code: 'AP-WIFI6', name: 'WiFi 6 Access Point', hsn: '8517', uom: 'Piece', gst: 18, sell: 14500, buy: 12000 },
  { id: 'p-wlc', code: 'WLC-CTRL', name: 'Wireless Controller', hsn: '8517', uom: 'Piece', gst: 18, sell: 28000, buy: 24000 },
  { id: 'p-poe-sw', code: 'SW-8P-POE', name: '8-port PoE Switch', hsn: '8517', uom: 'Piece', gst: 18, sell: 11500, buy: 9500 },
  { id: 'p-rack-42u', code: 'RACK-42U', name: '42U Server Rack', hsn: '9403', uom: 'Piece', gst: 18, sell: 38000, buy: 32000 },
  { id: 'p-pdu', code: 'PDU-16A', name: 'Rack PDU 16A', hsn: '8536', uom: 'Piece', gst: 18, sell: 6800, buy: 5500 },
  { id: 'p-rack-shelf', code: 'SHELF-1U', name: 'Rack Shelf 1U', hsn: '9403', uom: 'Piece', gst: 18, sell: 2200, buy: 1600 },
  { id: 'p-rack-fan', code: 'FAN-RACK', name: 'Rack Fan Unit', hsn: '8414', uom: 'Piece', gst: 18, sell: 3500, buy: 2700 },
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
  'cat-ws': [
    { product_id: 'p-cpu-i7', qty: 1 },
    { product_id: 'p-mobo-z790', qty: 1 },
    { product_id: 'p-ram-32', qty: 2 },
    { product_id: 'p-ssd-1t', qty: 1 },
    { product_id: 'p-gpu-rtx70', qty: 1 },
    { product_id: 'p-case-full', qty: 1 },
    { product_id: 'p-psu-850', qty: 1 },
    { product_id: 'p-mon-27', qty: 1 },
  ],
  'cat-gaming': [
    { product_id: 'p-cpu-i9', qty: 1 },
    { product_id: 'p-mobo-z790', qty: 1 },
    { product_id: 'p-ram-32', qty: 2 },
    { product_id: 'p-ssd-1t', qty: 1 },
    { product_id: 'p-gpu-rtx', qty: 1 },
    { product_id: 'p-case-full', qty: 1 },
    { product_id: 'p-psu-850', qty: 1 },
  ],
  'cat-nas': [
    { product_id: 'p-nas-4bay', qty: 1 },
    { product_id: 'p-hdd-4t', qty: 4 },
    { product_id: 'p-ram-16', qty: 2 },
    { product_id: 'p-cpu-i5', qty: 1 },
  ],
  'cat-vc': [
    { product_id: 'p-cam-4k', qty: 1 },
    { product_id: 'p-speak', qty: 1 },
    { product_id: 'p-disp-55', qty: 1 },
    { product_id: 'p-disp-mount', qty: 1 },
  ],
  'cat-bio': [
    { product_id: 'p-bio-ctrl', qty: 1 },
    { product_id: 'p-bio-reader', qty: 2 },
    { product_id: 'p-emlock', qty: 2 },
    { product_id: 'p-cat6', qty: 1 },
  ],
  'cat-solar': [
    { product_id: 'p-solar-panel', qty: 4 },
    { product_id: 'p-inverter', qty: 1 },
    { product_id: 'p-battery', qty: 2 },
  ],
  'cat-pos': [
    { product_id: 'p-pos-term', qty: 1 },
    { product_id: 'p-pos-print', qty: 1 },
    { product_id: 'p-barcode', qty: 1 },
    { product_id: 'p-cashdrawer', qty: 1 },
  ],
  'cat-signage': [
    { product_id: 'p-disp-55', qty: 2 },
    { product_id: 'p-media-player', qty: 1 },
    { product_id: 'p-disp-mount', qty: 2 },
  ],
  'cat-wifi': [
    { product_id: 'p-ap-wifi6', qty: 4 },
    { product_id: 'p-wlc', qty: 1 },
    { product_id: 'p-poe-sw', qty: 1 },
    { product_id: 'p-cat6', qty: 1 },
    { product_id: 'p-rj45', qty: 1 },
  ],
  'cat-rack': [
    { product_id: 'p-rack-42u', qty: 1 },
    { product_id: 'p-pdu', qty: 2 },
    { product_id: 'p-rack-shelf', qty: 4 },
    { product_id: 'p-rack-fan', qty: 2 },
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
