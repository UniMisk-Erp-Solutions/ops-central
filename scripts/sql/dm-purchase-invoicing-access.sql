-- ============================================================================
-- Demo Org — give Purchase visibility into Invoices and Collections
-- ============================================================================
-- dm has no Billing/Collections/Managing Director role, and Client Facing was
-- deliberately trimmed to two pages. With invoice_on_dispatch + e_invoice +
-- partial_invoicing all on for this org, invoices raise automatically -- but
-- until now NOBODY except Org Admin could view them, generate an e-invoice
-- IRN, or log a collections follow-up. Purchase already "watches and closes"
-- the order (see docs/client-acceptance.md); this makes that role able to see
-- the bill through to payment too, without inventing a sixth role dm never
-- asked for.
--
-- `nav` and `can` are both whole-object overrides (perm() in permissions.jsx),
-- so this repeats Purchase's ENTIRE current nav/can and adds exactly two nav
-- ids and two capabilities -- omitting any existing key here would silently
-- take it away. See docs/client-requests.md's Traps section, and
-- scripts/ssh-audit-permission-drift.py, which now watches for this class of
-- drift going forward.

update public.config
   set data = jsonb_set(
     jsonb_set(
       data,
       '{permissions,Purchase,nav}',
       '["dashboard","inbox","client-requests","sourcing","sales-orders","godown",
         "transfers","rfq","vendor-pos","grn","vendors","pool","products",
         "invoices","collections"]'::jsonb,
       true
     ),
     '{permissions,Purchase,can}',
     '{
        "createRFQ": true, "selectVendor": true, "createVendorPO": true,
        "doSourcing": true, "viewVendors": true, "viewCost": true,
        "viewProducts": true, "createSourcing": true,
        "convertClientRequest": true,
        "raiseInvoice": true, "generateEWB": true, "logFollowup": true,
        "viewCustomers": true
      }'::jsonb,
     true
   )
 where organization_id = (select id from public.organizations where slug = 'demo');

select data->'permissions'->'Purchase' as purchase_override
  from public.config
 where organization_id = (select id from public.organizations where slug = 'demo');
