-- Disposable local Supabase regression test for migration 040.
-- Run with `supabase test db`; the surrounding transaction rolls fixtures back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;

select plan(12);

create temporary table _opc_admin_test_fixture (
  org_a uuid, org_b uuid, admin_id text, other_org_user_id text, outsider_id text
) on commit drop;

create temporary table _opc_tmp_org_a (id uuid);
create temporary table _opc_tmp_org_b (id uuid);
with created as (
  insert into public.organizations (name, slug)
  values ('OPC test org A', 'opc-test-admin-a-' || substr(gen_random_uuid()::text, 1, 8))
  returning id
) insert into _opc_tmp_org_a select id from created;
with created as (
  insert into public.organizations (name, slug)
  values ('OPC test org B', 'opc-test-admin-b-' || substr(gen_random_uuid()::text, 1, 8))
  returning id
) insert into _opc_tmp_org_b select id from created;

insert into _opc_admin_test_fixture (org_a, org_b)
select (select id from _opc_tmp_org_a), (select id from _opc_tmp_org_b);

update _opc_admin_test_fixture
set admin_id = public._opc_make_auth_user('opc-test-admin@example.invalid', 'test-password-040')::text,
    other_org_user_id = public._opc_make_auth_user('opc-test-other@example.invalid', 'test-password-040')::text,
    outsider_id = public._opc_make_auth_user('opc-test-outsider@example.invalid', 'test-password-040')::text;

insert into public.users(id, email, name, role, initials, active)
select admin_id, 'opc-test-admin@example.invalid', 'Test Admin', 'Org Admin', 'TA', true
from _opc_admin_test_fixture;
insert into public.users(id, email, name, role, initials, active)
select other_org_user_id, 'opc-test-other@example.invalid', 'Other Org User', 'Sales', 'OU', true
from _opc_admin_test_fixture;
insert into public.users(id, email, name, role, initials, active)
select outsider_id, 'opc-test-outsider@example.invalid', 'Unlinked Admin', 'Org Admin', 'UA', true
from _opc_admin_test_fixture;

insert into public.organization_memberships(organization_id, user_id, role, is_active)
select org_a, admin_id, 'admin', true from _opc_admin_test_fixture;
insert into public.organization_memberships(organization_id, user_id, role, is_active)
select org_b, other_org_user_id, 'member', true from _opc_admin_test_fixture;
insert into public.user_active_org(user_id, organization_id)
select admin_id, org_a from _opc_admin_test_fixture;

create temporary table _opc_created_user(id text);
grant select on _opc_admin_test_fixture to authenticated;
grant select, insert on _opc_created_user to authenticated;

select set_config('request.jwt.claim.sub', (select admin_id from _opc_admin_test_fixture), true);
set local role authenticated;
select ok(public.opc_can_manage_org_users(), 'Org Admin with active org membership retains Settings user management');
select is(
  (with changed as (
     update public.users set active = false
      where id = current_setting('request.jwt.claim.sub') returning id
   ) select count(*)::integer from changed),
  0,
  'tenant admins cannot directly update a shared global user profile'
);

select throws_ok(
  format('select public.opc_delete_user(%L)', (select other_org_user_id from _opc_admin_test_fixture)),
  'P0001', 'User is not an active member of this organization',
  'tenant admin cannot remove a user who belongs only to another organization'
);

insert into _opc_created_user
select id from public.opc_create_user('Created in A', 'opc-test-created@example.invalid', 'test-password-040', 'Sales');
select is(
  (select om.organization_id::text
     from public.organization_memberships om
     join _opc_created_user cu on cu.id = om.user_id
    where om.is_active),
  (select org_a::text from _opc_admin_test_fixture),
  'new login is assigned to the active organization'
);
select is(
  public.opc_set_org_user_active((select id from _opc_created_user), false),
  false,
  'tenant user toggle deactivates only the active-org membership'
);
select is(
  (select active from public.opc_org_managed_users() where id = (select id from _opc_created_user)),
  false,
  'inactive membership remains visible to Settings for reactivation'
);
select is(
  (select count(*)::integer from public.opc_org_users() where id = (select id from _opc_created_user)),
  0,
  'inactive membership is excluded from the app-wide role switcher roster'
);
select is(
  public.opc_set_org_user_active((select id from _opc_created_user), true),
  true,
  'tenant user toggle can reactivate that membership'
);
reset role;

select is(
  (select om.is_active from public.organization_memberships om, _opc_admin_test_fixture f
    where om.organization_id = f.org_b and om.user_id = f.other_org_user_id),
  true,
  'failed cross-organization removal leaves the other membership active'
);

select set_config('request.jwt.claim.sub', (select outsider_id from _opc_admin_test_fixture), true);
set local role authenticated;
select ok(not public.opc_can_manage_org_users(), 'global Org Admin profile without active-org membership is denied');
select throws_ok(
  $$select * from public.opc_create_user('Unauthorized', 'opc-test-nope@example.invalid', 'test-password-040', 'Sales')$$,
  'P0001', 'You are not authorized to manage users in this organization',
  'direct create RPC rejects an unlinked caller'
);
select throws_ok(
  format('select public.opc_delete_user(%L)', (select other_org_user_id from _opc_admin_test_fixture)),
  'P0001', 'You are not authorized to manage users in this organization',
  'direct delete RPC rejects an unlinked caller'
);
reset role;

select * from finish();
rollback;
