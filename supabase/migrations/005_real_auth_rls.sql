-- OP Central — 005: real Supabase Auth (GoTrue) + RLS lockdown
-- Run after 004. Replaces the demo simple-password auth.
--
-- - Users live in auth.users (bcrypt) with a public.users PROFILE keyed by the
--   auth uuid (stored as text). Login uses GoTrue (supabase.auth).
-- - SECURITY DEFINER RPCs create/delete users (no service-role key in the client).
-- - RLS: anon can no longer touch data; only an active member (logged in with a
--   profile) can read/write operational tables; config/users writes are admin-only.
-- - Existing demo users are migrated into auth.users using their stored password
--   so their logins keep working; then the password column is dropped.
-- Idempotent / re-runnable.

create extension if not exists pgcrypto;

-- ============================================================================
-- Helper: create a GoTrue auth user (email+password) -> returns uuid.
-- Sets the token columns to '' (GoTrue scans them into non-null Go strings).
-- ============================================================================
create or replace function public._opc_make_auth_user(p_email text, p_password text)
returns uuid
language plpgsql security definer set search_path = auth, public, extensions
as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at)
  values (v::text, v,
    jsonb_build_object('sub', v::text, 'email', lower(p_email), 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now());
  return v;
end $$;
revoke all on function public._opc_make_auth_user(text, text) from public, anon, authenticated;

-- ============================================================================
-- RLS helpers (SECURITY DEFINER so they bypass RLS on public.users themselves)
-- ============================================================================
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.users u where u.id = auth.uid()::text and u.active);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.users u where u.id = auth.uid()::text and u.role = 'Org Admin' and u.active);
$$;
grant execute on function public.is_member() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Public check used by the login screen (no auth needed): does an admin exist?
create or replace function public.opc_admin_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.users u where u.role = 'Org Admin' and u.active);
$$;
grant execute on function public.opc_admin_exists() to anon, authenticated;

-- ============================================================================
-- Signup first admin (only while no admin exists) — callable by anon.
-- Drop the prior (004) version first: its return columns differ, and
-- CREATE OR REPLACE cannot change a function's return type.
-- ============================================================================
drop function if exists public.opc_signup_admin(text, text, text);
create or replace function public.opc_signup_admin(p_name text, p_email text, p_password text)
returns table(id text, email text, name text, role text, initials text, active boolean)
language plpgsql security definer set search_path = public as $$
declare v uuid; v_ini text;
begin
  if exists(select 1 from public.users u where u.role = 'Org Admin' and u.active) then
    raise exception 'An admin account already exists';
  end if;
  if exists(select 1 from auth.users a where lower(a.email) = lower(p_email)) then
    raise exception 'Email already in use';
  end if;
  v := public._opc_make_auth_user(p_email, p_password);
  v_ini := upper(substr(regexp_replace(coalesce(p_name, 'Admin'), '\s', '', 'g'), 1, 2));
  insert into public.users(id, email, name, role, initials, active)
    values (v::text, lower(p_email), p_name, 'Org Admin', v_ini, true);
  return query select u.id, u.email, u.name, u.role, u.initials, u.active from public.users u where u.id = v::text;
end $$;
grant execute on function public.opc_signup_admin(text, text, text) to anon, authenticated;

-- ============================================================================
-- Admin creates a user (self-guards: caller must be an admin).
-- ============================================================================
create or replace function public.opc_create_user(p_name text, p_email text, p_password text, p_role text)
returns table(id text, email text, name text, role text, initials text, active boolean)
language plpgsql security definer set search_path = public as $$
declare v uuid; v_ini text;
begin
  if not public.is_admin() then raise exception 'Only an admin can create users'; end if;
  if coalesce(p_email,'') = '' or coalesce(p_password,'') = '' then raise exception 'Email and password are required'; end if;
  if exists(select 1 from auth.users a where lower(a.email) = lower(p_email)) then
    raise exception 'Email already in use';
  end if;
  v := public._opc_make_auth_user(p_email, p_password);
  v_ini := upper(substr(regexp_replace(coalesce(p_name, 'U'), '\s', '', 'g'), 1, 2));
  insert into public.users(id, email, name, role, initials, active)
    values (v::text, lower(p_email), p_name, coalesce(p_role, 'Sales'), v_ini, true);
  return query select u.id, u.email, u.name, u.role, u.initials, u.active from public.users u where u.id = v::text;
end $$;
grant execute on function public.opc_create_user(text, text, text, text) to authenticated;

-- ============================================================================
-- Admin deletes a user (auth.users delete cascades identities).
-- ============================================================================
create or replace function public.opc_delete_user(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can delete users'; end if;
  if p_id = auth.uid()::text then raise exception 'You cannot delete your own account'; end if;
  delete from auth.users where id = p_id::uuid;
  delete from public.users where id = p_id;
end $$;
grant execute on function public.opc_delete_user(text) to authenticated;

-- ============================================================================
-- Migrate existing demo users (text ids + plain passwords) into real auth.
-- Guarded by the password column still existing, so this block is a no-op on re-run.
-- ============================================================================
do $$
declare r record; v uuid;
begin
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='users' and column_name='password') then
    for r in execute 'select id, email, name, role, initials, active, password from public.users where password is not null' loop
      if exists(select 1 from auth.users a where lower(a.email) = lower(r.email)) then continue; end if;
      v := public._opc_make_auth_user(r.email, r.password);
      delete from public.users where id = r.id;     -- free the unique email before re-insert
      insert into public.users(id, email, name, role, initials, active)
        values (v::text, lower(r.email), r.name, r.role,
                coalesce(r.initials, upper(substr(r.name,1,2))), coalesce(r.active, true));
    end loop;
  end if;
end $$;

-- Retire demo-auth bits.
alter table public.users drop column if exists password;
drop function if exists public.opc_login(text, text);

-- ============================================================================
-- RLS lockdown
-- ============================================================================
-- Operational tables: only active members (logged-in users with a profile).
do $$
declare t text;
  ops text[] := array['categories','products','boms','customers','vendors',
    'sales_orders','vendor_pos','grns','vendor_invoices','payments','pool',
    'rfqs','transfer_requests','notifications','audit'];
begin
  foreach t in array ops loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', 'anon_all_'||t, t);
    execute format('drop policy if exists %I on public.%I;', 'member_all_'||t, t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member());', 'member_all_'||t, t);
  end loop;
end $$;

-- config: read = member, write = admin
alter table public.config enable row level security;
drop policy if exists anon_all_config on public.config;
drop policy if exists config_read on public.config;
drop policy if exists config_write on public.config;
revoke all on public.config from anon;
grant select, insert, update, delete on public.config to authenticated;
create policy config_read  on public.config for select to authenticated using (public.is_member());
create policy config_write on public.config for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- users (profiles): read = member, write = admin (RPCs are SECURITY DEFINER, bypass RLS)
alter table public.users enable row level security;
drop policy if exists anon_all_users on public.users;
drop policy if exists users_read on public.users;
drop policy if exists users_write on public.users;
revoke all on public.users from anon, authenticated;
grant select, insert, update, delete on public.users to authenticated;
create policy users_read  on public.users for select to authenticated using (public.is_member());
create policy users_write on public.users for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Expose the new RPCs over REST immediately.
notify pgrst, 'reload schema';
