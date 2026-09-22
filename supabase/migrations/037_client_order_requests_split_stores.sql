-- 037 — turn on client item-requests for the split-stores preset
--
-- The client no longer creates a Sales Order directly. They send a REQUEST —
-- free-typed item names with a quantity each, helped by recommendations from
-- their own past orders — and Purchase matches every name to the catalogue
-- and creates the real SO. See docs/client-requests.md.
--
-- Same pattern as 034 (client_acceptance): a key on the split_stores PRESET,
-- defaulting off in code (WORKFLOW_FALLBACK in frontend/src/permissions.jsx),
-- so every organization on `standard` or `procurement_only` — or on no
-- profile at all — is completely unaffected.

update public.workflow_profiles
   set defaults = defaults || jsonb_build_object('client_order_requests', true),
       updated_at = now()
 where id = 'split_stores';
