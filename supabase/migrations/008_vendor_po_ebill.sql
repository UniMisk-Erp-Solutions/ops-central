-- OP Central — 008: Vendor PO e-bill + provenance. Additive only.
--   ebill  : generated vendor-PO e-bill document { no, irn, date, generated }
--   source : how the PO was raised — 'sourcing' (auto from the chosen inquiry
--            vendor) or 'manual'. Lets the Vendor PO page show project history
--            and keep vendor (payable) billing separate from client billing.

alter table public.vendor_pos
  add column if not exists ebill  jsonb not null default '{}'::jsonb,
  add column if not exists source text;

notify pgrst, 'reload schema';
