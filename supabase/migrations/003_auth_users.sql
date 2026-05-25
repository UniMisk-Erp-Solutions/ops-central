-- OP Central — 003: simple demo auth + user management
-- Run after 002_op_central_full.sql.
--
-- DEMO-GRADE AUTH: passwords are stored in plain text in public.users.password.
-- This is what was chosen for the internal demo. The password column is NOT
-- exposed over REST (select is revoked); login goes through a SECURITY DEFINER
-- function so the hash/compare stays inside the DB. Replace with Supabase Auth
-- (or at least hashed passwords) before any real use.

alter table public.users add column if not exists password text;

-- Remove the demo persona users; keep only the Org Admin to start.
delete from public.users where id <> 'u-admin';

-- Admin login credential (change later).
update public.users
   set email = 'admin@brightline.in', password = 'admin123', active = true
 where id = 'u-admin';

-- Stop exposing the password column over PostgREST: drop the broad table-level
-- SELECT grant and re-grant only the safe columns. (insert/update/delete grants
-- from 002 remain, so the admin UI can still create/modify users.)
revoke select on public.users from anon, authenticated;
grant select (id, email, name, role, initials, permissions, active, created_at)
  on public.users to anon, authenticated;

-- Login check: returns the matching active user WITHOUT the password column.
create or replace function public.opc_login(p_email text, p_password text)
returns table (id text, email text, name text, role text, initials text, permissions jsonb, active boolean)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email, u.name, u.role, u.initials, u.permissions, u.active
    from public.users u
   where lower(u.email) = lower(p_email)
     and u.password = p_password
     and u.active = true
   limit 1;
$$;

revoke all on function public.opc_login(text, text) from public;
grant execute on function public.opc_login(text, text) to anon, authenticated;
