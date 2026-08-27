-- ============================================================================
-- OP Central — 027: per-organization WORKFLOW PROFILES
-- ============================================================================
-- Feature flags answer "can this org SEE this screen?".
-- Workflow profiles answer "how does this org's PROCESS actually run?".
--
-- Those are different questions. A trading company and a turnkey integrator can
-- both have the Stores screen switched on, yet receive material in opposite
-- directions. Hard-coding either behaviour would mean a code change per client,
-- so behaviour lives in DATA:
--
--   workflow_profiles                       catalogue of presets
--   organizations.workflow_profile          which preset an org runs
--   organization_settings.data->'workflow'  per-org overrides ON TOP of it
--
--   effective workflow = preset defaults || org overrides    (override wins)
--
-- Onboarding a new company type is therefore an INSERT, not a release. An org
-- that needs one switch different from its preset overrides just that key and
-- still inherits every future improvement to the preset.
--
-- Unknown keys read as "not set" and every consumer falls back to the historic
-- behaviour, so this migration changes NOTHING until a profile is assigned.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. The preset catalogue
-- ============================================================================
create table if not exists public.workflow_profiles (
  id          text primary key,
  label       text not null,
  description text,
  defaults    jsonb not null default '{}'::jsonb,
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Catalogue, not tenant data: every signed-in user may read it (the UI renders
-- labels from it), but only the platform admin RPCs may write.
alter table public.workflow_profiles enable row level security;
revoke all on public.workflow_profiles from anon;
grant select on public.workflow_profiles to authenticated;
drop policy if exists read_workflow_profiles on public.workflow_profiles;
create policy read_workflow_profiles on public.workflow_profiles
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Seeded presets.
--
-- receiving_flow      purchase_to_stores | stores_to_purchase
--                     who TICKS what arrived, and who ACCEPTS it + posts the GRN
-- po_item_language    ours | vendor
--                     whose part numbers the vendor PO prints in
-- intransit_tracking  capture LR / carrier / ETA between PO and GRN
-- customer_language   show the customer's own wording next to ours
-- supervisor_signoff  a final invoice waits for the site supervisor
-- auto_invoice_on_grn raise the client invoice automatically when a GRN posts
-- outward_dispatch    stock leaves the VG on a delivery challan
-- ---------------------------------------------------------------------------
insert into public.workflow_profiles (id, label, description, defaults, sort_order) values
  ('standard', 'Standard (full ERP)',
   'Presales through to invoicing. Purchase marks material received, Stores accepts and posts the GRN.',
   jsonb_build_object(
     'receiving_flow',      'purchase_to_stores',
     'po_item_language',    'ours',
     'intransit_tracking',  false,
     'customer_language',   false,
     'supervisor_signoff',  true,
     'auto_invoice_on_grn', true,
     'outward_dispatch',    false
   ), 10),
  ('procurement_only', 'Procurement & dispatch only',
   'No presales. Customer sheet in, vendor PO out in the vendor part numbers, Stores confirms the GRN and Purchase accepts it, then partial outward dispatch on a delivery challan.',
   jsonb_build_object(
     'receiving_flow',      'stores_to_purchase',
     'po_item_language',    'vendor',
     'intransit_tracking',  true,
     'customer_language',   true,
     'supervisor_signoff',  false,
     'auto_invoice_on_grn', false,
     'outward_dispatch',    true
   ), 20)
on conflict (id) do update
  set label       = excluded.label,
      description = excluded.description,
      defaults    = excluded.defaults,
      sort_order  = excluded.sort_order,
      updated_at  = now();

-- ============================================================================
-- 2. Which preset each org runs
-- ============================================================================
alter table public.organizations
  add column if not exists workflow_profile text not null default 'standard';

-- FK added only after the seed above exists, so no existing row can violate it.
-- on delete set default: retiring a preset falls the org back to 'standard'
-- rather than blocking the delete or orphaning the org.
do $do$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'organizations_workflow_profile_fkey') then
    alter table public.organizations
      add constraint organizations_workflow_profile_fkey
      foreign key (workflow_profile) references public.workflow_profiles(id)
      on update cascade on delete set default;
  end if;
end $do$;

-- ============================================================================
-- 3. Resolution — preset defaults, then the org's own overrides
-- ============================================================================
create or replace function public.opc_workflow_for(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(
           (select p.defaults from public.workflow_profiles p
             join public.organizations o on o.workflow_profile = p.id
            where o.id = p_org_id and p.is_active), '{}'::jsonb)
       ||
         coalesce(
           (select st.data->'workflow' from public.organization_settings st
             where st.organization_id = p_org_id
               and jsonb_typeof(st.data->'workflow') = 'object'), '{}'::jsonb);
$fn$;
grant execute on function public.opc_workflow_for(uuid) to authenticated;

-- The signed-in user's effective workflow, for the org they are working in.
create or replace function public.opc_my_workflow()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select public.opc_workflow_for(public.active_org_id());
$fn$;
grant execute on function public.opc_my_workflow() to authenticated;

-- ============================================================================
-- 4. One round trip on login — context now carries the workflow too
-- ============================================================================
create or replace function public.opc_my_context()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'active_org_id', public.active_org_id(),
    'is_master_admin', public.is_master_admin(),
    'organization', (select to_jsonb(o) - 'created_at' - 'updated_at'
                     from public.organizations o where o.id = public.active_org_id()),
    'features', public.opc_my_features(),
    'workflow', public.opc_my_workflow(),
    'workflow_profile', (select o.workflow_profile from public.organizations o
                          where o.id = public.active_org_id())
  );
$fn$;
grant execute on function public.opc_my_context() to authenticated;

-- ============================================================================
-- 5. Platform console — read and write profiles
-- ============================================================================
create or replace function public.opc_admin_list_workflow_profiles()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce((select jsonb_agg(jsonb_build_object(
           'id', p.id, 'label', p.label, 'description', p.description,
           'defaults', p.defaults) order by p.sort_order, p.label)
         from public.workflow_profiles p where p.is_active), '[]'::jsonb);
$fn$;
grant execute on function public.opc_admin_list_workflow_profiles() to authenticated;

-- Assign a preset. Overrides are deliberately NOT cleared: an org that had a
-- deviation keeps it unless the admin clears that key explicitly.
create or replace function public.opc_admin_set_workflow_profile(p_org_id uuid, p_profile text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v text := nullif(trim(coalesce(p_profile,'')), '');
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if v is null then raise exception 'A workflow profile is required'; end if;
  if not exists (select 1 from public.workflow_profiles where id = v and is_active) then
    raise exception 'No such workflow profile: %', v;
  end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  update public.organizations set workflow_profile = v, updated_at = now() where id = p_org_id;
  return jsonb_build_object('ok', true, 'profile', v,
                            'workflow', public.opc_workflow_for(p_org_id));
end $fn$;
grant execute on function public.opc_admin_set_workflow_profile(uuid, text) to authenticated;

-- Override ONE key for ONE org. p_value null removes the override, so the org
-- falls back to its preset (and keeps inheriting future changes to it).
create or replace function public.opc_admin_set_workflow_key(p_org_id uuid, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_key text := nullif(trim(coalesce(p_key,'')), '');
        v_wf  jsonb;
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if v_key is null then raise exception 'A workflow key is required'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;

  insert into public.organization_settings (organization_id, data)
  values (p_org_id, '{}'::jsonb)
  on conflict (organization_id) do nothing;

  select coalesce(data->'workflow', '{}'::jsonb) into v_wf
    from public.organization_settings where organization_id = p_org_id;
  if jsonb_typeof(v_wf) is distinct from 'object' then v_wf := '{}'::jsonb; end if;

  if p_value is null or jsonb_typeof(p_value) = 'null' then
    v_wf := v_wf - v_key;
  else
    v_wf := v_wf || jsonb_build_object(v_key, p_value);
  end if;

  update public.organization_settings
     set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('workflow', v_wf),
         updated_at = now()
   where organization_id = p_org_id;

  return jsonb_build_object('ok', true, 'overrides', v_wf,
                            'workflow', public.opc_workflow_for(p_org_id));
end $fn$;
grant execute on function public.opc_admin_set_workflow_key(uuid, text, jsonb) to authenticated;

-- ============================================================================
-- 6. Console listing — carry the profile, the overrides and the resolved result
-- ============================================================================
create or replace function public.opc_admin_list_organizations()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select case when not public.is_master_admin() then '[]'::jsonb else coalesce(
    (select jsonb_agg(row order by row->>'name')
     from (
       select jsonb_build_object(
         'id', o.id,
         'name', o.name,
         'slug', o.slug,
         'subdomain', o.subdomain,
         'status', o.status,
         'plan', o.plan,
         'billing_status', o.billing_status,
         'plan_started_at', o.plan_started_at,
         'notes', o.notes,
         'created_at', o.created_at,
         'workflow_profile', o.workflow_profile,
         'workflow', public.opc_workflow_for(o.id),
         'workflow_overrides', coalesce((select st.data->'workflow'
                                         from public.organization_settings st
                                         where st.organization_id = o.id
                                           and jsonb_typeof(st.data->'workflow') = 'object'),
                                        '{}'::jsonb),
         'features', coalesce((select jsonb_object_agg(f.feature_key, f.enabled)
                               from public.organization_features f
                               where f.organization_id = o.id), '{}'::jsonb),
         'members', (select count(*) from public.organization_memberships m
                      where m.organization_id = o.id and m.is_active),
         'sales_orders', (select count(*) from public.sales_orders s where s.organization_id = o.id),
         'settings', coalesce((select to_jsonb(st) - 'organization_id'
                               from public.organization_settings st
                               where st.organization_id = o.id), '{}'::jsonb)
       ) as row
       from public.organizations o
     ) t), '[]'::jsonb) end;
$fn$;
grant execute on function public.opc_admin_list_organizations() to authenticated;

-- ============================================================================
-- 7. Creating an org may pick its profile and features up front
-- ============================================================================
create or replace function public.opc_admin_create_org_v2(
  p_name text, p_slug text, p_subdomain text, p_plan text,
  p_billing_status text, p_profile text, p_features jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org jsonb;
        v_id uuid;
        v_profile text := nullif(trim(coalesce(p_profile,'')), '');
        k text;
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  -- Reuse the audited creator so slug / subdomain validation stays in ONE place.
  v_org := public.opc_admin_create_org(p_name, p_slug, p_subdomain, p_plan, p_billing_status);
  v_id  := (v_org->>'id')::uuid;

  if v_profile is not null then
    if not exists (select 1 from public.workflow_profiles where id = v_profile and is_active) then
      raise exception 'No such workflow profile: %', v_profile;
    end if;
    update public.organizations set workflow_profile = v_profile where id = v_id;
  end if;

  if jsonb_typeof(p_features) = 'object' then
    for k in select jsonb_object_keys(p_features) loop
      insert into public.organization_features (organization_id, feature_key, enabled, updated_at, updated_by)
      values (v_id, k, coalesce((p_features->>k)::boolean, true), now(), auth.uid()::text)
      on conflict (organization_id, feature_key)
      do update set enabled = excluded.enabled, updated_at = now();
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id,
                            'organization', v_org,
                            'workflow', public.opc_workflow_for(v_id));
end $fn$;
grant execute on function public.opc_admin_create_org_v2(text, text, text, text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
