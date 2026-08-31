#!/usr/bin/env node
// Dump the frontend's built-in catalogue (seed.js) to JSON, so it can be
// persisted into ONE organization by ssh-backfill-master-data.py.
//
// Usage: node scripts/uitest/dump-seed-masters.js [frontend-dir] [out.json]
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'frontend';
const out = process.argv[3] || 'seed-masters.json';

const src = fs.readFileSync(path.join(dir, 'src', 'seed.js'), 'utf8');
const w = {}; w.window = w;
new Function('window', src)(w);
const s = w.OPC_SEED || {};

const payload = {
  products: s.products || [],
  categories: s.categories || [],
  boms: s.boms || {},          // an object map: { category_id: [components] }
  customers: s.customers || [],
  vendors: s.vendors || [],
};
fs.writeFileSync(out, JSON.stringify(payload));
console.log(
  'products', payload.products.length,
  '· categories', payload.categories.length,
  '· boms', Object.keys(payload.boms).length,
  '· customers', payload.customers.length,
  '· vendors', payload.vendors.length,
  '->', out);
