-- ============================================================================
-- OP Central — 031: invoice when goods go OUT, not when they come in
-- ============================================================================
-- Invoicing on receipt bills the customer for goods still sitting in our own
-- godown. A trading company invoices what it actually shipped, against the
-- delivery challan — which is also the only point at which the quantity is
-- final, because a dispatch can be partial.
--
-- A new workflow key rather than a code change, so the two companies can differ:
--
--   invoice_on_dispatch = false   standard — unchanged, still invoices on GRN
--   invoice_on_dispatch = true    procurement-only — invoices per delivery challan
--
-- Absent reads as false everywhere, so an organization that has never heard of
-- this key keeps behaving exactly as it does today.
-- ============================================================================

update public.workflow_profiles
   set defaults = defaults || jsonb_build_object('invoice_on_dispatch', false),
       updated_at = now()
 where id = 'standard';

update public.workflow_profiles
   set defaults = defaults || jsonb_build_object('invoice_on_dispatch', true),
       updated_at = now()
 where id = 'procurement_only';

notify pgrst, 'reload schema';
