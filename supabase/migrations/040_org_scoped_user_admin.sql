-- ============================================================================
-- OP Central — 040: scope application user administration to the active org
-- ============================================================================
-- `public.users.role` is a global profile field, while membership and
-- organization-specific navigation live separately. Keep that model intact,
-- but do not let a global Org Admin profile authorize actions in every tenant.
-- Organization admins may manage users only when the active organization's
-- effective navigation grants Settings. Master admins retain their existing
-- platform-wide behavior.
-- ============================================================================

create or replace function public.opc_can_manage_org_users()
returns boolean
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_org uuid := public.active_org_id();
  v_role text;
  v_role_config jsonb;
begin
  if auth.uid() is null then return false; end if;
  if public.is_master_admin() then return true; end if;
  if v_org is null or not public.is_org_member(v_org) then return false; end if;

  select u.role into v_role
    from public.users u
   where u.id = auth.uid()::text and u.active = true;
  if v_role is null then return false; end if;

  select coalesce(c.data->'permissions'->v_role, '{}'::jsonb)
    into v_role_config
    from public.config c
   where c.organization_id = v_org
   limit 1;
  v_role_config := coalesce(v_role_config, '{}'::jsonb);

  -- Match the frontend's effective nav behavior: an explicit role nav array
  -- overrides the built-in nav; otherwise only the built-in Org Admin role
  -- includes Settings. Unknown/custom roles need an explicit Settings entry.
  if jsonb_typeof(v_role_config->'nav') = 'array' then
    return (v_role_config->'nav') @> '["settings"]'::jsonb;
  end if;
  return v_role = 'Org Admin';
end;
$fn$;
revoke all on function public.opc_can_manage_org_users() from public, anon;
grant execute on function public.opc_can_manage_org_users() to authenticated;

-- The general app roster also drives the role switcher. Keep that RPC limited
-- to active profiles/memberships, as it was before, and require caller
-- membership because SECURITY DEFINER bypasses table RLS.
create or replace function public.opc_org_users()
returns table(id text, email text, name text, role text, initials text, active boolean)
language sql stable security definer set search_path = public as $fn$
  select u.id, u.email, u.name, u.role, u.initials, u.active
    from public.users u
    join public.organization_memberships om on om.user_id = u.id and om.is_active = true
   where om.organization_id = public.active_org_id()
     and (public.is_master_admin() or public.is_org_member(public.active_org_id()))
     and u.active = true
   order by u.name;
$fn$;
revoke all on function public.opc_org_users() from public, anon;
grant execute on function public.opc_org_users() to authenticated;

-- Settings needs a separate roster so the active toggle can show and restore
-- inactive memberships without putting them in the app-wide role switcher.
create or replace function public.opc_org_managed_users()
returns table(id text, email text, name text, role text, initials text, active boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.active_org_id();
begin
  if not public.opc_can_manage_org_users() then
    raise exception 'You are not authorized to manage users in this organization';
  end if;
  return query
    select u.id, u.email, u.name, u.role, u.initials,
           (u.active and om.is_active) as active
      from public.users u
      join public.organization_memberships om on om.user_id = u.id
     where om.organization_id = v_org
     order by u.name;
end;
$fn$;
revoke all on function public.opc_org_managed_users() from public, anon;
grant execute on function public.opc_org_managed_users() to authenticated;

-- `active` on public.users is global. Tenant admins use this scoped RPC from
-- the existing Users toggle instead of directly changing that shared profile.
create or replace function public.opc_set_org_user_active(p_id text, p_active boolean)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.active_org_id();
begin
  if p_id is null or p_id = auth.uid()::text then
    raise exception 'You cannot deactivate your own account';
  end if;
  if not public.opc_can_manage_org_users() then
    raise exception 'You are not authorized to manage users in this organization';
  end if;
  if coalesce(p_active, true) and exists (
    select 1 from public.users u where u.id = p_id and u.active = false
  ) then
    raise exception 'This login is disabled globally; a platform admin must reactivate it';
  end if;
  update public.organization_memberships
     set is_active = coalesce(p_active, true)
   where organization_id = v_org and user_id = p_id;
  if not found then raise exception 'User is not a member of this organization'; end if;
  return coalesce(p_active, true);
end;
$fn$;
revoke all on function public.opc_set_org_user_active(text, boolean) from public, anon;
grant execute on function public.opc_set_org_user_active(text, boolean) to authenticated;

-- App roles and account-active state live on the shared public.users profile.
-- Only the platform console may write that global record directly. Tenant
-- admins use the scoped functions above for membership-level active state.
drop policy if exists users_write on public.users;
create policy users_write on public.users for all to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

create or replace function public.opc_create_user(
  p_name text, p_email text, p_password text, p_role text
)
returns table(id text, email text, name text, role text, initials text, active boolean)
language plpgsql security definer set search_path = public as $fn$
declare
  v uuid;
  v_ini text;
  v_org uuid := public.active_org_id();
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.opc_can_manage_org_users() then
    raise exception 'You are not authorized to manage users in this organization';
  end if;
  if v_org is null then raise exception 'Your account is not linked to an organization'; end if;
  if v_email = '' or coalesce(p_password, '') = '' then
    raise exception 'Email and password are required';
  end if;
  if exists (select 1 from auth.users a where lower(a.email) = v_email)
     or exists (select 1 from public.users u where lower(u.email) = v_email) then
    raise exception 'Email already in use';
  end if;

  v := public._opc_make_auth_user(v_email, p_password);
  v_ini := upper(substr(regexp_replace(coalesce(p_name, 'U'), '\s', '', 'g'), 1, 2));
  insert into public.users(id, email, name, role, initials, active)
  values (v::text, v_email, coalesce(nullif(trim(p_name), ''), v_email),
          coalesce(nullif(trim(p_role), ''), 'Sales'), v_ini, true);

  insert into public.organization_memberships(organization_id, user_id, role, is_active)
  values (v_org, v::text,
          case when coalesce(p_role, '') = 'Org Admin' then 'admin' else 'member' end,
          true)
  on conflict (organization_id, user_id)
  do update set is_active = true,
                role = excluded.role;

  return query select u.id, u.email, u.name, u.role, u.initials, u.active
    from public.users u where u.id = v::text;
end;
$fn$;
revoke all on function public.opc_create_user(text, text, text, text) from public, anon;
grant execute on function public.opc_create_user(text, text, text, text) to authenticated;

create or replace function public.opc_delete_user(p_id text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_org uuid := public.active_org_id();
begin
  if p_id is null or p_id = auth.uid()::text then
    raise exception 'You cannot remove your own account';
  end if;
  if not public.opc_can_manage_org_users() then
    raise exception 'You are not authorized to manage users in this organization';
  end if;

  if public.is_master_admin() then
    -- Preserve the platform console's existing global-delete operation.
    delete from auth.users where id = p_id::uuid;
    delete from public.users where id = p_id;
    return;
  end if;

  -- A tenant admin removes a membership, never the shared login/profile or
  -- another organization's access.
  update public.organization_memberships
     set is_active = false
   where organization_id = v_org and user_id = p_id and is_active = true;
  if not found then raise exception 'User is not an active member of this organization'; end if;
end;
$fn$;
revoke all on function public.opc_delete_user(text) from public, anon;
grant execute on function public.opc_delete_user(text) to authenticated;

notify pgrst, 'reload schema';
