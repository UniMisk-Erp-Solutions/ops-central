-- ============================================================================
-- OP Central — 028: drop opc_admin_create_org_v2
-- ============================================================================
-- 027 added a "create an org and set its workflow profile in one call" wrapper.
-- It called opc_admin_create_org positionally and put p_billing_status where
-- that function actually takes p_features (jsonb) — so it would have failed the
-- first time it ran. plpgsql does not resolve inner calls until execution, so
-- creating the function succeeded and hid the mistake.
--
-- Rather than re-derive a second signature that has to be kept in step with the
-- first, the console now calls the ONE audited creator and then
-- opc_admin_set_workflow_profile. Creating an organization is a once-per-client
-- action, so the extra round trip costs nothing and there is only one code path
-- that can validate a slug.
-- ============================================================================
drop function if exists public.opc_admin_create_org_v2(text, text, text, text, text, text, jsonb);

notify pgrst, 'reload schema';
