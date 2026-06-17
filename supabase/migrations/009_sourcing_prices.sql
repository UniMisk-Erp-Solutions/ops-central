-- OP Central — 009: optional pricing hints on a sourcing inquiry. Additive only.
--   client_req_price : the price the client asked for / their budget (optional)
--   our_price        : our intended quote price (optional). When set, Purchase
--                      sees this as the quote budget instead of the indicative
--                      (line-computed) sell total, and the margin is measured
--                      against it.
alter table public.sourcings
  add column if not exists client_req_price numeric,
  add column if not exists our_price        numeric;

notify pgrst, 'reload schema';
