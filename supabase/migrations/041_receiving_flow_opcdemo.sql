-- ============================================================================
-- OP Central — 041: receiving_flow override for OP Central Demo
-- ============================================================================
-- OP Central Demo runs the `standard` profile (Purchase marks received ->
-- Stores accepts and posts the GRN). Requested so this account also
-- demonstrates the request-then-approve-then-auto-GRN flow Microlink and
-- Demo Org already run: Stores confirms what arrived, Purchase accepts and
-- posts the GRN. See docs/receiving-grn.md / docs/workflow-profiles.md.
--
-- A per-ORGANIZATION override on just the one key (organization_settings.
-- data->'workflow'), not a switch to a different preset — po_item_language,
-- intransit_tracking, invoice_on_grn/dispatch and the rest of OP Central
-- Demo's `standard` settings are untouched. Same merge
-- `opc_admin_set_workflow_key` performs, run directly as a migration (same
-- pattern as 039). Idempotent / re-runnable. Reversible from the Platform
-- console (Workflow -> reset the override) without touching this file.
--
-- Checked first: every pending_receipts record already on this org's SOs is
-- status 'Accepted' (historical) -- nothing is left mid-flight waiting on
-- the OLD direction's acceptor, so flipping the direction strands no live
-- request.
-- ============================================================================

do $do$
declare v_org uuid;
        v_wf  jsonb;
begin
  select id into v_org from public.organizations where name = 'OP Central Demo';
  if v_org is null then
    raise exception 'OP Central Demo organization not found — nothing applied';
  end if;

  insert into public.organization_settings (organization_id, data)
  values (v_org, '{}'::jsonb)
  on conflict (organization_id) do nothing;

  select coalesce(data->'workflow', '{}'::jsonb) into v_wf
    from public.organization_settings where organization_id = v_org;
  if jsonb_typeof(v_wf) is distinct from 'object' then v_wf := '{}'::jsonb; end if;

  v_wf := v_wf || jsonb_build_object('receiving_flow', 'stores_to_purchase');

  update public.organization_settings
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('workflow', v_wf),
         updated_at = now()
   where organization_id = v_org;
end $do$;

notify pgrst, 'reload schema';
