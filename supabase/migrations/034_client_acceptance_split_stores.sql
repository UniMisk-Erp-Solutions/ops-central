-- 034 — turn on client review for the split-stores preset
--
-- The client accepts or rejects delivered quantities, item by item or the
-- whole order at once, before the order is treated as settled. See
-- docs/client-acceptance.md.
--
-- Every other preset is untouched: the key defaults to false in code
-- (WORKFLOW_FALLBACK in frontend/src/permissions.jsx), so an organization on
-- `standard` or `procurement_only` — or on no profile at all — behaves exactly
-- as it did before this migration.

update public.workflow_profiles
   set defaults = defaults || jsonb_build_object('client_acceptance', true),
       updated_at = now()
 where id = 'split_stores';
