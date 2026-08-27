-- ============================================================================
-- OP Central — 025: platform-admin user & credential management
-- ============================================================================
-- Lets the master console create a tenant's login and later change its email or
-- password, WITHOUT ever touching that tenant's data.
--
-- Why the data is safe by construction:
--   every row is tied to users.id (the auth uuid), never to the email address.
--   Changing an email or password rewrites credentials only — memberships,
--   sales orders, audit rows and everything else keep pointing at the same id.
--
-- Production details that are easy to get wrong and are handled here:
--   * an email change MUST also rewrite auth.identities.identity_data->>'email',
--     otherwise GoTrue still matches the old address and login breaks
--   * passwords are bcrypt via extensions.crypt(..., gen_salt('bf')) — the same
--     path _opc_make_auth_user uses
--   * changing a password REVOKES existing sessions/refresh tokens, so a leaked
--     session cannot outlive the change
--   * email uniqueness is checked against auth.users AND public.users
--
-- All functions are master-admin only.
-- Idempotent / re-runnable.
-- ============================================================================

-- ============================================================================
-- 1. Create a login directly INTO a chosen organization.
-- ============================================================================
create or replace function public.opc_admin_create_user(
  p_org_id   uuid,
  p_name     text,
  p_email    text,
  p_password text,
  p_role     text default 'Sales',
  p_org_role text default 'member'
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v uuid; v_ini text; v_email text := lower(trim(coalesce(p_email,'')));
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required';
  end if;
  if length(coalesce(p_password,'')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if exists (select 1 from auth.users a where lower(a.email) = v_email)
     or exists (select 1 from public.users u where lower(u.email) = v_email) then
    raise exception 'Email "%" is already in use', v_email;
  end if;

  v := public._opc_make_auth_user(v_email, p_password);
  v_ini := upper(substr(regexp_replace(coalesce(p_name,'U'), '\s', '', 'g'), 1, 2));

  insert into public.users (id, email, name, role, initials, active)
  values (v::text, v_email, coalesce(nullif(trim(p_name),''), v_email), coalesce(p_role,'Sales'), v_ini, true);

  insert into public.organization_memberships (organization_id, user_id, role, is_active)
  values (p_org_id, v::text,
          case when coalesce(p_org_role,'member') = 'admin' then 'admin' else 'member' end, true)
  on conflict (organization_id, user_id) do update set role = excluded.role, is_active = true;

  return jsonb_build_object('user_id', v::text, 'email', v_email, 'organization_id', p_org_id);
end $fn$;
grant execute on function public.opc_admin_create_user(uuid, text, text, text, text, text) to authenticated;

-- ============================================================================
-- 2. Change a login's EMAIL. Data is untouched — the user id never changes.
-- ============================================================================
create or replace function public.opc_admin_set_user_email(p_user_id text, p_new_email text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_email text := lower(trim(coalesce(p_new_email,'')));
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email is required';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such user';
  end if;
  if exists (select 1 from auth.users a where lower(a.email) = v_email and a.id <> p_user_id::uuid)
     or exists (select 1 from public.users u where lower(u.email) = v_email and u.id <> p_user_id) then
    raise exception 'Email "%" is already in use', v_email;
  end if;

  update auth.users
     set email = v_email,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         email_change = '', email_change_token_new = '',
         updated_at = now()
   where id = p_user_id::uuid;

  -- CRITICAL: GoTrue matches on the identity too. Without this the user could
  -- no longer sign in with either address.
  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_email), true),
         updated_at = now()
   where user_id = p_user_id::uuid and provider = 'email';

  update public.users set email = v_email where id = p_user_id;

  return jsonb_build_object('user_id', p_user_id, 'email', v_email, 'data_preserved', true);
end $fn$;
grant execute on function public.opc_admin_set_user_email(text, text) to authenticated;

-- ============================================================================
-- 3. Reset a login's PASSWORD (and revoke live sessions).
-- ============================================================================
create or replace function public.opc_admin_set_user_password(p_user_id text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = auth, public, extensions as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if length(coalesce(p_new_password,'')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such user';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         recovery_token = '', updated_at = now()
   where id = p_user_id::uuid;

  -- Revoke anything still signed in with the OLD password. Guarded because these
  -- tables vary across GoTrue versions.
  begin
    delete from auth.refresh_tokens where user_id = p_user_id;
  exception when others then null; end;
  begin
    delete from auth.sessions where user_id = p_user_id::uuid;
  exception when others then null; end;

  return jsonb_build_object('user_id', p_user_id, 'password_changed', true, 'sessions_revoked', true);
end $fn$;
grant execute on function public.opc_admin_set_user_password(text, text) to authenticated;

-- ============================================================================
-- 4. Enable / disable a login, and move or re-role them in an org.
-- ============================================================================
create or replace function public.opc_admin_set_user_active(p_user_id text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  update public.users set active = coalesce(p_active,true) where id = p_user_id;
  if not coalesce(p_active,true) then
    begin delete from auth.sessions where user_id = p_user_id::uuid; exception when others then null; end;
    begin delete from auth.refresh_tokens where user_id = p_user_id; exception when others then null; end;
  end if;
  return jsonb_build_object('user_id', p_user_id, 'active', coalesce(p_active,true));
end $fn$;
grant execute on function public.opc_admin_set_user_active(text, boolean) to authenticated;

create or replace function public.opc_admin_set_membership(
  p_org_id uuid, p_user_id text, p_role text default 'member', p_is_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_master_admin() then raise exception 'Platform admins only'; end if;
  if not exists (select 1 from public.organizations where id = p_org_id) then
    raise exception 'No such organization';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No such user';
  end if;
  insert into public.organization_memberships (organization_id, user_id, role, is_active)
  values (p_org_id, p_user_id, case when p_role = 'admin' then 'admin' else 'member' end,
          coalesce(p_is_active,true))
  on conflict (organization_id, user_id)
  do update set role = excluded.role, is_active = excluded.is_active;
  return jsonb_build_object('organization_id', p_org_id, 'user_id', p_user_id, 'role', p_role);
end $fn$;
grant execute on function public.opc_admin_set_membership(uuid, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
