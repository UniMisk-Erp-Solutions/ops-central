-- 035 -- split_stores matches Microlink on PO wording and dispatch invoicing
--
-- Two explicit decisions, both "for now, will change later" per the user:
--
--   po_item_language: 'ours' -> 'vendor'   the vendor PO prints THEIR own
--     part numbers, same as procurement_only. Requested as "same as
--     Microlink"; the Vendor PO's screen/template was already the one
--     shared component every organization uses -- this is the one workflow
--     KEY that genuinely differed.
--
--   invoice_on_dispatch: false -> true      the client invoice raises when
--     goods SHIP, same as procurement_only. auto_invoice_on_grn stays false
--     (already matched Microlink).
--
-- Neither key exists in the standard or procurement_only presets under a
-- DIFFERENT value because of this change -- this migration touches only the
-- split_stores row.
update public.workflow_profiles
   set defaults = defaults
                 || jsonb_build_object('po_item_language', 'vendor')
                 || jsonb_build_object('invoice_on_dispatch', true),
       updated_at = now()
 where id = 'split_stores';
