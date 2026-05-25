-- OP Central — 004: admin self-signup (remove seeded admin)
-- Run after 003_auth_users.sql.
--
-- Removes the seeded demo admin. The first admin is now created via a one-time
-- self-signup: opc_signup_admin succeeds ONLY while no active Org Admin exists.
-- After that, signup is closed — all other users are created by the admin and
-- can only log in.

delete from public.users where id = 'u-admin';

create or replace function public.opc_signup_admin(p_name text, p_email text, p_password text)
returns table (id text, email text, name text, role text, initials text, permissions jsonb, active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  text;
  v_ini text;
begin
  if exists (select 1 from public.users u where u.role = 'Org Admin' and u.active = true) then
    raise exception 'An admin account already exists';
  end if;
  if exists (select 1 from public.users u where lower(u.email) = lower(p_email)) then
    raise exception 'Email already in use';
  end if;
  v_id  := 'u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  v_ini := upper(substr(regexp_replace(coalesce(p_name, 'Admin'), '\s', '', 'g'), 1, 2));
  insert into public.users (id, email, name, role, initials, password, active)
       values (v_id, p_email, p_name, 'Org Admin', v_ini, p_password, true);
  return query
    select u.id, u.email, u.name, u.role, u.initials, u.permissions, u.active
      from public.users u where u.id = v_id;
end $$;

revoke all on function public.opc_signup_admin(text, text, text) from public;
grant execute on function public.opc_signup_admin(text, text, text) to anon, authenticated;
