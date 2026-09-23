-- ============================================================================
-- Demo Org — repair the Purchase 'can' override so it carries every
-- capability the base Purchase role has today
-- ============================================================================
-- `config.data.permissions.Purchase.can` is a WHOLE-OBJECT override (perm()
-- in permissions.jsx: `can: (o.can && typeof o.can === 'object') ? o.can :
-- base.can` — not a merge). It was written during the original dm-order-flow
-- work to grant Purchase `createSourcing` for this organization only, and has
-- not moved since. The base PERMISSIONS.Purchase.can in the shared code has:
-- Purchase silently lost every capability added to the base role after that
-- override was written — most recently `convertClientRequest`, which is the
-- ONLY door Purchase has into creating a Sales Order from a client request.
-- That is why "Create Sales Order" never appeared for Purchase on Demo Org:
-- canConvertClientRequest('Purchase') resolved to false, invisibly, because
-- this row said so.
--
-- Fix: rewrite the override to the full, current base can object plus the
-- one org-specific extra (createSourcing). Whenever the base Purchase role
-- gains a new capability in code, this row has to be updated too, or it will
-- happen again — see docs/client-requests.md's Traps section.
-- ============================================================================

update public.config
   set data = jsonb_set(
     data,
     '{permissions,Purchase,can}',
     '{
        "createRFQ": true, "selectVendor": true, "createVendorPO": true,
        "doSourcing": true, "viewVendors": true, "viewCost": true,
        "viewProducts": true, "createSourcing": true,
        "convertClientRequest": true
      }'::jsonb,
     true
   )
 where organization_id = (select id from public.organizations where slug = 'demo');

select data->'permissions'->'Purchase' as purchase_override
  from public.config
 where organization_id = (select id from public.organizations where slug = 'demo');
