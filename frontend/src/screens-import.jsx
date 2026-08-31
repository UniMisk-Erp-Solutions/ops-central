// ============================================================================
// Import a customer working sheet (Excel / CSV) → an editable Sales Order
// ============================================================================
// Purchase (and Org Admin) turn the customer's BOQ into an order of ours. The
// sheet looks like this:
//
//   Type of Equipements │ Sr. No. │ Part No.        │ Item Description        │ Unit │ Qty │ … │ Po SR No
//   ────────────────────┼─────────┼─────────────────┼─────────────────────────┼──────┼─────┼───┼─────────
//   Group A: Core Switch - Cisco Catalyst C9600 Series          ← group banner
//   Cisco Catalyst 9600 │ 1       │ C9606R          │ 9600 Series 6 Slot …    │ Nos. │  1  │   │    1
//   Series 6 Slot        │ 1.0.1   │ CON-SNTP-C9606R │ SNTC-24X7X4 …           │ Nos. │  1  │   │
//   Chassis (merged ↕)   │ 1.1.1   │ C9600-DNA-A-3Y  │ DNA Advantage 3 Year    │ Nos. │  1  │   │
//                        │ 2       │ C9606-RACK-KIT= │ Rack Mount              │ Nos. │  1  │   │
//                                    Group A - Total                            ← subtotal
//
// Three things in that layout carry meaning and are easy to lose:
//
//   1. THE Sr. No. IS A HIERARCHY. "1" is the chassis; "1.0.1" … "1.17" are the
//      licences, modules and cables that go INSIDE it. Flattening them into
//      separate order lines destroys the bill of materials — the whole point of
//      the sheet. A leading integer therefore starts a line, and every "1.x"
//      under it becomes a component of that line.
//
//   2. MERGED CELLS ARE BLANK ON CONTINUATION ROWS. "Type of Equipements" and
//      "Po SR No" are written once and merged down, so they arrive as empty
//      strings and have to be carried forward.
//
//   3. BANNERS AND SUBTOTALS ARE NOT ITEMS. "Group A: …" and "Group A - Total"
//      look like rows and must not become order lines.
//
// Anything whose Part No. is not in our catalogue is shown for a decision
// rather than silently dropped, and whatever is imported is remembered as that
// customer's alias — so the same sheet next quarter matches by itself.
// ============================================================================

// Header names we accept. Matched case-insensitively, exact first then
// substring, so "Qty." / "Quantity" / "QTY" all land on the same column and a
// slightly different sheet still imports.
const IMP_HEADERS = {
  equip: ['type of equipements', 'type of equipment', 'type of equipments', 'equipment', 'equipment type'],
  sr:    ['sr no', 'sr. no.', 'sr.no', 'srno', 's.no', 'sno', 'sr'],
  code:  ['part no', 'part no.', 'partno', 'part number', 'model no', 'model', 'sku', 'item code'],
  desc:  ['item description', 'description', 'particulars', 'item name', 'item'],
  unit:  ['unit', 'uom'],
  qty:   ['qty', 'qty.', 'quantity', 'nos'],
  rate:  ['unit rate', 'rate', 'unit price', 'price', 'basic rate'],
  tax:   ['tax rate %', 'tax rate', 'tax %', 'gst %', 'gst', 'tax'],
  posr:  ['po sr no', 'po sr no.', 'po srno', 'po sr', 'po no'],
};

function impPick(headerRow, keys) {
  const low = (headerRow || []).map(h => String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' '));
  for (const k of keys) { const i = low.indexOf(k); if (i !== -1) return i; }
  for (let i = 0; i < low.length; i++) {
    if (!low[i]) continue;
    if (keys.some(k => low[i] === k || low[i].startsWith(k) || low[i].includes(k))) return i;
  }
  return -1;
}

const impText = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
// Sheets carry "₹ 1,234.00", "18%", " - " and stray spaces. Strip to a number,
// and treat "-" (the accounting dash for nil) as zero rather than NaN.
function impNum(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '').replace(/(?!^)-/g, '');
  if (!s || s === '-' || s === '.') return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

// "1" -> top level. "1.0.1" / "1.17" -> belongs under 1.
function impSrParent(sr) {
  const s = impText(sr).replace(/\s/g, '');
  if (!s) return null;
  const m = /^(\d+)(?:\.(.+))?$/.exec(s);
  if (!m) return null;
  return { top: m[1], isChild: !!m[2], sr: s };
}

// A banner row: "Group A: Core Switch - Cisco Catalyst C9600 Series".
function impIsGroupBanner(cells) {
  const joined = cells.map(impText).filter(Boolean).join(' ');
  return /^group\s+[A-Za-z0-9]+\s*[:\-]/i.test(joined) && !/\btotal\b/i.test(joined);
}
// A subtotal row: "Group A - Total", "Grand Total", "Sub Total".
function impIsTotalRow(cells) {
  const joined = cells.map(impText).filter(Boolean).join(' ');
  return /\b(sub\s*total|grand\s*total|total)\b/i.test(joined);
}

// ---------------------------------------------------------------------------
// Sheet matrix -> flat rows. Pure, so it can be tested without a browser.
// ---------------------------------------------------------------------------
function impParseMatrix(matrix) {
  let hIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const r = matrix[i] || [];
    if (impPick(r, IMP_HEADERS.qty) !== -1 &&
        (impPick(r, IMP_HEADERS.desc) !== -1 || impPick(r, IMP_HEADERS.code) !== -1)) { hIdx = i; break; }
  }
  if (hIdx === -1) return { error: 'Could not find a header row with a Qty and a Part No. / Item Description column.', rows: [] };

  const H = matrix[hIdx];
  const col = {};
  Object.keys(IMP_HEADERS).forEach(k => { col[k] = impPick(H, IMP_HEADERS[k]); });

  const rows = [];
  let group = '', equip = '', posr = '', lastTop = null;

  for (let i = hIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    const cells = r.map(impText);
    if (!cells.some(Boolean)) continue;

    if (impIsGroupBanner(cells)) { group = cells.filter(Boolean).join(' '); continue; }

    const code = col.code !== -1 ? impText(r[col.code]) : '';
    const desc = col.desc !== -1 ? impText(r[col.desc]) : '';
    const qty = col.qty !== -1 ? impNum(r[col.qty]) : 0;

    // A subtotal has a label but no part number — never an item.
    if (impIsTotalRow(cells) && !code) continue;
    if (!code && !desc) continue;

    // Merged cells arrive blank on every row but the first — carry forward.
    if (col.equip !== -1 && impText(r[col.equip])) equip = impText(r[col.equip]);
    if (col.posr !== -1 && impText(r[col.posr])) posr = impText(r[col.posr]);

    const srInfo = impSrParent(col.sr !== -1 ? r[col.sr] : '');
    let top, isChild;
    if (srInfo) { top = srInfo.top; isChild = srInfo.isChild; lastTop = top; }
    else { top = lastTop; isChild = lastTop != null; }   // no Sr. No. -> part of the line above
    if (top == null) { top = String(rows.length + 1); isChild = false; lastTop = top; }

    rows.push({
      key: 'r' + i,
      sr: srInfo ? srInfo.sr : '',
      top, isChild,
      group, equip, posr,
      code, desc,
      unit: col.unit !== -1 ? (impText(r[col.unit]) || 'Nos.') : 'Nos.',
      qty,
      rate: col.rate !== -1 ? impNum(r[col.rate]) : 0,
      tax: col.tax !== -1 ? (impNum(r[col.tax]) || 18) : 18,
      product_id: null, matched_by: null,
      action: 'create',          // decided after resolving
    });
  }
  return { rows, header: H, columns: col, headerRow: hIdx };
}

// Flat rows -> the bundles the order will be built from.
//
// bundle_qty is the PARENT's quantity and each component is stored per bundle,
// which is how the rest of the app already reads a line. That makes both shapes
// in a real sheet come out right: a chassis (parent 1, children 1/2/4/20) keeps
// its quantities, and 6 identical switches (parent 6, children 6) collapse to
// "6 bundles of 1" instead of 36 units.
function impBuildLines(rows) {
  const order = [];
  const byTop = {};
  rows.forEach(r => {
    if (!byTop[r.top]) { byTop[r.top] = { top: r.top, parent: null, children: [] }; order.push(r.top); }
    if (r.isChild) byTop[r.top].children.push(r); else if (!byTop[r.top].parent) byTop[r.top].parent = r;
    else byTop[r.top].children.push(r);
  });
  return order.map(top => {
    const g = byTop[top];
    const parent = g.parent || g.children[0];
    const rest = g.parent ? g.children : g.children.slice(1);
    const bundleQty = Math.max(1, Math.round(parent.qty || 1));
    const per = (q) => {
      const v = (Number(q) || 0) / bundleQty;
      return Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Number(v.toFixed(4));
    };
    const members = [{ row: parent, qty: g.parent ? 1 : per(parent.qty) },
                     ...rest.map(r => ({ row: r, qty: per(r.qty) }))];
    return {
      top, parent, rows: [parent, ...rest], members,
      bundleQty,
      equip: parent.equip || parent.desc || ('Item ' + top),
      group: parent.group || '',
      posr: parent.posr || '',
      unitPrice: members.reduce((a, m) => a + (Number(m.row.rate) || 0) * (Number(m.qty) || 0), 0),
    };
  });
}

window.impParseMatrix = impParseMatrix;
window.impBuildLines = impBuildLines;
window.impSrParent = impSrParent;
window.impNum = impNum;

// ===========================================================================
// The modal
// ===========================================================================
function SheetImportModal({ onClose, onCreated }) {
  const { state, mutate, navigate, getUser, currentUser } = useStore();
  const toast = useToast();
  const [rows, setRows] = React.useState(null);
  const [custId, setCustId] = React.useState('');
  const [newCust, setNewCust] = React.useState('');     // when adding one inline
  const [fileName, setFileName] = React.useState('');
  const [matrix, setMatrix] = React.useState(null);     // kept so we can re-match
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [note, setNote] = React.useState('');
  const customers = state.customers || [];
  const addingCustomer = custId === '__new';
  // A brand-new organization has no customers at all. Requiring one before the
  // file could even be chosen made the screen a dead end — nothing in the list,
  // and the file input disabled forever.
  const custReady = addingCustomer ? !!newCust.trim() : !!custId;

  const ensureXLSX = () => new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('reader did not load')));
    s.onerror = () => reject(new Error('Could not load the spreadsheet reader (no internet?)'));
    document.head.appendChild(s);
  });

  // Split a CSV line honouring quotes — descriptions contain commas.
  const csvLine = (line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };

  // Matching a 500-line BOQ used to be 500 sequential round trips — one per row,
  // each awaited — which over a tunnel is minutes of staring at a spinner for
  // work the database does in milliseconds.
  //
  // Two changes, no loss of accuracy: identical rows are collapsed to one lookup
  // (a real sheet repeats C9600-SSD-NONE and the like), what is already in the
  // local catalogue is settled without any call, and everything left over goes
  // in ONE batch call that applies exactly the same ranking server-side.
  const resolveRows = async (parsed) => {
    const byKey = new Map();
    parsed.forEach(row => {
      const key = (row.code || '').toLowerCase() + '|' + (row.desc || '').toLowerCase();
      row.__key = key;
      if (!byKey.has(key)) byKey.set(key, { code: row.code, desc: row.desc, hit: null });
    });

    // Free matches first — an index over our own catalogue, built once.
    const byCode = new Map(), byName = new Map();
    (state.products || []).forEach(p => {
      if (p.code) byCode.set(String(p.code).toLowerCase(), p.id);
      if (p.name) byName.set(String(p.name).toLowerCase(), p.id);
    });
    const unresolved = [];
    byKey.forEach((v, key) => {
      const c = (v.code || '').toLowerCase(), n = (v.desc || '').toLowerCase();
      if (c && byCode.has(c)) v.hit = { product_id: byCode.get(c), matched_by: 'our_code' };
      else if (n && byName.has(n)) v.hit = { product_id: byName.get(n), matched_by: 'our_name' };
      else unresolved.push({ k: key, code: v.code || null, name: v.desc || null });
    });

    if (unresolved.length && window.OPC_SB) {
      try {
        const r = await window.OPC_SB.rpc('opc_alias_resolve_bulk', {
          p_scope: 'customer',
          p_party_id: (custId && custId !== '__new') ? custId : null,
          p_rows: unresolved,
        });
        const map = (!r.error && r.data && typeof r.data === 'object') ? r.data : {};
        Object.keys(map).forEach(k => {
          const v = byKey.get(k);
          if (v && map[k] && map[k].product_id) {
            v.hit = { product_id: map[k].product_id, matched_by: map[k].matched_by };
          }
        });
      } catch (e) { /* unmatched rows simply show as new items */ }
    }

    parsed.forEach(row => {
      const v = byKey.get(row.__key);
      row.product_id = v && v.hit ? v.hit.product_id : null;
      row.matched_by = v && v.hit ? v.hit.matched_by : null;
      row.action = row.product_id ? 'match' : (row.code || row.desc ? 'create' : 'skip');
    });
    return parsed;
  };

  const onFile = async (file) => {
    if (!file) return;
    setErr(''); setNote(''); setFileName(file.name); setBusy('read');
    try {
      let matrix;
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text();
        matrix = text.split(/\r?\n/).filter(l => l.length).map(csvLine);
      } else {
        const XLSX = await ensureXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // defval keeps merged/blank cells as '' so column positions never shift.
        matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      }
      setMatrix(matrix);
      const res = impParseMatrix(matrix);
      if (res.error) { setErr(res.error); setRows(null); setBusy(''); return; }
      if (!res.rows.length) { setErr('No item rows found below the header.'); setRows(null); setBusy(''); return; }
      setBusy('match');
      const resolved = await resolveRows(res.rows);
      setRows(resolved);
      const cols = Object.keys(res.columns).filter(k => res.columns[k] !== -1);
      setNote(`Read ${resolved.length} item row(s) · columns found: ${cols.join(', ')}`);
    } catch (e) {
      setErr('Could not read that file: ' + String((e && e.message) || e));
      setRows(null);
    }
    setBusy('');
  };

  // Picking (or changing) the customer after the file is loaded re-runs the
  // match, because their own part numbers are the strongest signal we have.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!matrix || custId === '__new') return;
    let dead = false;
    (async () => {
      setBusy('match');
      const res = impParseMatrix(matrix);
      if (res.error || !res.rows.length) { setBusy(''); return; }
      const resolved = await resolveRows(res.rows);
      if (dead) return;
      setRows(resolved);
      setBusy('');
    })();
    return () => { dead = true; };
  }, [custId]);

  const setRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));

  const lines = React.useMemo(() => rows ? impBuildLines(rows.filter(r => r.action !== 'skip')) : [], [rows]);
  const counts = React.useMemo(() => {
    const c = { match: 0, create: 0, skip: 0 };
    (rows || []).forEach(r => { c[r.action] = (c[r.action] || 0) + 1; });
    return c;
  }, [rows]);

  // -------------------------------------------------------------------------
  const doImport = async () => {
    if (!custReady) { setErr('Choose the customer this sheet came from, or type a new one.'); return; }
    if (!lines.length) { setErr('Nothing to import.'); return; }
    setErr(''); setBusy('import');
    try {
      const sb = window.OPC_SB;
      const stamp = Date.now();

      // 0. The customer, if this is the first order for them.
      let customerId = custId;
      let madeCustomer = null;
      if (addingCustomer) {
        const name = newCust.trim();
        const dup = customers.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
        if (dup) customerId = dup.id;
        else {
          customerId = 'cust-' + stamp;
          madeCustomer = { id: customerId, code: '', name, gstin: '', state: '', address: '',
                           contact: '', phone: '', terms: 'Net 30', credit_limit: 0, tier: 'Standard' };
          if (sb) {
            const { error } = await sb.from('customers').insert(madeCustomer);
            if (error) throw new Error('Could not save the customer: ' + error.message);
          }
        }
      }

      // 1. Items we do not have yet, created from the sheet itself. The Part No.
      //    becomes our code, so the catalogue is built from the first real order
      //    instead of being typed in up front.
      const toCreate = rows.filter(r => r.action === 'create' && (r.code || r.desc));
      const madeProducts = [];
      const idFor = {};
      toCreate.forEach((r, i) => {
        const key = (r.code || r.desc).toLowerCase();
        if (idFor[key]) return;
        const pid = 'p-imp-' + stamp + '-' + i;
        idFor[key] = pid;
        madeProducts.push({
          id: pid,
          code: r.code || ('IMP-' + (i + 1)),
          name: r.desc || r.code,
          hsn: '', uom: r.unit || 'Nos.',
          gst: Number(r.tax) || 18, sell: Number(r.rate) || 0, buy: 0,
        });
      });
      rows.forEach(r => {
        if (r.action !== 'create') return;
        const key = (r.code || r.desc || '').toLowerCase();
        if (idFor[key]) r.product_id = idFor[key];
      });
      if (madeProducts.length && sb) {
        const { error } = await sb.from('products').insert(madeProducts);
        if (error) throw new Error('Could not save the new items: ' + error.message);
      }

      // 2. One category per "Type of Equipements", reused if it already exists,
      //    so the bundle is a real record and not a free-text label.
      const madeCategories = [];
      const madeBoms = {};
      const catFor = {};
      lines.forEach((ln, i) => {
        const label = ln.equip;
        const existing = (state.categories || []).find(c => c.name && c.name.toLowerCase() === label.toLowerCase());
        if (existing) { catFor[ln.top] = existing.id; return; }
        if (catFor[label]) { catFor[ln.top] = catFor[label]; return; }
        const cid = 'cat-imp-' + stamp + '-' + i;
        catFor[label] = cid; catFor[ln.top] = cid;
        madeCategories.push({ id: cid, name: label, hsn: '', gst: Number(ln.parent.tax) || 18, bundle_desc: ln.group || label });
      });
      if (madeCategories.length && sb) {
        const { error } = await sb.from('categories').insert(madeCategories);
        if (error) throw new Error('Could not save the equipment types: ' + error.message);
      }

      // 3. The order itself: one line per top-level Sr. No., its sub-rows as
      //    components — the sheet's own structure, preserved.
      const soId = 'so-' + stamp;
      const seq = 1 + (state.sales_orders || []).length;
      const soLines = lines.map((ln, i) => {
        const comps = ln.members
          .filter(m => m.row.product_id && m.qty > 0)
          .map(m => ({
            product_id: m.row.product_id,
            qty: m.qty,
            override: false,
            original_qty: m.qty,
            customer_ref: { sr: m.row.sr, code: m.row.code, desc: m.row.desc, unit: m.row.unit },
          }));
        return {
          id: 'l' + stamp + '-' + i,
          category_id: catFor[ln.top] || '',
          client_name: ln.equip,
          bundle_qty: ln.bundleQty,
          unit_price: Math.round(ln.unitPrice),
          components: comps,
          customer_ref: {
            sr: ln.parent.sr, code: ln.parent.code, desc: ln.parent.desc,
            unit: ln.parent.unit, group: ln.group, equip: ln.equip, po_sr: ln.posr,
          },
        };
      }).filter(l => l.components.length);

      if (!soLines.length) throw new Error('Every row was skipped — nothing to create.');

      // Reusable bill of materials for each equipment type we just created.
      madeCategories.forEach(c => {
        const ln = lines.find(l => catFor[l.top] === c.id);
        if (!ln) return;
        const comps = ln.members.filter(m => m.row.product_id && m.qty > 0)
          .map(m => ({ product_id: m.row.product_id, qty: m.qty }));
        if (comps.length) madeBoms[c.id] = comps;
      });
      if (Object.keys(madeBoms).length && sb) {
        const payload = Object.keys(madeBoms).map(cid => ({ category_id: cid, components: madeBoms[cid] }));
        const { error } = await sb.from('boms').insert(payload);
        if (error) console.warn('[OPC] BOM save skipped:', error.message);
      }

      const so = {
        id: soId,
        so_no: `SO/FY26/${String(seq).padStart(4, '0')}`,
        customer_id: customerId,
        date: TODAY,
        expected: TODAY,
        status: 'Draft',
        priority: 'Standard',
        order_type: 'Supply',
        po_ref: '',
        lines: soLines,
        created_by: currentUser,
        imported_from: fileName,
        extra: { imported: { file: fileName, at: new Date().toISOString(), rows: rows.length } },
      };

      const totalUnits = soLines.reduce((a, l) =>
        a + l.components.reduce((b, c) => b + (Number(c.qty) || 0) * (Number(l.bundle_qty) || 1), 0), 0);

      mutate(s => ({
        ...s,
        customers: madeCustomer ? [...s.customers, madeCustomer] : s.customers,
        products: madeProducts.length ? [...s.products, ...madeProducts] : s.products,
        categories: madeCategories.length ? [...s.categories, ...madeCategories] : s.categories,
        boms: Object.keys(madeBoms).length ? { ...s.boms, ...madeBoms } : s.boms,
        sales_orders: [so, ...s.sales_orders],
        notifications: [{
          id: 'n-imp-' + stamp, kind: 'so',
          text: `${so.so_no} imported from ${fileName} · ${soLines.length} line(s) · ${totalUnits} unit(s)`,
          date: TODAY, read: false, role: 'Purchase',
        }, ...s.notifications],
      }), {
        action: 'so-import', entity: 'SalesOrder', entity_id: soId, user_id: currentUser,
        detail: `Imported ${fileName} → ${so.so_no} · ${soLines.length} line(s), ${totalUnits} unit(s), ` +
                `${madeProducts.length} new item(s), ${madeCategories.length} new equipment type(s)`,
      });

      // 4. Remember this customer's wording so the next sheet matches itself.
      //    Best-effort: a failure here must not undo an order that already exists.
      if (sb) {
        const learn = rows
          .filter(r => r.product_id && r.code && r.action !== 'skip')
          .map(r => ({ product_id: r.product_id, code: r.code, name: r.desc || null, uom: r.unit || null }));
        if (learn.length) {
          try {
            await sb.rpc('opc_alias_set_bulk', {
              p_scope: 'customer', p_party_id: customerId, p_rows: learn });
          } catch (e) { /* the order exists; mapping can be finished on Item Mapping */ }
        }
        if (window.invalidateAliasMap) window.invalidateAliasMap('customer', customerId);
      }

      setBusy('');
      toast(`${so.so_no} created from ${fileName} · ${soLines.length} line(s)` +
            (madeProducts.length ? ` · ${madeProducts.length} new item(s) added` : ''), 'success');
      if (onCreated) onCreated(so);
      onClose();
      navigate(`sales-orders/${soId}`);
    } catch (e) {
      setBusy('');
      setErr(String((e && e.message) || e));
    }
  };

  // -------------------------------------------------------------------------
  const products = state.products || [];
  const statusChip = (r) => {
    if (r.action === 'skip') return <span className="badge tiny">skipped</span>;
    if (r.action === 'create') return <span className="badge warning tiny" title="Not in our catalogue yet — it will be added">new item</span>;
    const how = { alias_code: "customer's part no.", alias_name: "customer's description",
                  our_code: 'our code', our_name: 'our name' }[r.matched_by] || 'matched';
    return <span className="badge success tiny" title={`Matched on ${how}`}>matched</span>;
  };

  return (
    <Modal title="Import customer sheet" size="xl" onClose={onClose} footer={
      <>
        <span className="tiny muted" style={{ marginRight: 'auto' }}>
          {rows ? `${lines.length} order line(s) · ${counts.match} matched · ${counts.create} new · ${counts.skip} skipped` : ''}
        </span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!rows || !!busy || !custReady || !lines.length} onClick={doImport}>
          <Icon name="check" size={13}/>{busy === 'import' ? 'Creating…' : 'Create Sales Order'}
        </button>
      </>
    }>
      {err && <div className="mb-2" style={{ padding: '8px 10px', background: 'var(--danger-bg)', borderRadius: 6, fontSize: 12.5 }}>
        <Icon name="alert" size={13} color="var(--danger)"/> {err}
      </div>}

      <div className="field-row">
        <div className="field">
          <label className="field-label">Customer <span className="tiny muted">(whose sheet is this?)</span></label>
          <select className="select" value={custId} onChange={e => setCustId(e.target.value)}>
            <option value="">— choose —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new">+ Add a new customer…</option>
          </select>
          {addingCustomer ? (
            <input className="input mt-1" autoFocus placeholder="Customer name"
              value={newCust} onChange={e => setNewCust(e.target.value)}/>
          ) : (
            <div className="tiny muted mt-1">
              {customers.length === 0
                ? 'No customers yet — choose “Add a new customer”.'
                : 'Their part numbers are remembered against this customer.'}
            </div>
          )}
        </div>
        <div className="field">
          <label className="field-label">Working sheet <span className="tiny muted">(.xlsx / .xls / .csv)</span></label>
          <input className="input" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            onChange={e => onFile(e.target.files && e.target.files[0])}/>
          <div className="tiny muted mt-1">
            {busy === 'read' ? 'Reading…' : busy === 'match' ? 'Matching against our catalogue…'
              : fileName ? fileName
              : 'Reads the first sheet. You can pick the file before the customer.'}
          </div>
        </div>
      </div>

      {note && <div className="tiny muted mb-2">{note}</div>}

      {!rows ? (
        <div className="card mt-2"><div className="card-body small muted" style={{ lineHeight: 1.7 }}>
          <strong>What happens:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li><strong>Sr. No. builds the structure.</strong> <span className="mono">1</span> becomes an order line; <span className="mono">1.1</span>, <span className="mono">1.0.1</span> … become the items inside it.</li>
            <li><strong>Group banners and Total rows are ignored</strong>, and merged cells such as Type of Equipements and Po SR No are carried down.</li>
            <li><strong>Each Part No. is matched to our catalogue</strong> — by this customer's own wording first, then our code, then our name.</li>
            <li><strong>Anything new is listed for you to confirm</strong> before it is added, never guessed at silently.</li>
            <li><strong>The order opens as a Draft</strong> so quantities and prices can still be edited.</li>
          </ul>
        </div></div>
      ) : (
        <div className="card mt-2">
          <div className="card-header">
            <h3 className="card-title">Preview — {lines.length} order line(s)</h3>
            <span className="tiny muted">Sub-rows become the bill of materials of the line above them</span>
          </div>
          <div className="card-body flush" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="t">
              <thead><tr>
                <th style={{ width: 70 }}>Sr.</th>
                <th>Part no. / description</th>
                <th className="num" style={{ width: 60 }}>Qty</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 240 }}>Our item</th>
              </tr></thead>
              <tbody>
                {lines.map(ln => (
                  <React.Fragment key={ln.top}>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      <td colSpan="5" className="small" style={{ fontWeight: 600 }}>
                        {ln.equip}
                        <span className="tiny muted" style={{ fontWeight: 400 }}>
                          {' · '}{ln.bundleQty > 1 ? `${ln.bundleQty} sets` : '1 set'}
                          {' · '}{ln.members.length} item(s)
                          {ln.posr ? ` · PO Sr ${ln.posr}` : ''}
                          {ln.group ? ` · ${ln.group}` : ''}
                        </span>
                      </td>
                    </tr>
                    {ln.members.map(m => {
                      const r = m.row;
                      return (
                        <tr key={r.key} style={r.action === 'skip' ? { opacity: 0.45 } : null}>
                          <td className="mono tiny" style={{ paddingLeft: r.isChild ? 24 : 10 }}>{r.sr || '—'}</td>
                          <td>
                            <div className="mono small">{r.code || '—'}</div>
                            <div className="tiny muted trunc" style={{ maxWidth: 380 }}>{r.desc}</div>
                          </td>
                          <td className="num mono small">{r.qty}{ln.bundleQty > 1 && m.qty !== r.qty ? <div className="tiny muted">{m.qty}/set</div> : null}</td>
                          <td>{statusChip(r)}</td>
                          <td>
                            <select className="select" style={{ height: 26, fontSize: 11.5, width: '100%' }}
                              value={r.action === 'skip' ? '__skip' : (r.action === 'create' ? '__new' : (r.product_id || '__new'))}
                              onChange={e => {
                                const v = e.target.value;
                                if (v === '__skip') setRow(r.key, { action: 'skip' });
                                else if (v === '__new') setRow(r.key, { action: 'create', product_id: null, matched_by: null });
                                else setRow(r.key, { action: 'match', product_id: v, matched_by: 'manual' });
                              }}>
                              <option value="__new">➕ Add as a new item</option>
                              <option value="__skip">✕ Skip this row</option>
                              {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Purchase turn the customer's sheet into our order; Org Admin can too.
function canImportSheet(role) {
  return ['Purchase', 'Org Admin'].indexOf(role) !== -1;
}

window.SheetImportModal = SheetImportModal;
window.canImportSheet = canImportSheet;
