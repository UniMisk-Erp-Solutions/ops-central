-- ============================================================================
-- OP Central — 039: BOQ partial-per-dispatch billing for Microlink
-- ============================================================================
-- A BOQ bills nothing until every item in it has shipped — deliberate, so a
-- partial package is never disputed (see docs/boq-billing.md). Microlink
-- wants BOTH: a client invoice for whatever ships on every delivery, not
-- only once a billing group completes, AND a distinct record marking the
-- moment a group actually finishes (₹0 — the dispatch above already billed
-- it; this is a confirmation, never a second charge).
--
-- A per-ORGANIZATION override (organization_settings.data->'workflow'), not
-- a change to the procurement_only PROFILE's defaults — this affects only
-- Microlink, never any other org that might later also run that profile.
-- Absent everywhere else keeps today's all-or-nothing BOQ billing exactly as
-- it is; the effective-workflow resolution (opc_workflow_for, 027) already
-- layers this override on top of the profile default without any code change
-- here. Same merge `opc_admin_set_workflow_key` performs, run directly as a
-- migration. Idempotent / re-runnable.
-- ============================================================================

do $do$
declare v_org uuid;
        v_wf  jsonb;
begin
  select id into v_org from public.organizations where lower(trim(subdomain)) = 'ml';
  if v_org is null then
    raise exception 'Microlink organization (subdomain = ml) not found — nothing applied';
  end if;

  insert into public.organization_settings (organization_id, data)
  values (v_org, '{}'::jsonb)
  on conflict (organization_id) do nothing;

  select coalesce(data->'workflow', '{}'::jsonb) into v_wf
    from public.organization_settings where organization_id = v_org;
  if jsonb_typeof(v_wf) is distinct from 'object' then v_wf := '{}'::jsonb; end if;

  v_wf := v_wf || jsonb_build_object('boq_partial_on_dispatch', true);

  update public.organization_settings
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('workflow', v_wf),
         updated_at = now()
   where organization_id = v_org;
end $do$;

notify pgrst, 'reload schema';
