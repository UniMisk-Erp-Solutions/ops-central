-- ============================================================================
-- OP Central — 040: demo-only seed, a Vendor PO combined across two SOs
-- ============================================================================
-- Requested so the "1 PO against multiple SO" UI (combined-PO badge,
-- ComboPOSummary on VendorPODetail/ReceiveModal/GRNNew, the per-item PO
-- breakdown on SOVendorPOsTab — see docs/multi-so-vendor-po.md) has
-- something real to look at in the OP Central Demo organization, without
-- waiting for Purchase to combine a real order. Deliberately left
-- un-received — status 'Issued', no GRN — so the Receive flow is still
-- there to exercise by hand.
--
-- Picked two ALREADY-REAL, currently open SOs in that org that genuinely
-- share a component (p-cpu-i9, a gaming-PC CPU) rather than inventing new
-- SOs/vendor/product rows:
--   SO/FY26/0058 (so-1791374832037, Procurement Started) needs 3 — its line
--     has bundle_qty 3 x 1 CPU each.
--   SO/FY26/0045 (so-1783507090054, Approved) needs 1.
-- Vendor v-techsource already supplies both SOs' other electronics lines.
-- The ₹42,000/unit rate is a placeholder for this demo PO only — not read
-- from any real quote — so the amount on this record should not be treated
-- as a real price.
--
-- Shaped exactly like createComboVendorPO's own output (screens-procurement.jsx)
-- so it is indistinguishable from a PO Purchase actually combined by hand:
-- so_alloc only on the shared line, primary SO first, items carry no
-- received/accepted fields pre-GRN. The secondary SO advances Approved ->
-- Procurement Started, same as the real flow — but only from exactly that
-- status, so re-running this migration can never fight a later, real change
-- to that SO. Idempotent / re-runnable (fixed id, ON CONFLICT DO NOTHING).
-- ============================================================================

do $do$
declare
  v_org_id uuid;
  v_po_id  text := 'po-demo-combo-0001';
begin
  select id into v_org_id from public.organizations where name = 'OP Central Demo';
  if v_org_id is null then
    raise exception 'OP Central Demo organization not found — nothing applied';
  end if;

  insert into public.vendor_pos
    (id, po_no, so_id, vendor_id, date, expected, status, amount, items, ebill, source, organization_id)
  values (
    v_po_id,
    'VPO/FY26/0106',
    'so-1791374832037',
    'v-techsource',
    current_date,
    '2026-10-25',
    'Issued',
    168000,
    '[{"product_id":"p-cpu-i9","qty":4,"rate":42000,"so_alloc":[{"so_id":"so-1791374832037","qty":3},{"so_id":"so-1783507090054","qty":1}]}]'::jsonb,
    '{}'::jsonb,
    'manual',
    v_org_id
  )
  on conflict (id) do nothing;

  update public.sales_orders
     set status = 'Procurement Started'
   where id = 'so-1783507090054' and status = 'Approved';
end $do$;

notify pgrst, 'reload schema';
