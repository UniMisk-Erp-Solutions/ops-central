-- ============================================================================
-- OP Central — 038: state.users is org-scoped, everywhere it matters
-- ============================================================================
-- public.users has no organization_id column at all — membership lives in
-- organization_memberships (one login CAN belong to several orgs). The RLS
-- policy on users (021_phase3_tenant_rls) is CORRECT and stays exactly as it
-- is: "see profiles of people you share an org with; master admins see
-- everyone" — that second half is deliberate, it is what lets a platform
-- admin assign an EXISTING login as a brand-new org's first admin.
--
-- The bug was never the database: the frontend's bulk load
-- (`.from('users').select(...)`, store.jsx) never filtered by org at all, so
-- RLS handed a master admin every active row in the whole platform, and that
-- became `state.users` — the array the "Act as" role-switcher (shell.jsx)
-- and every ordinary getUser() lookup reads. A master admin (which, by
-- historical accident, the very first admin account ever created always is
-- — opc_bootstrap_org_for grants it automatically) would see every other
-- organization's users mixed into their own "Act as" bar: initials clashing,
-- roles from a company they do not run, one flat list instead of one per
-- tenant.
--
-- Fix: state.users becomes what it always should have been — the CALLER's
-- own active org, and only that org. The one place that legitimately needs
-- the full cross-org list (PlatformConsole's "assign an existing login as
-- this new org's admin" picker) gets its OWN dedicated master-admin-only
-- fetch instead, exactly the way it already dedicated-fetches organizations
-- via opc_admin_list_organizations — never leaning on the general list.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Every authenticated user's own org roster — the new default for
--    state.users. Scoped by active_org_id(), the same function config,
--    features and workflow are already resolved through, so "which org am I
--    looking at" is answered exactly once, the same way everywhere.
-- ----------------------------------------------------------------------------
create or replace function public.opc_org_users()
returns table(id text, email text, name text, role text, initials text, active boolean)
language sql stable security definer set search_path = public as $fn$
  select u.id, u.email, u.name, u.role, u.initials, u.active
  from public.users u
  join public.organization_memberships om
    on om.user_id = u.id and om.is_active = true
  where om.organization_id = public.active_org_id()
    and u.active = true
  order by u.name;
$fn$;
grant execute on function public.opc_org_users() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The one legitimate cross-org read: every active login on the platform,
--    for PlatformConsole's new-organization "first admin" picker. Silent
--    empty result for anyone else, the same convention
--    opc_admin_list_organizations already uses — never an exception from a
--    plain listing call.
-- ----------------------------------------------------------------------------
create or replace function public.opc_admin_all_users()
returns table(id text, email text, name text, role text, initials text, active boolean)
language sql stable security definer set search_path = public as $fn$
  select u.id, u.email, u.name, u.role, u.initials, u.active
  from public.users u
  where public.is_master_admin() and u.active = true
  order by u.name;
$fn$;
grant execute on function public.opc_admin_all_users() to authenticated;

notify pgrst, 'reload schema';
