-- 033 — a workflow preset for a company whose stores is two teams
--
-- Five roles: Org Admin, Purchase, Stores In, Stores Out, Client Facing. There
-- is no role called 'Stores', so the receiving hand-off cannot name one: the
-- roles on each side are part of the profile now, and absent still means the
-- historic pair, so no existing organization moves.
--
-- WHAT THIS PRESET ASSERTS, and nothing more:
--   * a dedicated inward team confirms what arrived           (Stores In)
--   * Purchase accepts it and posts the GRN                   (as Microlink)
--   * dispatch to the customer is a step of its own           (Stores Out)
--
-- WHAT IT DELIBERATELY LEAVES ALONE: when the customer gets invoiced. Both
-- automatic triggers are off, so nothing bills by itself until the company says
-- where billing belongs in their flow. Off is recoverable; an invoice sent to a
-- customer by surprise is not.

insert into public.workflow_profiles (id, label, description, defaults, sort_order, is_active)
values (
  'split_stores',
  'Split stores (inward / outward)',
  'Inward and outward are different teams. Purchase accepts receipts; dispatch is its own step. Invoicing is not automatic.',
  jsonb_build_object(
    -- Receiving: the inward team ticks what arrived, Purchase posts the GRN.
    'receiving_flow',             'stores_to_purchase',
    'receiving_requester_roles',  jsonb_build_array('Stores In'),
    'receiving_approver_roles',   jsonb_build_array('Purchase', 'Org Admin'),
    'receiving_requester_label',  'Stores (inward)',
    'receiving_approver_label',   'Purchase',
    -- Outward is a team, so it is a step.
    'outward_dispatch',           true,
    'intransit_tracking',         true,
    -- Not decided yet — see the note above.
    'auto_invoice_on_grn',        false,
    'invoice_on_dispatch',        false,
    -- Left at the standard behaviour until the company says otherwise.
    'po_item_language',           'ours',
    'customer_language',          false,
    'supervisor_signoff',         false
  ),
  30,
  true)
on conflict (id) do update
   set label       = excluded.label,
       description = excluded.description,
       defaults    = excluded.defaults,
       sort_order  = excluded.sort_order,
       is_active   = true,
       updated_at  = now();
