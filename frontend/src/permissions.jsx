// OP Central — Permissions matrix + tasks engine
// Defines what each role can see and do, and converts state into role-specific tasks.

const PERMISSIONS = {
  'Org Admin': {
    nav: ['dashboard','inbox','sourcing','sales-orders','customers','godown','pool','transfers','rfq','vendor-pos','grn','three-way','vendors','invoices','collections','products','settings','audit','onboarding'],
    primary: { route: 'dashboard', label: 'Dashboard' },
    can: { all: true },
  },
  'Sales': {
    nav: ['dashboard','inbox','sourcing','sales-orders','customers','products'],
    primary: { route: 'sourcing', label: 'Sourcing / Inquiries', icon: 'bookmark' },
    can: {
      createSO: true,
      createSourcing: true,
      editOwnDraft: true,
      viewProducts: true,
      viewCustomers: true,
    },
  },
  'Pre-sales': {
    nav: ['dashboard','inbox','sourcing','sales-orders','customers','products'],
    primary: { route: 'sourcing', label: 'Sourcing / Inquiries' },
    can: { createSourcing: true, viewProducts: true, viewCustomers: true },
  },
  'Project Manager': {
    nav: ['dashboard','inbox','sourcing','sales-orders','customers','godown','pool','transfers','rfq','vendor-pos','grn','invoices'],
    primary: { route: 'inbox', label: 'My Approvals', icon: 'bell' },
    can: {
      approveSO: true, editSO: true, viewCost: true,
      authDispatch: true, initiateTransfer: true,
      viewProducts: true, viewCustomers: true,
    },
  },
  'Purchase': {
    nav: ['dashboard','inbox','sourcing','sales-orders','godown','transfers','rfq','vendor-pos','grn','vendors','pool','products'],
    primary: { route: 'sourcing', label: 'Sourcing', icon: 'bookmark' },
    can: {
      createRFQ: true, selectVendor: true, createVendorPO: true, doSourcing: true,
      viewVendors: true, viewCost: true, viewProducts: true,
    },
  },
  'Stores': {
    nav: ['dashboard','inbox','vendor-pos','grn','godown','pool','products'],
    primary: { route: 'grn', label: 'GRN', icon: 'package' },
    can: { createGRN: true, reconcileSurplus: true, viewProducts: true },
  },
  'Billing': {
    nav: ['dashboard','inbox','sales-orders','three-way','invoices','vendor-pos'],
    primary: { route: 'three-way', label: '3-Way Match', icon: 'check' },
    can: {
      do3way: true, raiseInvoice: true, generateEWB: true,
      viewCost: true,
    },
  },
  'Managing Director': {
    nav: ['dashboard','inbox','sourcing','sales-orders','rfq','vendor-pos','godown','pool','transfers','invoices','collections','audit'],
    primary: { route: 'inbox', label: 'Approvals queue', icon: 'bell' },
    can: { approveAll: true, viewCost: true, viewMD: true },
  },
  'Collections': {
    nav: ['dashboard','inbox','collections','customers','invoices'],
    primary: { route: 'collections', label: 'Collections', icon: 'cash' },
    can: { logFollowup: true, viewCustomers: true },
  },
};

// Resolve a role's permissions. DB-backed config (window.__opcPerms, loaded from
// Supabase by the store) takes precedence when present so admins can customize
// roles; the built-in PERMISSIONS constant is the exact fallback, so default
// behavior is unchanged until an admin actually edits a role.
function perm(role) {
  const overrides = (typeof window !== 'undefined' && window.__opcPerms) || null;
  if (overrides && overrides[role]) return overrides[role];
  return PERMISSIONS[role] || PERMISSIONS['Org Admin'];
}
function canDo(role, capability) {
  const p = perm(role).can || {};
  return !!(p.all || p[capability]);
}
function canAccess(role, route) {
  // Strip subpaths
  const root = route.split('/')[0];
  const allowed = perm(role).nav;
  // Allow detail routes of any allowed parent
  return allowed.includes(root) || allowed.includes(route);
}

// ===== Tasks engine =====
// Convert state into a list of role-targeted tasks. The inbox uses this.
// Each task: { id, role, kind, ref, refId, by, byUser, amount, detail, gate, action(), reject(), info() }
function buildTasks(state, mutate, navigate, toast) {
  const tasks = [];

  // 1. SOs in Pending Approval → PM
  state.sales_orders.filter(s => s.status === 'Pending Approval').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const value = so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
    const by = state.users.find(u => u.role === 'Sales');
    tasks.push({
      id: `task-so-approve-${so.id}`,
      role: 'Project Manager',
      kind: 'Sales Order',
      ref: so.so_no,
      refId: so.id,
      by: by?.name || 'Sales',
      amount: value,
      detail: `${cust?.name} · PO ${so.customer_po} · ${so.lines.length} bundle(s)`,
      gate: 'PM approval',
      icon: 'receipt',
      navigateTo: `sales-orders/${so.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Approved' } : x),
          notifications: [
            { id: 'n-app-' + Date.now(), kind: 'so', text: `${so.so_no} approved · ready for procurement`, date: window.TODAY, read: false, role: 'Purchase' },
            ...s.notifications,
          ],
        }));
        toast(`${so.so_no} approved · sent to Purchase`, 'success');
      },
      reject: () => {
        mutate(s => ({ ...s, sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Draft' } : x) }));
        toast(`${so.so_no} sent back to Sales`);
      },
    });
  });

  // 2. Approved SOs → Purchase needs to float RFQ
  state.sales_orders.filter(s => s.status === 'Approved').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const value = so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
    tasks.push({
      id: `task-rfq-${so.id}`,
      role: 'Purchase',
      kind: 'RFQ to Float',
      ref: so.so_no,
      refId: so.id,
      by: state.users.find(u => u.role === 'Project Manager')?.name || 'PM',
      amount: value,
      detail: `${cust?.name} · approved · awaiting RFQ to vendors`,
      gate: 'Purchase action',
      icon: 'cart',
      navigateTo: `sales-orders/${so.id}`,
      approve: () => {
        // mark as Procurement Started
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Procurement Started' } : x),
        }));
        toast(`Procurement started for ${so.so_no}`, 'success');
        navigate('rfq');
      },
      approveLabel: 'Float RFQ',
    });
  });

  // 2b. Sourcing inquiries sent to Purchase → Purchase to compare vendors
  (state.sourcings || []).filter(x => x.status === 'Sent to Purchase').forEach(src => {
    const cust = state.customers.find(c => c.id === src.customer_id);
    const value = (src.lines || []).reduce((sum, l) => sum + (l.bundle_qty || 0) * (l.unit_price || 0), 0);
    tasks.push({
      id: `task-src-${src.id}`,
      role: 'Purchase',
      kind: 'Vendor Sourcing',
      ref: src.src_no,
      refId: src.id,
      by: state.users.find(u => u.role === 'Sales')?.name || 'Sales',
      amount: value,
      detail: `${cust?.name || ''} · compare vendors per item & return the margin`,
      gate: 'Purchase action',
      icon: 'bookmark',
      navigateTo: `sourcing/${src.id}`,
      approve: () => navigate(`sourcing/${src.id}`),
      approveLabel: 'Open sourcing',
    });
  });

  // 2c. Sourcing costed & sent back → Sales to raise the SO
  (state.sourcings || []).filter(x => x.status === 'Sent to Sales').forEach(src => {
    const cust = state.customers.find(c => c.id === src.customer_id);
    const m = src.margin || {};
    tasks.push({
      id: `task-src-sales-${src.id}`,
      role: 'Sales',
      kind: 'Raise SO from inquiry',
      ref: src.src_no,
      refId: src.id,
      by: state.users.find(u => u.role === 'Purchase')?.name || 'Purchase',
      amount: m.sell || 0,
      detail: `${cust?.name || ''} · vendor quotation ready · margin ${m.marginPct !== undefined ? (m.marginPct >= 0 ? '+' : '') + m.marginPct.toFixed(1) + '%' : '—'}`,
      gate: 'Sales action',
      icon: 'receipt',
      navigateTo: `sourcing/${src.id}`,
      approve: () => navigate(`sourcing/${src.id}`),
      approveLabel: 'Review & raise SO',
    });
  });

  // 3. RFQ with selected vendor → MD approval (above threshold)
  state.rfqs.filter(r => r.selected_vendor && r.status === 'Responses In').forEach(rfq => {
    const selected = rfq.quotes.find(q => q.vendor_id === rfq.selected_vendor);
    if (!selected) return;
    const vendor = state.vendors.find(v => v.id === rfq.selected_vendor);
    const mdThreshold = (state.config && state.config.vendor_po_md_threshold != null) ? state.config.vendor_po_md_threshold : 500000;
    const lppThreshold = (state.config && state.config.lpp_threshold != null) ? state.config.lpp_threshold : 10;
    const lppOver = Math.abs(Number(selected.lpp_variance) || 0) > lppThreshold;
    const needsMD = selected.total > mdThreshold;
    if (needsMD) {
      tasks.push({
        id: `task-rfq-md-${rfq.id}`,
        role: 'Managing Director',
        kind: 'Vendor Selection',
        ref: rfq.rfq_no,
        refId: rfq.id,
        by: state.users.find(u => u.role === 'Purchase')?.name || 'Purchase',
        amount: selected.total,
        detail: `${vendor?.name} selected · ${rfq.items_label} · LPP ${selected.lpp_variance > 0 ? '+' : ''}${selected.lpp_variance}%${lppOver ? ` ⚠ over ${lppThreshold}% LPP limit` : ''}`,
        gate: `> ${window.inrK ? window.inrK(mdThreshold) : '₹5L'} · MD approval`,
        icon: 'cart',
        navigateTo: 'rfq',
        approve: () => {
          mutate(s => ({
            ...s,
            rfqs: s.rfqs.map(r => r.id === rfq.id ? { ...r, status: 'Vendor Approved' } : r),
            notifications: [
              { id: 'n-rfq-' + Date.now(), kind: 'po', text: `${rfq.rfq_no} approved · draft Vendor PO`, date: window.TODAY, read: false, role: 'Purchase' },
              ...s.notifications,
            ],
          }));
          toast(`Vendor approved · Purchase can issue PO`, 'success');
        },
      });
    }
  });

  // 3b. Vendor POs over the threshold → MD approval
  (state.vendor_pos || []).filter(p => p.status === 'Pending MD Approval').forEach(po => {
    const vendor = state.vendors.find(v => v.id === po.vendor_id);
    const so = state.sales_orders.find(s => s.id === po.so_id);
    tasks.push({
      id: `task-po-md-${po.id}`,
      role: 'Managing Director',
      kind: 'Vendor PO Approval',
      ref: po.po_no,
      refId: po.id,
      by: state.users.find(u => u.role === 'Purchase')?.name || 'Purchase',
      amount: po.pending_change ? po.pending_change.amount : po.amount,
      detail: po.pending_change ? `Vendor change → ${state.vendors.find(v => v.id === po.pending_change.vendor_id)?.name || ''} · ${so?.so_no || ''} · cheaper by ${window.inrK ? window.inrK(po.pending_change.old_amount - po.pending_change.amount) : ''}` : `${vendor?.name || ''} · ${so?.so_no || ''} · over approval threshold`,
      gate: po.pending_change ? 'Vendor change · MD approval' : '> ₹5L · MD approval',
      icon: 'cart',
      navigateTo: `vendor-pos/${po.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          vendor_pos: s.vendor_pos.map(x => x.id === po.id ? (window.applyPOReview ? window.applyPOReview(x, true) : { ...x, status: 'Issued' }) : x),
          notifications: [{ id: 'n-pomd-' + Date.now(), kind: 'po', text: `${po.po_no} ${po.pending_change ? 'vendor change approved' : 'approved'} by MD · ready to receive`, date: window.TODAY, read: false, role: 'Purchase' }, ...s.notifications],
        }));
        toast(`${po.po_no} approved`, 'success');
      },
      reject: () => {
        mutate(s => ({ ...s, vendor_pos: s.vendor_pos.map(x => x.id === po.id ? (window.applyPOReview ? window.applyPOReview(x, false) : { ...x, status: 'Rejected' }) : x) }));
        toast(`${po.po_no} ${po.pending_change ? 'change declined' : 'rejected'}`);
      },
    });
  });

  // 4. Cross-SO Transfer Requests → source SO's PM
  state.transfer_requests.filter(t => t.status === 'Pending').forEach(tr => {
    const fromSO = state.sales_orders.find(s => s.id === tr.from_so);
    const toSO = state.sales_orders.find(s => s.id === tr.to_so);
    const by = state.users.find(u => u.id === tr.requested_by);
    tasks.push({
      id: `task-transfer-${tr.id}`,
      role: 'Project Manager',
      kind: 'Cross-SO Transfer',
      ref: tr.id,
      refId: tr.id,
      by: by?.name || 'PM',
      amount: 0,
      detail: `${fromSO?.so_no} → ${toSO?.so_no} · ${tr.items.length} item(s) · ${tr.reason}`,
      gate: 'Source PM approval · backend only',
      icon: 'arrowLeftRight',
      navigateTo: 'transfers',
      approve: () => {
        mutate(s => ({
          ...s,
          transfer_requests: s.transfer_requests.map(x => x.id === tr.id ? { ...x, status: 'Approved' } : x),
          notifications: [
            { id: 'n-tr-' + Date.now(), kind: 'transfer', text: `Transfer approved · ${fromSO?.so_no} → ${toSO?.so_no}`, date: window.TODAY, read: false, role: 'Project Manager' },
            ...s.notifications,
          ],
        }));
        toast('Transfer approved · items re-allocated', 'success');
      },
      reject: () => {
        mutate(s => ({ ...s, transfer_requests: s.transfer_requests.map(x => x.id === tr.id ? { ...x, status: 'Rejected' } : x) }));
        toast('Transfer rejected');
      },
    });
  });

  // 5. 3-Way match exceptions → Billing
  state.vendor_invoices.filter(vi => vi.status === 'Pending 3-Way Match').forEach(vi => {
    const vendor = state.vendors.find(v => v.id === vi.vendor_id);
    tasks.push({
      id: `task-3way-${vi.id}`,
      role: 'Billing',
      kind: '3-Way Match',
      ref: vi.vendor_invoice_no,
      refId: vi.id,
      by: vendor?.name || 'Vendor',
      amount: vi.amount,
      detail: vi.tolerance === 'within' ? `Within ±2% tolerance · ready to book` : `Outside ±2% tolerance · PM review recommended`,
      gate: vi.tolerance === 'within' ? 'Auto-book ready' : 'Exception · review',
      icon: 'check',
      navigateTo: `three-way/${vi.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          vendor_invoices: s.vendor_invoices.map(x => x.id === vi.id ? { ...x, status: 'Booked' } : x),
        }));
        toast('Invoice booked · payment scheduled', 'success');
      },
    });
  });

  // 6. SOs ready to dispatch → Billing to raise invoice
  state.sales_orders.filter(s => s.status === 'Ready to Dispatch').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const billedSub = so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0) - (so.bill_adjustments || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const value = Math.max(0, billedSub) * 1.18;
    tasks.push({
      id: `task-inv-${so.id}`,
      role: 'Billing',
      kind: 'Raise Invoice',
      ref: so.so_no,
      refId: so.id,
      by: state.users.find(u => u.role === 'Project Manager')?.name || 'PM',
      amount: value,
      detail: `${cust?.name} · dispatch authorised · raise tax invoice + e-Way Bill`,
      gate: 'Billing action',
      icon: 'receipt',
      navigateTo: `sales-orders/${so.id}`,
      approve: () => {
        const invNo = `INV/FY26/${String(73 + Math.floor(Math.random() * 20)).padStart(4, '0')}`;
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? {
            ...x, status: 'Invoiced',
            invoice_no: invNo, invoice_date: window.TODAY,
            invoice_amount: value,
          } : x),
          notifications: [
            { id: 'n-inv-' + Date.now(), kind: 'invoice', text: `${invNo} raised · awaiting payment`, date: window.TODAY, read: false, role: 'Collections' },
            ...s.notifications,
          ],
        }));
        toast(`${invNo} generated · sent to customer`, 'success');
        navigate(`invoices/${so.id}`);
      },
      approveLabel: 'Raise invoice',
    });
  });

  // 6. SOs in Procurement Started → Purchase task: confirm material received
  state.sales_orders.filter(s => s.status === 'Procurement Started').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const value = so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
    tasks.push({
      id: `task-recv-${so.id}`,
      role: 'Purchase',
      kind: 'Material Receipt',
      ref: so.so_no,
      refId: so.id,
      by: state.users.find(u => u.role === 'Stores')?.name || 'Stores',
      amount: value,
      detail: `${cust?.name} · vendor POs issued · material arriving · confirm receipt`,
      gate: 'Purchase action',
      icon: 'package',
      navigateTo: `sales-orders/${so.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Material Received' } : x),
          notifications: [
            { id: 'n-recv-' + Date.now(), kind: 'so', text: `${so.so_no} material received · PM to authorize dispatch`, date: window.TODAY, read: false, role: 'Project Manager' },
            ...s.notifications,
          ],
        }));
        toast(`Material received for ${so.so_no} · PM notified`, 'success');
      },
      approveLabel: 'Mark Received',
    });
  });

  // 7. SOs in Material Received → PM task: authorize dispatch
  state.sales_orders.filter(s => s.status === 'Material Received').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const value = so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0);
    tasks.push({
      id: `task-dispatch-${so.id}`,
      role: 'Project Manager',
      kind: 'Dispatch Authorization',
      ref: so.so_no,
      refId: so.id,
      by: state.users.find(u => u.role === 'Purchase')?.name || 'Purchase',
      amount: value,
      detail: `${cust?.name} · all items received · authorize dispatch`,
      gate: 'PM authorization',
      icon: 'truck',
      navigateTo: `sales-orders/${so.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Ready to Dispatch' } : x),
          notifications: [
            { id: 'n-disp-' + Date.now(), kind: 'so', text: `${so.so_no} ready to dispatch · raise invoice`, date: window.TODAY, read: false, role: 'Billing' },
            ...s.notifications,
          ],
        }));
        toast(`Dispatch authorized for ${so.so_no} · Billing notified`, 'success');
      },
      approveLabel: 'Authorize Dispatch',
    });
  });

  // 8. Invoiced (not yet paid, not overdue) → Collections task: track payment
  state.sales_orders.filter(s => (s.status === 'Invoiced' || s.status === 'Payment Pending') && !(s.days_overdue > 0)).forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    const isOverdue = so.days_overdue > 0;
    tasks.push({
      id: `task-pay-${so.id}`,
      role: 'Collections',
      kind: 'Payment Tracking',
      ref: so.invoice_no || so.so_no,
      refId: so.id,
      by: 'Billing',
      amount: so.invoice_amount || (so.lines.reduce((sum, l) => sum + l.bundle_qty * l.unit_price, 0) * 1.18),
      detail: `${cust?.name} · ${so.so_no} · ${so.payment_terms} · awaiting payment`,
      gate: 'Collections action',
      icon: 'cash',
      navigateTo: `customers/${cust?.id}/ledger`,
      approve: () => {
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Fully Paid' } : x),
          notifications: [
            { id: 'n-paid-' + Date.now(), kind: 'so', text: `${so.invoice_no || so.so_no} paid in full · close & reconcile`, date: window.TODAY, read: false, role: 'Project Manager' },
            ...s.notifications,
          ],
        }));
        toast(`Payment recorded · ${so.so_no} fully paid`, 'success');
      },
      approveLabel: 'Record Payment',
    });
  });

  // 9. Fully Paid → PM task: close & reconcile surplus
  state.sales_orders.filter(s => s.status === 'Fully Paid').forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    tasks.push({
      id: `task-close-${so.id}`,
      role: 'Project Manager',
      kind: 'Close & Reconcile',
      ref: so.so_no,
      refId: so.id,
      by: 'Collections',
      amount: 0,
      detail: `${cust?.name} · paid · close SO · surplus items return to Master Pool`,
      gate: 'Surplus reconciliation',
      icon: 'check',
      navigateTo: `godown/${so.id}`,
      approve: () => {
        mutate(s => ({
          ...s,
          sales_orders: s.sales_orders.map(x => x.id === so.id ? { ...x, status: 'Closed' } : x),
        }));
        toast(`${so.so_no} closed · surplus returned to pool`, 'success');
      },
      approveLabel: 'Close SO',
    });
  });

  // 10. Overdue invoices → Collections (existing block below, but mark id distinct)
  state.sales_orders.filter(s => s.status === 'Payment Pending' && (s.days_overdue || 0) > 0).forEach(so => {
    const cust = state.customers.find(c => c.id === so.customer_id);
    tasks.push({
      id: `task-coll-${so.id}`,
      role: 'Collections',
      kind: 'Overdue Follow-up',
      ref: so.invoice_no,
      refId: so.id,
      by: 'System',
      amount: so.invoice_amount,
      detail: `${cust?.name} · ${so.days_overdue} days overdue · ${cust?.contact} ${cust?.phone}`,
      gate: 'Action required',
      icon: 'cash',
      navigateTo: `customers/${cust?.id}/ledger`,
      approve: () => { toast(`Follow-up logged for ${cust?.name}`, 'success'); },
      approveLabel: 'Log follow-up',
    });
  });

  // Inventory write-off (MD)
  if (!state.dismissed_writeoff) {
    tasks.push({
      id: 'task-writeoff-1',
      role: 'Managing Director',
      kind: 'Inventory Write-off',
      ref: 'WO-2026-04',
      refId: null,
      by: state.users.find(u => u.role === 'Stores')?.name || 'Stores',
      amount: 32000,
      detail: '2× motherboards damaged in transit · TechSource batch · debit note raised',
      gate: '> ₹25k · MD approval',
      icon: 'alert',
      navigateTo: 'pool',
      approve: () => { mutate(s => ({ ...s, dismissed_writeoff: true })); toast('Write-off approved · debit note finalised', 'success'); },
      reject: () => { mutate(s => ({ ...s, dismissed_writeoff: true })); toast('Write-off rejected'); },
    });
  }

  return tasks;
}

// What tasks does THIS user have?
function tasksForRole(state, role, mutate, navigate, toast) {
  const all = buildTasks(state, mutate, navigate, toast);
  if (role === 'Org Admin' || role === 'Managing Director' && perm(role).can.approveAll) {
    if (role === 'Org Admin') return all;
  }
  return all.filter(t => t.role === role);
}

window.PERMISSIONS = PERMISSIONS;
window.perm = perm;
window.canDo = canDo;
window.canAccess = canAccess;
window.buildTasks = buildTasks;
window.tasksForRole = tasksForRole;
